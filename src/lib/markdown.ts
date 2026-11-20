import MarkdownIt from 'markdown-it'
import type { Env, MarkdownIt as MdType, StateBlock, StateInline, Token } from 'markdown-it'
import DOMPurify from 'dompurify'
import katex from 'katex'
import { escapeHtml, registerLanguages } from './hljs'

/**
 * 渲染结果的分段：
 *   html  —— 已经过 DOMPurify 的 HTML 片段
 *   code  —— 代码块，交给 React 组件渲染（复制按钮是真组件，不是 DOM 黑魔法）
 */
export type Segment =
  | { kind: 'html'; html: string }
  | { kind: 'code'; code: string; lang: string }

interface RenderEnv {
  codeBlocks: { code: string; lang: string }[]
  // markdown-it 的 Env 带了索引签名，这里也得有，否则传不进去
  [key: string | symbol]: unknown
}

const md = new MarkdownIt({
  html: false, // 模型偶尔会吐原始 HTML，关掉它，再叠一层 DOMPurify
  linkify: true,
  breaks: true, // 聊天里单换行就该换行
  typographer: false, // 别把 -- 变成 –，中文语境下更糟
})

/**
 * 数学公式：$...$ 行内、$$...$$ 独立成块。
 *
 * 手写 core rule，不引入 markdown-it-texmath —— 后者与 markdown-it 15 的
 * 兼容性没验证过，而这里只需要最基础的两条规则。
 */
function mathPlugin(m: MdType): void {
  // 块级：整行以 $$ 开头，找配对的 $$
  m.block.ruler.before(
    'paragraph',
    'math_block',
    (state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean => {
      const start = state.bMarks[startLine] + state.tShift[startLine]
      const max = state.eMarks[startLine]
      const first = state.src.slice(start, max)
      if (!first.startsWith('$$')) return false

      let nextLine = startLine
      // 第一行 $$ 之后剩下的部分
      const rest = first.slice(2)
      let content = rest
      let closed = false

      // 同一行闭合：$$ x = 1 $$
      const closeIdx = rest.indexOf('$$')
      if (closeIdx !== -1) {
        content = rest.slice(0, closeIdx)
        closed = true
      } else {
        // 跨行：从下一行开始找收尾的 $$
        while (nextLine + 1 < endLine) {
          nextLine++
          const s = state.bMarks[nextLine] + state.tShift[nextLine]
          const e = state.eMarks[nextLine]
          const line = state.src.slice(s, e)
          const trimmed = line.trim()
          if (trimmed.endsWith('$$')) {
            content += '\n' + trimmed.slice(0, -2)
            closed = true
            break
          }
          content += '\n' + line
        }
      }
      if (!closed) return false

      if (!silent) {
        const token = state.push('math_block', 'math', 0)
        token.content = content.trim()
        token.map = [startLine, nextLine + 1]
      }
      state.line = nextLine + 1
      return true
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  )

  // 行内：$...$
  m.inline.ruler.before('escape', 'math_inline', (state: StateInline, silent: boolean): boolean => {
    const src = state.src
    const pos = state.pos
    if (src[pos] !== '$') return false
    if (src[pos + 1] === '$') return false // $$ 交给块级规则

    let end = -1
    for (let i = pos + 1; i < src.length; i++) {
      const ch = src[i]
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === '\n') break
      if (ch === '$') {
        end = i
        break
      }
    }
    if (end === -1 || end === pos + 1) return false

    // 收紧边界：$ 后面不能是空格，$ 前面不能是空格 —— 否则会把「$5 和 $10」当公式
    const body = src.slice(pos + 1, end)
    if (/^\s/.test(body) || /\s$/.test(body)) return false

    if (!silent) {
      const token = state.push('math_inline', 'math', 0)
      token.content = body
      token.markup = '$'
    }
    state.pos = end + 1
    return true
  })

  m.renderer.rules.math_block = (tokens: Token[], idx: number) =>
    `<div class="math-block">${katex.renderToString(tokens[idx].content, {
      displayMode: true,
      throwOnError: false,
      output: 'html',
    })}</div>`

  m.renderer.rules.math_inline = (tokens: Token[], idx: number) =>
    katex.renderToString(tokens[idx].content, {
      displayMode: false,
      throwOnError: false,
      output: 'html',
    })
}

md.use(mathPlugin)

/**
 * 代码块不进 HTML —— fence 规则只吐一个占位 div，真正的代码块交给 React 组件。
 * 这样复制按钮是真正的组件，能带图标、能响应状态。
 */
md.renderer.rules.fence = (tokens: Token[], idx: number, _opts: unknown, env: Env | undefined) => {
  const token = tokens[idx]
  const lang = token.info.trim().split(/\s+/)[0] ?? ''
  const e = env as unknown as RenderEnv
  e.codeBlocks.push({ code: token.content, lang })
  return `<div data-code="${e.codeBlocks.length - 1}"></div>`
}

/** 段落里的行内代码也要高亮 */
md.renderer.rules.code_inline = (tokens: Token[], idx: number) =>
  `<code>${escapeHtml(tokens[idx].content)}</code>`

registerLanguages()

const PLACEHOLDER = /<div data-code="(\d+)"><\/div>/g

/**
 * 把一段 Markdown 渲染成可交给 React 的分段。
 *
 * 顺序很重要：
 *   1. markdown-it 渲染（数学已经变成 KaTeX HTML，代码块变成占位 div）
 *   2. 按占位 div 切开 —— 代码块段落变成 {kind:'code'}
 *   3. 其余段落过一遍 DOMPurify
 */
export function renderMarkdown(src: string): Segment[] {
  if (!src) return []
  const env: RenderEnv = { codeBlocks: [] }
  const html = md.render(src, env)

  const segments: Segment[] = []
  let last = 0
  PLACEHOLDER.lastIndex = 0

  for (let m = PLACEHOLDER.exec(html); m !== null; m = PLACEHOLDER.exec(html)) {
    const before = html.slice(last, m.index)
    if (before.trim()) {
      segments.push({ kind: 'html', html: sanitize(before) })
    }
    const block = env.codeBlocks[Number(m[1])]
    if (block) segments.push({ kind: 'code', code: block.code, lang: block.lang })
    last = m.index + m[0].length
  }

  const tail = html.slice(last)
  if (tail.trim()) segments.push({ kind: 'html', html: sanitize(tail) })

  return segments
}

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  })
}
