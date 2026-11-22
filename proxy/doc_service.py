#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""文档与图片解析服务（可选）。

代理（proxy/handler.js）把文件字节转到这里，这里负责两件事：

    /ocr       图片 → 文字（PaddleOCR 的 ONNX 版：RapidOCR）
    /document  Word / Excel / PDF / PPT → 文字（微软的 MarkItDown）

为什么单独起一个服务：解析要真正的解析库（ONNX 运行时、PDF 引擎），
这些在 Cloudflare Workers、Vercel Edge 上都跑不起来。代理只做转发，
四种运行时都能转发；真正干活的是这台机器上的这个进程。

只用标准库起 HTTP 服务。解析库缺了就明说缺哪个，
不让服务整个起不来 —— 代理会把这句人话转给模型。

    pip install -r proxy/requirements-doc.txt
    python proxy/doc_service.py --port 8788
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import sys
import tempfile
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

# ── 配置 ───────────────────────────────────────────────────

HOST = os.environ.get("DOC_HOST", "127.0.0.1")
PORT = int(os.environ.get("DOC_PORT", "8788"))

# 扫描版 PDF 最多认几页 —— 一页一秒，超了就没意思了
MAX_PDF_PAGES = 20

# 收多大的文件 —— 前端二进制附件上限是 25MB，这里留一点余量
MAX_BODY_BYTES = 30 * 1024 * 1024

# 单次返回多少字（客户端可以指定 offset/limit 翻页）
DEFAULT_LIMIT = 30_000
HARD_LIMIT = 200_000

# 转换结果的缓存：同一个文件翻页时不用再转一遍
CACHE_TTL_SECONDS = 600
_cache: dict[str, tuple[float, str, str]] = {}
_cache_lock = threading.Lock()

# 引擎是懒加载的 —— 第一次用到才初始化（加载 ONNX 模型要一两秒）
_ocr_engine = None
_ocr_engine_kind = ""
_markitdown = None
_lock = threading.Lock()


def _log(message: str) -> None:
    print(f"[doc] {message}", flush=True)


# ── 认字 ───────────────────────────────────────────────────


def _rapidocr_params() -> dict:
    """新版 RapidOCR 的参数。OCR_CUDA=1 时走显卡，显存封顶 OCR_GPU_MEM_MB（默认 3072）。

    arena 用 kSameAsRequested：要多少拿多少，不按 2 的幂往上翻；
    卷积算法用 HEURISTIC：每张图尺寸都不同，EXHAUSTIVE 会对每个新尺寸重新试一遍。
    选哪张卡用 CUDA_VISIBLE_DEVICES，这里固定 device_id=0。
    """
    if os.environ.get("OCR_CUDA", "") != "1":
        return {}
    limit = int(os.environ.get("OCR_GPU_MEM_MB", "3072")) * 1024 * 1024
    try:
        # pip 装的 CUDA/cuDNN 库在 site-packages/nvidia 下，不在动态库搜索路径上，先手动加载
        import onnxruntime

        onnxruntime.preload_dlls()
    except Exception as err:  # noqa: BLE001
        _log(f"预加载 CUDA 库失败，可能退回 CPU：{type(err).__name__}: {err}")
    return {
        "EngineConfig.onnxruntime.use_cuda": True,
        "EngineConfig.onnxruntime.cuda_ep_cfg": {
            "device_id": 0,
            "gpu_mem_limit": limit,
            "arena_extend_strategy": "kSameAsRequested",
            "cudnn_conv_algo_search": "HEURISTIC",
            "do_copy_in_default_stream": True,
        },
    }


def get_ocr_engine():
    """初始化 OCR 引擎。两个包名都试 —— 新旧两代 RapidOCR 的调用方式不一样。"""
    global _ocr_engine, _ocr_engine_kind
    if _ocr_engine is not None:
        return _ocr_engine
    with _lock:
        if _ocr_engine is not None:
            return _ocr_engine
        try:
            from rapidocr_onnxruntime import RapidOCR

            _ocr_engine = RapidOCR()
            _ocr_engine_kind = "onnxruntime"
        except ImportError:
            try:
                from rapidocr import RapidOCR

                _ocr_engine = RapidOCR(params=_rapidocr_params())
                _ocr_engine_kind = "rapidocr"
            except ImportError as err:
                raise RuntimeError(
                    "认字需要 RapidOCR：pip install rapidocr-onnxruntime"
                ) from err
        _log(f"OCR 引擎就绪（{_ocr_engine_kind}）")
        return _ocr_engine


def ocr_image(data: bytes) -> str:
    """图片字节 → 文字。两代 RapidOCR 的返回形状不一样，这里都认。"""
    engine = get_ocr_engine()
    result = engine(data)

    # 新版返回带 .txts 的对象
    txts = getattr(result, "txts", None)
    if txts:
        return "\n".join(str(t) for t in txts if str(t).strip())

    # 旧版返回 (result, elapse)，result 是 [[box, text, score], ...]
    if isinstance(result, tuple):
        result = result[0]
    if isinstance(result, list):
        lines = []
        for item in result:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                lines.append(str(item[1]))
            elif isinstance(item, str):
                lines.append(item)
        return "\n".join(line for line in lines if line.strip())

    return str(result or "").strip()


def ocr_pil(image) -> str:
    """PIL 图 → 文字（扫描版 PDF 走这条路）。"""
    try:
        import numpy as np

        return ocr_image(np.array(image.convert("RGB")))
    except ImportError:
        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, format="PNG")
        return ocr_image(buffer.getvalue())


