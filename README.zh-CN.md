<!-- sections: intro features quickstart connect deploy settings design dev contribute license -->

# Free Chat

[英文](README.md) | [简体中文](README.zh-CN.md)

![许可证 MIT](https://img.shields.io/badge/license-MIT-111111?style=flat-square)
![版本 0.2.0](https://img.shields.io/badge/version-0.2.0-111111?style=flat-square)
![部署 GitHub Pages](https://img.shields.io/badge/deploy-GitHub%20Pages-111111?style=flat-square)
[![一键部署到 Cloudflare](https://deploy.workers.dev/button)](https://deploy.workers.dev/?url=https://github.com/JiHuiYiYou/hippocrenes-model-chat)

默认情况下代理托管在 GitHub Actions runner 上（公开仓库的 Actions 不收钱），GitHub Pages 上的站点则连一个地址固定的 Cloudflare Worker，由它跟着隧道走。这个 Cloudflare 按钮部署的就是那个 Worker 入口。跑不了在 Workers 上的是**代理本身**：上游是裸 IP，证书只有 IP SAN，Workers 的边缘节点连不上。详见[为什么这个代理跑不了在 Cloudflare Workers 上](#workers)。

一个给 `dsv4-flash` 用的开箱即用流式对话客户端，带独立可折叠的思考面板、代码高亮、KaTeX 公式，手机和桌面都能用。

<a id="intro"></a>
## 项目简介

**Free Chat** 是一个单页对话客户端（fork 自 [JiHuiYiYou/hippocrenes-model-chat](https://github.com/JiHuiYiYou/hippocrenes-model-chat)），只服务一个模型：`dsv4-flash`（DeepSeek-V4-Flash-0731-CRACK），在 `https://182.92.245.176:1920` 上。界面参照 DeepSeek.com：桌面上是常驻侧边栏（可以收起来），手机上是抽屉，答案流式吐字时右下角有闪烁光标，模型的思考过程单独放在一个可折叠面板里（定高视窗，思考内容一行行往上滚），与正文分开显示。

没有模型选择器，也不做通用 API 配置。源站地址、模型 id、API key、采样参数全部写在 `src/config.ts` 里，那是唯一的真相源。界面上能调的是使用习惯：主题、字号、发送键、思考档位、工具开关、自定义指令，全部存在访客自己的浏览器里。界面文案目前是中文的。

上游用 Server-Sent Events 讲 OpenAI 的 chat-completions 协议，用 `curl` 完全正常，但它一个 CORS 响应头都不给，浏览器页面没法直接调。所以仓库里带了一份零依赖的反向代理，放在 `proxy/` 目录下，专门解决浏览器需要的三件事：自己应答 CORS 预检、在服务端注入 API key、把 SSE 原样流式透传。

这个上游只能通过「TLS + 裸 IP」访问，证书里也只写了那个 IP，没有域名。仓库里所有部署上的限制都从这一条事实推出来：代理必须跑在一台有完整网络访问权的机器上，而 Cloudflare Workers 不是这样的地方。详见[为什么这个代理跑不了在 Cloudflare Workers 上](#workers)。GitHub Actions runner 就是这样的地方：公开仓库的 Actions 不收钱，也不用你准备任何东西，所以默认就托管在那里。

这个仓库里全是静态的东西：构建产物就是纯 HTML、CSS 和 JavaScript，扔到 GitHub Pages 或者任意静态服务器都能跑。没有自带的后端，没有数据库，也没有账号体系。

<a id="features"></a>
## 功能清单

| 分类 | 能力 |
|---|---|
| 流式输出 | SSE 流式返回，带打字光标；分片攒到每秒十二次左右刷新，长答案也不卡；视窗贴着最新的一行走，用户往上一滑才松手 |
| 思考过程 | `reasoning_content` 单独渲染成一个面板，与正文分开：定高视窗，思考内容在窗里一行行往上滚，顶部边界用渐隐柔化而不是硬切，并报出模型想了多少秒 |
| 截断提示 | 回答被截断时会明说：消息上带一条提示，把「撞了长度上限」「连接断了」「上游过滤」三种情况分开 |
| 思考档位 | 关闭 / 无 / 低 / 高 / 极限五档，就选在输入框左下角那个 chip 里，作为 `reasoning_effort` 发送；默认是 `low` |
| 上下文 | 每次请求把完整的多轮历史一起发回去 |
| Markdown | 支持 GitHub 风格 Markdown（含表格），用 `markdown-it` 渲染，DOMPurify 消毒 |
| 代码 | 14 种语言的语法高亮，每个代码块都带一个能用的复制按钮 |
| 数学公式 | KaTeX 渲染，行内 `$...$`、独立成块的 `$$...$$`、LaTeX 原生的 `\(...\)` 与 `\[...\]` 都支持；KaTeX 解析不了的公式退回等宽原文，而不是一大坨红字 |
| 消息操作 | 重新生成、随时停止生成、复制回答（纯文本或 Markdown）、改写问题（改写即重写：这一轮之后的话全部作废，重新问一遍） |
| 工具 | 模型自己够得着的四样：搜网页、抓网页、读附件、把图片里的字认出来。每一次调用都在回答里画成一张卡片，写清楚调了什么、传了什么参数、回来什么结果 |
| 报错 | 上游的错翻成人话：上游满了就说满了并等一分钟重试（最多五次），密钥不对就说密钥该配在哪儿，连不上就说断在哪一跳 —— 上游原话压在下面当小字，需要的时候翻它 |
| 本地历史 | 会话存在浏览器的 IndexedDB 里，不限条数；按今天 / 昨天 / 本周 / 更早分组；自动命名，可重命名、可置顶，右键呼出「重命名 / 置顶 / 导出 / 删除」；同一浏览器开多个标签页时互相同步 |
| 搜索 | 侧栏搜索框（`Ctrl+K`）在标题和全部消息正文里找，多个词用空格隔开，结果带命中片段和高亮 |
| 导出与导入 | 单段会话导出为 Markdown（可选带思考过程）；全部会话导出为 JSON 备份，能原样导回，同一段会话留更新的那份 |
| 设置与数据 | 侧栏底部「设置与数据」（`Ctrl+,`）：主题、字号、发送键、自定义指令；显示本地存储用量，可申请持久存储，可清空全部会话 |
| 草稿 | 没发出去的话按会话保存，刷新或切走再回来都还在 |
| 快捷键 | `Ctrl+K` 搜索、`Ctrl+Shift+O` 新对话、`Ctrl+Shift+S` 收起侧栏、`Ctrl+,` 设置、`/` 跳到输入框、`Esc` 停止生成（macOS 用 `⌘`） |
| 主题 | 浅色 / 深色 / 跟随系统，侧栏底部一个图标按钮就能切 |
| 布局 | 桌面常驻侧边栏（可以收起来），手机抽屉，移动端用 `visualViewport` 适配软键盘 |
| 欢迎界面 | 每次进来都是一个新的空会话，老的都在侧边栏里点一下就到；品牌字在一个字一个字写出来，写完留一道金线 —— 不想看动效的人直接看到写完的样子 |
| 响应式 | 一套布局，从窄屏手机一直适配到宽屏桌面 |

明确不做：图片输入（这个 API 没有视觉能力 —— 图片走 OCR 认字）、多模型切换（只有一个模型）。

<a id="quickstart"></a>
## 快速开始

线上站点已经能用了。代理托管在 GitHub Actions runner 上，GitHub Pages 上的站点连的是一个地址固定的 Cloudflare Worker，所以什么都不用配，也不用注册任何账号：打开站点直接开始聊。

想跑自己那份的话，克隆下来装完依赖就行。本地代理不用注册，也不用在任何地方开账号。

```bash
git clone https://github.com/Cerynitius/free-chat.git
cd free-chat
npm install
```

### 在自己电脑上用

Linux 与 macOS：

```bash
API_KEY=sk-your-key npm run proxy
```

Windows PowerShell：

```powershell
$env:API_KEY = "sk-your-key"; npm run proxy
```

代理默认监听 `127.0.0.1:8787`，key 从 `API_KEY` 环境变量读。开发模式下前端会自己指向这个地址，所以前端这边不用设任何环境变量。在打开页面之前先确认代理是活的：

```bash
curl http://127.0.0.1:8787/__ping
```

然后另开一个终端起前端：

```bash
npm run dev
```

打开 `http://localhost:5173`，直接开始打字聊天。整套流程就这三步：`npm install && npm run proxy && npm run dev`。

只改界面的话前端自己也能跑，只是没起代理之前会报连接错误。

### 让线上站点连上你自己的机器

上面那个代理只有你自己访问得到。要让 GitHub Pages 上的站点也能用到它，就用 Cloudflare 快速隧道把它暴露出去：

```bash
npm run tunnel
```

`npm run tunnel` 会起本地代理、开一条 `cloudflared` 隧道，把拿到的 `https://<随机串>.trycloudflare.com` 地址写进仓库变量 `VITE_PROXY_URL`，再触发一次 Pages 重新部署。隧道地址每次重启都会变，站点会自动跟上。

这条路绕开了 Worker 和 Actions runner：构建出来的站点直接连你的隧道，代价是这台机器得一直开着。

它需要机器上有两样东西：

1. `cloudflared` 二进制，约 55 MB，故意不入库。Windows PowerShell：

   ```powershell
   Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile "proxy/cloudflared.exe"
   ```

   Linux 与 macOS：

   ```bash
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o proxy/cloudflared
   chmod +x proxy/cloudflared
   ```

2. `gh` 命令行工具，并且执行过 `gh auth login` —— 隧道脚本靠它更新仓库变量。

然后带上 key 跑起来：

```bash
API_KEY=sk-your-key npm run tunnel
```

```powershell
$env:API_KEY = "sk-your-key"; npm run tunnel
```

要发布站点本身，把仓库推到 GitHub，仓库里自带的 workflow 会自动构建并发布。

完整流程见[部署](#deploy)一节。

<a id="connect"></a>
## 接入接口

### 上游的真实契约

| 项目 | 值 |
|---|---|
| 基址 | `https://182.92.245.176:1920` |
| 协议 | 只能 https。这个端口上的明文 http 会被 nginx 挡掉。 |
| 入口 | 裸 IP，没有域名。 |
| 证书 | 有效的 Let's Encrypt IP 证书，SAN 里含这个 IP，不含任何 DNS 名，浏览器直接认，没有证书告警，也不需要任何证书绕过手段。 |
| 放行的路由 | `POST /v1/chat/completions`、`GET /v1/models`、`GET /health`。其余路径一律 `403`。 |
| 鉴权 | 每个请求都要带 `Authorization: Bearer <key>`。 |
| 流式 | 强制要求。`stream: false` 会直接被 `400 stream_required` 挡掉。 |
| 思考通道 | `delta.content`（正文）和 `delta.reasoning_content`（思考）是同一帧里两个彼此独立的字段。 |
| 结束标记 | `finish_reason: "stop"`；token 预算用尽时是 `"length"`。任何一帧里都没有 `usage` 字段。 |
| 思考档位 | 接受 `off`、`none`、`low`、`high`、`max`。 |
| 采样参数 | 支持 `system` 角色、`temperature`、`top_p`、`stop`。 |
| 工具调用 | 支持，走的是 OpenAI 的标准形状：模型回 `delta.tool_calls`（参数分片下发）、`finish_reason: "tool_calls"`，也接受随后那条带结果的 `role: "tool"` 消息。实测出来的，不是猜的。 |

服务端永远不报 token 用量，所以界面上干脆不显示任何用量计数 —— 没有可估的数，也就没有要显示的数。

### token 预算

`max_tokens` 是**共用**的预算 —— 上游把 `reasoning_content` 也算在里面。思考一长，正文能用的额度就被挤掉了；额度用尽时流以 `finish_reason: "length"` 结束，而且多半是**停在思考中间**，正文一个字都还没轮到。

实测这个上游：一个需要深度推理的任务在 `max_tokens: 4096` 下把 4096 全花在思考上，正文一个 token 都没产出。

所以 `MAX_TOKENS` 定成 `131072`。上游对这个值来者不拒，也不拿它跟上下文长度对照（15 万字提示词 + `max_tokens: 131072` 照样回 `200`）。它是天花板，不是目标 —— 同一道题在更大天花板下写出来的文章反而更短，因为写多少是模型自己定的。

被截断时前端不装没事 —— 消息上会带一条提示，把三种情况分开：

| 提示 | 到底发生了什么 |
|---|---|
| 输出被截断 | 上游撞到了 `max_tokens`。思考和正文共用这一个预算。 |
| 连接中断 | 流没收到结束标记就断了 —— 下面这段可能不完整。 |
| 内容被过滤 | 上游自己的过滤器把这一段截了。 |

### 工具

模型自己够得着四样工具。要用的时候它自己决定，工具跑完，结果再喂回对话里 —— 就是 OpenAI 那套标准协议，这个上游说的是同一套：它回 `delta.tool_calls`（参数分片下发）、`finish_reason: "tool_calls"`，也接受随后那条带结果的 `role: "tool"` 消息。

| 工具 | 跑在哪 | 干什么 |
|---|---|---|
| `web_search` | 服务端 | 搜网页，返回标题、链接和摘要。 |
| `web_fetch` | 服务端 | 抓一个网址，返回正文。 |
| `read_file` | 先浏览器，再服务端 | 读附件。文本文件在浏览器里读，压根不离开本机；PDF、Word、Excel、PPT 交给文档服务转成文字。 |
| `ocr` | 服务端 | 把图片里的字认出来。 |

每一次调用都会在回答里画成一张卡片：调了什么、传了什么参数、回来什么结果。点开就是原始请求和原始结果。服务端那几个工具由同一个代理提供，挂在 `/tools/` 下面。

模型只知道给它的名字 —— 消息上挂了哪些附件，会跟着消息一起发过去，所以它不用停下来问「那文件叫什么」。

#### 搜索后端

搜索得要有个后端。有三种给法，按这个顺序试：

| 后端 | 怎么配 | 是什么 |
|---|---|---|
| SearXNG | `SEARXNG_URL` | 自建的元搜索 —— 开源社区的标准答案，`github.com/searxng/searxng`。哪儿都不用注册，但得自己起一个：`proxy/searxng/docker-compose.yml` 已经备好。 |
| Brave Search | `BRAVE_API_KEY` | 官方接口，免费额度每月 2000 次。 |
| Tavily | `TAVILY_API_KEY` | 官方接口，免费额度每月 1000 次，本来就是给 agent 用的。 |

一个都不配的话，代理会退回去抓 Bing 的结果页 —— 不用账号不用 key，但那是兜底，不是保证。全挂了的时候，工具会明说「搜不了」，模型就自己掂量着答，不会瞎编。

#### 文档服务

读 PDF、Word、Excel 或者图片里的字，要有真的解析器，而解析器要真的运行时 —— Cloudflare Workers 和 Vercel Edge 跑不了这些东西。它们放在代理旁边的一个小 Python 服务里，`proxy/doc_service.py`：

- **文档**用 [MarkItDown](https://github.com/microsoft/markitdown)（MIT）转：PDF、`.docx`、`.xlsx`、`.pptx`，还有老版的 `.xls`。
- **图片**用 [RapidOCR](https://github.com/RapidAI/RapidOCR) 认 —— 它是 PaddleOCR 那批模型导成 ONNX 的样子：准确率一样，CPU 上快四倍，内存只占五分之一，而且不用装 PaddlePaddle。
- **扫描版 PDF**（每一页都是图片的那种）用 pypdfium2 栅格化成图，再交给 OCR 认。最多认 20 页，超出的部分会明说没读到。

这个服务是**可选**的。没它别的照常工作，需要它的两个工具会回一句「文档服务没开」。

```bash
pip install -r proxy/requirements-doc.txt
npm run doc          # http://127.0.0.1:8788
```

代理通过 `DOC_URL` 找它，默认是 `http://127.0.0.1:8788`。

老版的 `.doc` 和 `.ppt`（2007 年以前那个二进制格式）解析不了 —— 工具会明说，并让你另存为 `.docx`。

### 请求地址是从哪来的

界面上没有「连哪个后端」这种选择。目标是构建期定下来的，直接进产物里：

| 常量 | 来源 | 含义 |
|---|---|---|
| `BASE_URL` | 写死在 `src/config.ts` | 源站地址，`https://182.92.245.176:1920`。 |
| `PROXY_URL` | `VITE_PROXY_URL`，开发模式下兜底成 `http://127.0.0.1:8787` | 代理的公网地址，默认那套里指的是 Worker 的地址。填了就所有请求都走代理，留空就直接打源站。 |
| `API_KEY` | `VITE_API_KEY` | Bearer 令牌。代理在服务端注入 key 时它可以是空的。 |
| `MODEL` | 写死在 `src/config.ts` | `dsv4-flash`。 |
| `TEMPERATURE`、`TOP_P`、`MAX_TOKENS`、`SYSTEM_PROMPT` | 写死在 `src/config.ts` | 采样参数，分别是 `0.7`、`1`、`131072` 和一个空的系统提示词。 |

规则就一句话：**配了代理就走代理，没配浏览器就直接调源站。** 后一半只有在源站给了 CORS 头时才成立，而它没给。

### CORS 问题

这是理解上游最重要的一件事，所以在这里讲透。

从 `https://jihuiyiyou.github.io` 打开的页面去请求 `https://182.92.245.176:1920` 属于跨源请求。浏览器对结果按同源策略处理：请求可以发出去，但只有响应里带着匹配的 `Access-Control-Allow-Origin` 时，JavaScript 才被允许读取。上游一个这种头都没有，而且它的预检是被鉴权层应答的，不是被 CORS 处理器应答的。实测结果：

```
OPTIONS /v1/chat/completions  ->  401 Unauthorized
   （nginx 的鉴权层在预检阶段就拦掉了，压根没走到 CORS 判断）

GET /v1/models  ->  200 OK，但响应头里一个 CORS 头都没有
   （没有 Access-Control-Allow-Origin / Allow-Headers / Allow-Methods）

POST /v1/chat/completions  ->  同样零 CORS 头
```

两个互相独立的失败叠在一起：

1. **预检根本没走到 CORS 处理器。** 凡是带了 `Authorization` 或者 `Content-Type: application/json` 的请求都要先过一遍 `OPTIONS` 预检。上游的 nginx 对每个请求都鉴权，预检也不例外，直接回 `401` 加一个 HTML 错误页。浏览器到这儿就停了，真正的请求压根不会发出去。
2. **真实响应里也没有 CORS 头。** 就算预检被绕过去了，`GET /v1/models` 会带着 `200` 回来，然后被浏览器丢掉——因为响应里没有 `Access-Control-Allow-Origin`。在 JavaScript 看来，被丢掉的响应和网络失败长得一模一样：控制台里只有一句 "Failed to fetch"。

### 为什么这个代理跑不了在 Cloudflare Workers 上

<a id="workers"></a>

这是实测出来的，不是推测。Workers 部署的每一种配置，对上这个上游都走不通：

| 试法 | 结果 |
|---|---|
| `fetch()` 直接打裸 IP | `HTTP 403`，Cloudflare 错误码 `1003`。边缘节点不直连 IP。 |
| `fetch()` 打指向同一个 IP 的通配域名（`nip.io`、`sslip.io`） | `HTTP 526 Invalid SSL Certificate`。证书写的是 IP，不是主机名。 |
| `resolveOverride`，两个方向都试了 | 还是 `1003` 和 `526`。 |
| IP 的其它写法：IPv4 映射的 IPv6、尾点、八进制、十六进制 | 一律 `1003`。边缘节点在校验之前就把地址归一化了。 |
| 免费版上的 `cloudflare:sockets` | 普通 TCP 能连上，但 `secureTransport: 'on'` 会静默降级成明文，上游回 `400 The plain HTTP request was sent to HTTPS port`；`startTls()` 直接报错。sockets 上的 TLS 需要 Workers Paid 版。 |

于是规矩很简单：**代理必须跑在一台有完整网络访问权的机器上** —— 普通容器或虚机都行。

这否掉的是「把代理跑在 Workers 上」，不是「用 Worker 当入口」。Worker 只要能 fetch 一个正常的主机名就行，而隧道地址正是一个主机名。所以本仓库里 Worker 的角色是隧道前面那个地址固定的入口，而不是代理跑着的地方。详见[代理跑在哪](#hosting)。

<a id="hosting"></a>
### 代理跑在哪

三种放法，按值得尝试的顺序排。第一种不用注册账号、不用自己备机器，也一分钱不花。

#### A、GitHub Actions（默认，零成本零注册）

代理跑在 GitHub Actions runner 上。公开仓库的 Actions 分钟数不收费，所以这条路不花钱，也不用你自己开账号。

整条链路是：

```
浏览器 -> GitHub Pages -> Cloudflare Worker（地址固定） -> 隧道(trycloudflare.com) -> Actions runner 上的代理 -> 源站
```

`.github/workflows/tunnel.yml` 把整条链路串起来：单次最多跑 5.5 小时（`timeout-minutes: 330`），**上一轮在到期前 90 分钟自己叫起下一轮** —— 交接不靠 GitHub 的定时器（为什么，见下面的「已知限制」）。每一轮里它：

1. 装 `cloudflared`；
2. 起本地代理（`node proxy/server.mjs`，key 从仓库 secret `VITE_API_KEY` 读）；
3. 装文档服务并起起来（可选 —— 这步挂了也不影响隧道）；
4. 开一条 `cloudflared tunnel --url http://127.0.0.1:8787`；
5. 把拿到的 `https://<随机串>.trycloudflare.com` 地址写进 `runtime` 分支的 `tunnel-url` 文件；
6. 让代理和隧道一直活着，直到这个 job 到点；
7. 离到期还剩 90 分钟时，用仓库自带的 `GITHUB_TOKEN` 调 Actions API 叫起下一轮（`workflow_dispatch` 不受「GITHUB_TOKEN 触发的事件不产生新 run」那条限制 —— GitHub 明确把它排除在外）。

runner 不接受假成功：工作流会探一次 `/__ping`，响应里没有 `"reachable": true` 就直接判失败。隧道起来了但打不通源站，不会被当成成功。

`runtime` 是孤儿分支，里面只有那一个文件。

这条 workflow 不做并发分组，所以新一轮是和上一轮**并存**着起来的，既不会把上一轮取消掉，也不会排队等它跑完。新一轮把指针指过去之后，上一轮还会再活 1.5 小时才自然结束 —— 两个隧道同时在线，交接时站点没有空窗。

「Actions」标签页手动跑这条 workflow 时有两个输入：`takeover` 选 `auto`（默认）的话，先探一下当前指针上的隧道 —— 还活着就退位，不跟自续链抢指针；选 `always` 就是无条件接管。`handoff_now` 勾上则是起完隧道立刻叫下一轮（指针立刻交给它），本轮继续活着当备用。

##### Worker 是固定入口，隧道地址是指针

隧道前面那个 Worker 的地址永远不变，所以隧道换地址时站点不用重新构建。`proxy/handler.js` 从一个「指针」读上游：`UPSTREAM_POINTER` 指向一个公开可读的文本文件，内容就是当前隧道地址，Worker 在运行时把它读下来当上游用。`proxy/wrangler.toml` 里指的是 `runtime` 分支上那个文件：

```
UPSTREAM_POINTER = "https://raw.githubusercontent.com/JiHuiYiYou/hippocrenes-model-chat/runtime/tunnel-url"
```

指针有 30 秒缓存，新的隧道地址半分钟内就能被 Worker 看到。指针读不到时，Worker 沿用上一次拿到的地址，不会因此整条代理挂掉。

在前面这个 Worker 上实测：

| 检查项 | 结果 |
|---|---|
| `GET /__ping` | `upstream` 显示当前隧道地址，`reachable: true`，`latencyMs` 在 1200 到 1600 之间 —— 链路比直连多一跳 |
| Actions runner | 能连上源站；连不上时工作流会直接判失败 |
| 线上站点 | 本机隧道和本机代理全杀掉之后，仍然能正常对话 |

#### B、自己的服务器 / Vercel / Deno Deploy

比免费的 runner 更稳、更快。Vercel 和 Deno Deploy 都有免费额度，但要注册账号；自己的服务器则要你自己养着。

自己的服务器上直接跑 Node 代理，前面再套一层做 TLS 终止的反向代理：

```bash
API_KEY=sk-your-key node proxy/server.mjs --host 0.0.0.0 --port 8787
```

整条链必须留在 HTTPS 上：HTTPS 加载的页面不允许调用 `http://` 的接口（混合内容），而且 key 会以明文过网络。

Vercel 上要用 **Node** 运行时，不要用 Edge。Edge 函数跑在边缘节点，Node 函数跑在真容器里，只有真容器才能稳定直连裸 IP 的非标准端口。项目根目录就是 `proxy/` 目录，入口是 `proxy/api/[...path].js`，`proxy/vercel.json` 把所有路径改写到 `/api/:path*`。

```bash
cd proxy
npx vercel --prod
```

在 Vercel 控制台把 `API_KEY` 设成项目环境变量。`UPSTREAM` 和 `ALLOWED_ORIGINS` 有可用的默认值。

Vercel 到 `maxDuration` 秒就会把函数杀掉，而一次长思考很容易超过一分钟。入口这里申请的是 300 秒，这需要付费套餐 —— Hobby 套餐把函数时长钉死在 60 秒，函数申请多少都没用，于是思考超过一分钟的回答会被平台从中间砍断。

Deno Deploy 上入口是 `proxy/deno.ts`：

```bash
deno deploy --project=<your-project> deno.ts
```

在 Deno Deploy 控制台设 `UPSTREAM`、`API_KEY`、`ALLOWED_ORIGINS`。

#### C、自己的电脑 + 隧道

`npm run tunnel` 是「想把代理放在自己机器上」的人走的零注册路线：起本地代理、开一条 `cloudflared` 隧道、用 `gh` 命令行把隧道地址写进仓库变量 `VITE_PROXY_URL`，再触发 Pages 部署，于是线上站点就连到了你的机器：

```
浏览器 -> GitHub Pages -> 隧道(trycloudflare.com) -> 本机代理 -> 源站
```

前提是机器上有 `cloudflared` 二进制，以及装好并登录过的 `gh` 命令行（`gh auth login`）。下载命令见[快速开始](#quickstart)。

隧道地址每次重启都会变，站点自动跟上，手工不用改任何配置。代价是这台机器得一直开着、连着网。

在跑着的隧道上实测：

| 检查项 | 结果 |
|---|---|
| `GET /__ping` | `reachable: true`、`hasKey: true`，`latencyMs` 在 29 到 134 之间 |
| CORS 预检 | `204`，带 `Access-Control-Allow-Origin: *` |
| SSE 流 | 90 帧铺在 2745 毫秒到 3912 毫秒之间，是真流式，不是一坨攒完再吐 |
| 线上站点 | 能正常对话 |

#### 附录：直连源站（可选，需要管理员改 nginx）

源站不改也能用上面任意一条路。这一节只写给想让浏览器不靠代理直接访问源站的管理员，本仓库的任何部分都不依赖它，而且代理其实是更省事的选择。如果确实想让浏览器直接调源站，把下面这段加到 `listen 1920 ssl;` 那个 server 块里：

```nginx
    # 预检短路：server 级 if 在 rewrite 阶段执行，早于 access(鉴权) 阶段
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin  "*" always;
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, Accept" always;
        add_header Access-Control-Max-Age       86400 always;
        return 204;
    }
    # 真实请求也要带 CORS 头；always 不可省（源站会回 401/403/500）
    add_header Access-Control-Allow-Origin  "*" always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Authorization, Content-Type, Accept" always;
    add_header Access-Control-Expose-Headers "Content-Type" always;
    # SSE：关掉缓冲，否则流会被攒成一坨再一次性吐出来
    proxy_buffering    off;
    proxy_cache        off;
    proxy_read_timeout 3600s;
```

有两个坑必须知道：

- **nginx 的 `add_header` 继承规则。** `location` 块里只要自己声明了一条 `add_header`，server 级的整套在这个 `location` 里**全部失效**。所以每个 `location` 都要挨个检查，把这些头手工复制进去。
- **`if` 里只能用 `return` 和 `rewrite`。** `proxy_pass` 写在 `if` 块里是非法的，nginx 会直接起不来。

用预检验证结果：

```bash
curl -i -X OPTIONS https://182.92.245.176:1920/v1/chat/completions \
  -H "Origin: https://jihuiyiyou.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"
```

期望的答案是 `204`，外加四个 CORS 头。

### API key 的可见性

编进网页里的 key 就是发布出去的 key。key 一旦写进 JavaScript bundle，任何人打开 DevTools 都能读出来，任何人下载 bundle 也能读出来。这事没法绕开：浏览器能发出去的东西，浏览器同样能让人看见。

key 可以放在两个地方：

| 存放位置 | 浏览器能看见吗 | 建议 |
|---|---|---|
| 代理侧的 secret（代理模式） | 不能。key 由服务端在每次上游请求时注入，并且会覆盖客户端发来的那份 | 推荐 |
| 构建期仓库 secret `VITE_API_KEY`（Pages） | 能。值会出现在公开的 bundle 里 | 只能接受，前提是定期轮换、权限收窄 |

代理会在每次上游请求时注入 key，所以前端自己不需要 key。代理那边没配 key 的时候，客户端那份 `VITE_API_KEY` 头才会原样透传上去。

不管走哪条路，都要定期轮换 key。已经躺进公开 bundle 里的 key，应当当成已经泄露处理。

<a id="deploy"></a>
## 部署

### 部署到 GitHub Pages

仓库自带一条自动构建发布的 workflow。

1. **把仓库推到 GitHub。** 目标仓库是 `https://github.com/JiHuiYiYou/hippocrenes-model-chat`。
2. **加仓库 secret。** 在仓库的**设置**、**Secrets and variables**、**Actions** 里新建一个仓库 secret，名字叫 `VITE_API_KEY`，把上游 key 填进去。这个 secret 在构建期注入，绝不会进仓库。
3. **加仓库变量。** 新建一个仓库变量 `VITE_PROXY_URL`，填**你代理的公网地址** —— 浏览器访问得到的那个地址，不是本机地址。这是唯一决定构建产物往哪儿发请求的开关。不填的话，站点会直接调源站，而源站一个 CORS 头都不给，浏览器会把每个响应都丢掉。只有当你把站点部署在「能带着 CORS 头访问源站」的地方时，才可以不填。

   这个地址从你选的代理放法来：

   | 代理跑在哪 | `VITE_PROXY_URL` 填什么 |
   |---|---|
   | GitHub Actions（默认） | 隧道前面那个 Cloudflare Worker 的地址。它不会变，所以站点构建一次就一直有效。 |
   | 本机代理 + Cloudflare 快速隧道 | `npm run tunnel` 打出来的 `https://<随机串>.trycloudflare.com` 地址。脚本会自己把它写进这个变量。 |
   | Vercel | `https://<你的项目名>.vercel.app` |
   | Deno Deploy | `https://<你的项目名>.deno.dev` |
   | 自己的服务器 | `https://proxy.example.com`，也就是 TLS 终止反向代理对外的那个地址 |

   隧道地址是临时的：隧道一重启就换。`npm run tunnel` 会负责改写这个变量并重新部署站点，所以只要隧道还开着，站点就一直能用。

   **代理托管在 Actions 上时，隧道地址根本不会进到构建产物里。** `VITE_PROXY_URL` 指的是 Worker，真正的上游由 Worker 在运行时通过 `UPSTREAM_POINTER` 去查（见[代理跑在哪](#hosting)）。新的隧道地址半分钟内就被 Worker 跟上，什么都不用重新部署 —— Worker 不用，站点也不用。
4. **启用 Pages。** workflow 用的是 `enablement: true`，第一次跑就会把站点建出来。也可以自己在**设置**、**Pages** 里手动选 GitHub Actions 作为来源。
5. **推 `main` 分支。** `Deploy to GitHub Pages` 这条 workflow 会构建并发布，站点地址形如 `https://<用户名>.github.io/<仓库名>/`。

构建用的是相对路径基准（`./`），所以同一份 `dist/` 也能丢到任意静态服务器、本地磁盘，或者别的域名的子目录里跑。

### Actions 托管代理的已知限制

站点要连得上模型，`Tunnel` 这条 workflow 就得跑着。关于它有两件事值得知道：

- **GitHub 的 cron 在这个仓库上一度没被触发过。** workflow 里留了 `cron: 17 */4 * * *` 当兜底，但实测它一直没跑（2026-11-20，12:17Z 和 16:17Z 两个时点都没动静），于是每轮隧道到点被杀之后没人接手，站点就断着 —— 浏览器里报 `HTTP 530 · error code: 1016`（连接器还活着，但那头的代理进程先被收走了）或 `1033`。所以交接改成由**上一轮自己叫起下一轮**，不指望定时器。定时器哪天醒了也不碍事：兜底触发的那一轮会先探当前隧道，还活着就退位，不跟自续链抢指针。
- **仓库 60 天没有活动，GitHub 会停掉定时工作流。** 连续 60 天没有任何活动，cron 就不再触发，隧道也就不会再起来。推一个 commit，或者到 **Actions** 标签页手动跑一次 `Tunnel`，就能把它救回来。

### 自建部署

`dist/` 里的构建产物是纯静态站点，服务端没有任何要求，拿什么 Web 服务器托管都行。唯一需要一直活着的是代理，最省事的就是本地开发用的那份 Node runner：

```bash
API_KEY=sk-your-key node proxy/server.mjs --host 0.0.0.0 --port 8787
```

构建的时候把代理的公网地址编进去，浏览器才会找代理而不是找源站：

```bash
VITE_PROXY_URL=https://proxy.example.com npm run build
```

同一份构建也可以把 Worker 地址填进去代替自己的代理：Worker 会转发到指针指着的那个上游。

前面再套一层做 TLS 终止的反向代理。整条链必须留在 HTTPS 上：HTTPS 加载的页面不允许调用 `http://` 的接口（混合内容），而且 key 会以明文过网络。

### 部署不做的事

部署只发布静态文件。它不转发接口，不在服务端存会话，也不做限流。会话存在访客自己的浏览器里，唯一可能进浏览器的 key，只有你自己决定编译进去的那一个。

<a id="settings"></a>
## 可调项

下面这些都能在界面上直接调，存在访客自己的浏览器里（`localStorage`）：

| 可调项 | 默认值 | 入口 | 说明 |
|---|---|---|---|
| 主题 | `system` | 侧栏底部的图标按钮 | `light`、`dark`，或者跟随操作系统。那个按钮在浅色和深色之间来回切。 |
| 思考档位 | `low` | 输入框左下角的 chip | 取 `off`、`none`、`low`、`high`、`max`，作为 `reasoning_effort` 每次请求都带上。 |
| 工具 | 开 | 输入框左下角的 chip | 模型能不能调工具。关掉的话请求里就不带 `tools`，模型只聊天。 |
| 侧边栏收起 | 展开 | 主区左上角的图标按钮 | 把桌面端侧边栏收起来，下次进来还记得。 |
| 字号 | 中 | 设置与数据 | 对话正文 14 / 15 / 17 px。 |
| 发送键 | Enter | 设置与数据 | `Enter` 发送（`Shift+Enter` 换行），或 `Ctrl/⌘+Enter` 发送（`Enter` 换行）。触屏设备上 Enter 总是换行。 |
| 自定义指令 | 空 | 设置与数据 | 每一轮都附在系统提示词后面发给模型，最多 2000 字。 |
| 导出带思考过程 | 关 | 设置与数据 | 单段会话导出 Markdown 时，把思考过程放进可折叠块。 |

其余参数全部写死在 `src/config.ts` 里，界面上不提供修改：源站地址、代理地址、API key、模型 id、`temperature`、`top_p`、`max_tokens`、系统提示词。想改其中任何一个，只能改那一个文件然后重新构建。

<a id="design"></a>
## 设计系统

视觉语言刻意做得很安静：用发丝线代替阴影，近黑的字配浅色底，不放任何跟答案抢注意力的装饰。

### 配色 token

统一定义在 `src/styles.css` 里，暗色模式整块覆盖，工具类自动跟着变。

| token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `--color-canvas` | `#FFFFFF` | `#0E0E0D` | 页面底色 |
| `--color-canvas-2` | `#F7F6F3` | `#141413` | 次级底色 |
| `--color-canvas-3` | `#FBFBFA` | `#121211` | 三级底色 |
| `--color-surface` | `#FFFFFF` | `#161615` | 卡片、面板表面 |
| `--color-surface-2` | `#F9F9F8` | `#1C1C1A` | 弱化的表面，行内代码 |
| `--color-line` | `#EAEAEA` | `#2A2A27` | 发丝描边 |
| `--color-ink` | `#111111` | `#F2F1ED` | 主文字 |
| `--color-ink-2` | `#2F3437` | `#D6D5D0` | 次级文字 |
| `--color-muted` | `#787774` | `#8E8D87` | 三级文字 |
| `--color-faint` | `#A8A7A3` | `#6E6D68` | 四级文字 |
| `--color-paper-1` | `#FAF8F3` | `#1C1B17` | 欢迎页，纸感渐层亮的一头 |
| `--color-paper-2` | `#F0EDE6` | `#111110` | 欢迎页，纸感渐层暗的一头 |
| `--color-gold` | `#A89169` | `#8F7C58` | 欢迎页标题底下那道金线 |

四组语义淡彩各有一份底色和一份字色，用来表示状态，也用来做代码高亮主题。

| 淡彩 | 底色（浅色） | 字色（浅色） | 底色（深色） | 字色（深色） |
|---|---|---|---|---|
| 红 | `#FDEBEC` | `#9F2F2D` | `#3A1E1E` | `#E3A3A1` |
| 蓝 | `#E1F3FE` | `#1F6C9F` | `#14303F` | `#8FC4E4` |
| 绿 | `#EDF3EC` | `#346538` | `#1D2E1C` | `#9CC79A` |
| 黄 | `#FBF3DB` | `#956400` | `#332912` | `#D9B570` |

### 字体

| 用途 | 字体栈 |
|---|---|
| 无衬线 | `SF Pro Display`、`Geist Variable`、`Helvetica Neue`、`PingFang SC`、`Hiragino Sans GB`、`Microsoft YaHei`、`Noto Sans SC`、`system-ui`、`sans-serif` |
| 衬线 | `Newsreader`、`Lyon Text`、`Songti SC`、`Source Han Serif SC`、`Noto Serif SC`、`Georgia`、`Times New Roman`、`serif` |
| 等宽 | `Geist Mono Variable`、`SF Mono`、`JetBrains Mono`、`Cascadia Code`、`Consolas`、`PingFang SC`、`monospace` |

拉丁文字和数字走 Geist，中文交给系统字体，两边都是几何无衬线，混排不打架。字体全部自托管，运行时不请求任何 CDN。正文是 15 像素大小，行高 1.75。欢迎页的标题用衬线体，字号随屏幕在 27 到 48 像素之间走。

### 形状、层次与动效

| token | 值 | 规矩 |
|---|---|---|
| 描边 | `1px solid #EAEAEA` | 界面里所有描边都用这一条发丝线。 |
| 圆角 | 4、6、8、12 像素 | 大容器最多 12 像素，pill 圆角只留给小标签。 |
| 阴影 | `0 2px 8px rgba(0, 0, 0, 0.04)` | 卡片这一档层次。浮层（比如右键菜单）另用一档更重的：`0 8px 28px rgba(0, 0, 0, 0.13)`。 |
| 主操作按钮 | `#111111` 底、白字、圆角 4 到 6 像素、无阴影 | 按下时是 `transform: scale(0.98)`。 |
| 缓动 | `cubic-bezier(0.16, 1, 0.3, 1)` | 所有过渡都用它。 |
| 动效 | 只动 `transform` 和 `opacity` | 只有两个尺寸会动，都在 250 毫秒以内：思考视窗用 `max-height` 展开，侧边栏用 `width` 收起。 |

首屏是全站唯一一处渐变：标题后面一层极淡的纸感。其余地方不要渐变、不要霓虹、不要玻璃拟态，界面上一个 emoji 都不放。图标只用 Phosphor 的 Bold 和 Fill 两种字重。

<a id="dev"></a>
## 开发

### 技术栈

| 层 | 选型 |
|---|---|
| 界面 | React 19 配 TypeScript 5.9 |
| 构建 | Vite 8，带 React 插件和 Tailwind CSS v4 插件 |
| 样式 | Tailwind CSS v4，`src/styles.css` 里自定义 `@theme` 块 |
| 状态 | Zustand 5，三个 slice 共用一份类型模块 |
| Markdown | `markdown-it` 配 DOMPurify 消毒 |
| 代码高亮 | `highlight.js`，只注册 14 种语言 |
| 数学公式 | KaTeX，行内与块级规则是手写的插件 |
| 图标 | `@phosphor-icons/react` |
| 字体 | `@fontsource-variable/geist` 与 `@fontsource-variable/geist-mono`，自托管 |

### 命令

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器，http://localhost:5173
npm run proxy      # 本地代理，http://127.0.0.1:8787
npm run tunnel     # 可选：本机代理加 Cloudflare 快速隧道，同步到仓库变量
npm run typecheck  # TypeScript 检查，不产出文件
npm run build      # 类型检查加生产构建，产物在 dist/
npm run preview    # 本地预览生产构建
npm run check:readme  # 检查两份 README 是否同步
npm run doc     # 可选：文档服务，127.0.0.1:8788
```

### 目录结构

```
hippocrenes-model-chat/
├── index.html            # HTML 外壳
├── vite.config.ts        # Vite 配置，相对路径基准，@ 别名
├── tsconfig.json
├── src/
│   ├── main.tsx          # 入口
│   ├── App.tsx           # 应用外壳
│   ├── config.ts         # 源站、模型、key、采样参数
│   ├── styles.css        # 设计 token 与组件类
│   ├── lib/              # api、chat、sse、markdown、hljs、
│   │                     # storage、theme、date、clipboard、tools、
│   │                     # attachments
│   ├── state/            # store、三个 slice、类型、持久化
│   └── ui/               # 展示型组件
├── proxy/
│   ├── handler.js        # 共享核心：CORS、注入 key、SSE 透传
│   ├── tools.js          # 工具接口：搜索、抓页面、认字、读文档
│   ├── server.mjs        # Node runner
│   ├── tunnel.mjs        # 本机代理加 Cloudflare 快速隧道
│   ├── doc_service.py    # 可选的文档服务：MarkItDown + RapidOCR
│   ├── doc.mjs           # 用机器上有的 python 起文档服务
│   ├── requirements-doc.txt
│   ├── searxng/          # 自建的 SearXNG，给搜索工具用
│   ├── deno.ts           # Deno Deploy 入口
│   ├── api/[...path].js # Vercel 入口，Node 运行时
│   ├── vercel/edge.ts    # Vercel Edge 入口
│   ├── vercel.json       # Vercel 路由
│   └── wrangler.toml     # Cloudflare Workers 配置
├── tools/
│   └── check-readme-parity.mjs
└── .github/workflows/
    ├── ci.yml            # 类型检查、README 同步检查、构建
    ├── deploy.yml        # 构建并发布到 GitHub Pages
    └── tunnel.yml        # 把代理托管在 GitHub Actions runner 上
```

### 状态是怎么分的

状态拆成三个 slice，共用一份类型模块，所以任何 slice 都不用 import 另一个 slice：

- `settingsSlice` 放运行时选项：主题、思考档位、工具开关、字号、发送键、自定义指令。
- `chatSlice` 放会话和流式生命周期。收到的 SSE 分片先进缓冲，再以每秒十二次左右的频率刷进 store，这样长答案不会每来一个 token 就重渲染一遍。工具循环也在这儿：工具调用跑完，结果回喂给模型，回答接着写进同一条消息。
- `uiSlice` 放侧边栏的开关、滚动位置、未读计数和 toast。

会话存在 IndexedDB（库 `free-chat`，一段会话一条记录），只写改过的那几条，400 毫秒防抖、最长 2 秒必写，切到后台或关页面时立刻写。设置和草稿在 `localStorage`（`freechat.prefs.v1`、`freechat.drafts.v1`）。同一浏览器的多个标签页通过 `BroadcastChannel` 互相通知改了哪几条。旧版本 `hippocrenes.chat.v2` 里的会话在第一次打开新版本时自动搬进 IndexedDB。

<a id="contribute"></a>
## 参与贡献

欢迎贡献。请先读 [CONTRIBUTING.md](CONTRIBUTING.md)：里面写了开发环境要求、提交前必须过的检查、视觉红线，以及发布流程。

<a id="license"></a>
## 许可证

以 MIT 许可证发布，完整文本见 [LICENSE](LICENSE)。

当前版本：`0.2.0`