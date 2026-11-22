/**
 * 附件。
 *
 * 附件只在内存里 —— 不进 localStorage：一张截图就几百 KB，
 * localStorage 只有 5MB，塞几个就写不进去了。
 * 代价是刷新页面附件就没了，工具会明说这件事。
 *
 * 分两类：
 *   文本类 —— 全文当场读出来（.txt/.md/.json/代码…），**不离开用户机器**
 *   二进制类 —— 字节留着，等工具真的要用的时候才发给文档服务
 *              （PDF/Word/Excel/PPT 和图片）
 */

export type AttachmentKind = 'text' | 'document' | 'image'

export interface Attachment {
  id: string
  /** 给模型和工具用的名字：内容哈希 + 扩展名，比如 3f9a1c2e.png */
  name: string
  /** 上传时的原文件名，只给人看 */
  original: string
  size: number
  kind: AttachmentKind
  mime: string
  /** 文本类：全文已经读好了 */
  text?: string
  /** 二进制类：字节留在手上，要用的时候再传 */
  blob?: Blob
}

/** 文本文件能有多大 —— 再大就不适合整个塞进对话了 */
const MAX_TEXT_BYTES = 4 * 1024 * 1024

/** 二进制附件的上限 */
const MAX_BINARY_BYTES = 25 * 1024 * 1024

const TEXT_EXT =
  /\.(txt|md|markdown|mdx|json|jsonl|csv|tsv|log|yaml|yml|toml|ini|conf|env|xml|html?|css|scss|less|js|mjs|cjs|jsx|ts|tsx|py|go|rs|java|kt|kts|c|h|cpp|cc|hpp|cs|rb|php|sh|bash|zsh|fish|ps1|sql|lua|swift|vue|svelte|dockerfile|makefile|gitignore)$/i

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i

const DOCUMENT_EXT = /\.(pdf|docx?|xlsx?|pptx?|rtf|odt|ods|odp|epub|csv|tsv)$/i

/** 当前的附件。模块级 —— 工具执行的时候要按名字找回来。 */
const items = new Map<string, Attachment>()

function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** 靠扩展名和 mime 猜这是哪一类 */
export function classify(name: string, mime: string): AttachmentKind {
  if (mime.startsWith('text/')) return 'text'
  if (mime === 'application/json' || mime === 'application/xml') return 'text'
  if (IMAGE_EXT.test(name) || mime.startsWith('image/')) return 'image'
  if (DOCUMENT_EXT.test(name)) return 'document'
  if (TEXT_EXT.test(name)) return 'text'
  return 'document'
}

/** 扩展名：只留小写字母数字，没有就不带 */
function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim())
  return m ? `.${m[1].toLowerCase()}` : ''
}

/**
 * 内容哈希（SHA-256 前 8 位十六进制）。
 *
 * 原文件名里常有模型抄不对的字符（Mac 截图的 U+202F 空格、emoji、全角符号），
 * 所以工具一律用哈希名。没有 crypto.subtle（非 https 页面）时退回随机串。
 */
async function hashName(file: File): Promise<string> {
  let hex = ''
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 8)
  } catch {
    hex = Math.random().toString(16).slice(2, 10).padEnd(8, '0')
  }
  let name = hex + extOf(file.name)
  // 同一个文件传两次也不撞名
  for (let i = 2; [...items.values()].some((a) => a.name === name); i++) name = `${hex}-${i}${extOf(file.name)}`
  return name
}

/** 读一个文件，认出来是哪一类 */
export async function readAttachment(file: File): Promise<Attachment> {
  const kind = classify(file.name, file.type)
  const attachment: Attachment = {
    id: uid(),
    name: await hashName(file),
    original: file.name,
    size: file.size,
    kind,
    mime: file.type || '',
  }

  if (kind === 'text') {
    if (file.size > MAX_TEXT_BYTES) {
      // 太大了就只留前面一部分，并且说清楚
      const slice = file.slice(0, MAX_TEXT_BYTES)
      attachment.text = await slice.text()
      attachment.text += '\n\n（文件太大，只读进来了前面一部分。）'
    } else {
      attachment.text = await file.text()
    }
    return attachment
  }

  if (file.size > MAX_BINARY_BYTES) {
    throw new Error(`${file.name} 太大（${Math.round(file.size / 1024 / 1024)}MB），读不了`)
  }
  attachment.blob = file
  return attachment
}

/** 加一个文件 */
export async function addFile(file: File): Promise<Attachment> {
  const attachment = await readAttachment(file)
  items.set(attachment.id, attachment)
  return attachment
}

/** 去掉一个 */
export function removeAttachment(id: string): void {
  items.delete(id)
}

/** 全部 */
export function listAttachments(): Attachment[] {
  return [...items.values()]
}

/** 清空 */
export function clearAttachments(): void {
  items.clear()
}

/**
 * 按名字找一个附件。
 *
 * 模型给的名字未必跟上传时一模一样（可能改过大小写、可能带了路径），
 * 所以这里宽松一点：先精确匹配，再退到「包含」。
 */
/**
 * 比文件名之前先统一写法。
 *
 * Mac 截图的文件名在 AM/PM 前面是窄不换行空格（U+202F），
 * 模型抄文件名时会写成普通空格，原样比就对不上。
 * NFKC 把这类特殊空格、全角字符都折成普通写法，再把连续空白并成一个。
 */
function normName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function findAttachment(name: string): Attachment | undefined {
  // 模型偶尔把「（原名…）」一起抄过来
  const wanted = normName(name.split(/[（(]原名/)[0])
  if (!wanted) return undefined
  const base = wanted.split(/[\\/]/).pop() ?? wanted
  const all = listAttachments()
  // 先认哈希名，再认原文件名
  for (const key of [(a: Attachment) => a.name, (a: Attachment) => a.original]) {
    const named = all.map((a) => ({ a, n: normName(key(a)) }))
    const hit =
      named.find((x) => x.n === wanted) ?? named.find((x) => x.n === base) ?? named.find((x) => x.n.includes(base))
    if (hit) return hit.a
  }
  return undefined
}

/** 捎给模型的附件说明：哈希名在前，原名在括号里 */
export function describeAttachment(a: Attachment): string {
  return a.original && a.original !== a.name ? `${a.name}（原名「${a.original}」）` : a.name
}

/** 人话版的体积 */
export function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