# ── 文档 ───────────────────────────────────────────────────


def get_markitdown():
    global _markitdown
    if _markitdown is not None:
        return _markitdown
    with _lock:
        if _markitdown is not None:
            return _markitdown
        try:
            from markitdown import MarkItDown
        except ImportError as err:
            raise RuntimeError(
                "读文档需要 MarkItDown：pip install 'markitdown[pdf,docx,xlsx,pptx,xls]'"
            ) from err
        _markitdown = MarkItDown()
        _log("MarkItDown 就绪")
        return _markitdown


LEGACY_OFFICE = {".doc", ".ppt"}


def convert_document(data: bytes, filename: str) -> tuple[str, str]:
    """文件字节 → (文字, 备注)。备注是给模型看的一句话（比如「只认了前 20 页」）。"""
    suffix = os.path.splitext(filename or "")[1].lower()
    if suffix in LEGACY_OFFICE:
        raise RuntimeError(
            f"这是老版 Office 文件（{suffix}），现在的解析器读不了 —— 请另存为 "
            f"{'.docx' if suffix == '.doc' else '.pptx'} 再试。"
        )

    handle = tempfile.NamedTemporaryFile(delete=False, suffix=suffix or ".bin")
    try:
        handle.write(data)
        handle.close()
        path = handle.name

        markdown = get_markitdown().convert(path)
        text = getattr(markdown, "markdown", None)
        if text is None:
            text = getattr(markdown, "text_content", "") or ""

        note = ""
        # 扫描版 PDF：文字层是空的 —— 抽出来只有空白就说明是图片页
        if suffix == ".pdf" and not text.strip():
            text, note = ocr_pdf(path)
        return text, note
    finally:
        try:
            os.unlink(handle.name)
        except OSError:
            pass


def ocr_pdf(path: str) -> tuple[str, str]:
    """扫描版 PDF：每页栅格化成图，再一张张认字。"""
    try:
        import pypdfium2 as pdfium
    except ImportError as err:
        raise RuntimeError(
            "认扫描版 PDF 需要 pypdfium2：pip install pypdfium2"
        ) from err

    document = pdfium.PdfDocument(path)
    total = len(document)
    pages = []
    for index in range(min(total, MAX_PDF_PAGES)):
        page = document[index]
        image = page.render(scale=2).to_pil()
        pages.append(ocr_pil(image))
    note = ""
    if total > MAX_PDF_PAGES:
        note = f"这份 PDF 一共 {total} 页，只认了前 {MAX_PDF_PAGES} 页 —— 后面的没处理。"
    return "\n\n".join(p for p in pages if p.strip()), note


# ── HTTP ───────────────────────────────────────────────────


class Handler(BaseHTTPRequestHandler):
    server_version = "doc-service"

    def log_message(self, fmt: str, *args) -> None:  # 安静一点，别刷屏
        pass

    def _reply(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if urlparse(self.path).path == "/health":
            self._reply(200, {"ok": True, "service": "doc"})
            return
        self._reply(404, {"ok": False, "error": "没有这个地址"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY_BYTES:
            self._reply(413, {"ok": False, "error": f"文件太大（上限 {MAX_BODY_BYTES // 1024 // 1024}MB）"})
            return
        data = self.rfile.read(length) if length else b""

        try:
            if parsed.path == "/ocr":
                self._reply(200, self._handle_ocr(data))
                return
            if parsed.path == "/document":
                filename = (query.get("filename") or [""])[0]
                offset = int((query.get("offset") or ["0"])[0] or 0)
                limit = int((query.get("limit") or [str(DEFAULT_LIMIT)])[0] or DEFAULT_LIMIT)
                self._reply(200, self._handle_document(data, filename, offset, limit))
                return
        except Exception as err:  # noqa: BLE001
            self._reply(
                200,
                {
                    "ok": False,
                    "error": str(err) or err.__class__.__name__,
                    "detail": traceback.format_exc(limit=3),
                },
            )
            return

        self._reply(404, {"ok": False, "error": "没有这个地址"})

    def _handle_ocr(self, data: bytes) -> dict:
        if not data:
            return {"ok": False, "error": "没有收到图片内容"}
        text = ocr_image(data)
        return {"ok": True, "text": text}

    def _handle_document(self, data: bytes, filename: str, offset: int, limit: int) -> dict:
        if not data:
            return {"ok": False, "error": "没有收到文件内容"}
        limit = max(0, min(limit, HARD_LIMIT))

        key = hashlib.sha256(data).hexdigest()
        cached = None
        with _cache_lock:
            hit = _cache.get(key)
            if hit and time.time() - hit[0] < CACHE_TTL_SECONDS:
                cached = hit
            elif hit:
                _cache.pop(key, None)

        if cached is None:
            text, note = convert_document(data, filename)
            with _cache_lock:
                _cache[key] = (time.time(), text, note)
                if len(_cache) > 32:
                    oldest = min(_cache.items(), key=lambda item: item[1][0])[0]
                    _cache.pop(oldest, None)
        else:
            # 缓存里存的是 (时间, 正文, 备注) 三样
            text, note = cached[1], cached[2]

        total = len(text)
        start = max(0, offset)
        chunk = text[start : start + limit]
        return {
            "ok": True,
            "text": chunk,
            "total": total,
            "offset": start,
            "truncated": start + len(chunk) < total,
            "note": note,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="文档与图片解析服务")
    parser.add_argument("--host", default=HOST)
    parser.add_argument("--port", type=int, default=PORT)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    _log(f"文档服务起来了：http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        _log("停了")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
