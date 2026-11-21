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
 * KaTeX 认不出来的命令，但模型很爱写。
 *
 * 这些命令在 LaTeX 里是给排版系统看的（标签、宏包、文档类），
 * 公式本身不依赖它们 —— 直接删掉，整段公式就能正常渲染。
 * 不删的话，一条 \label 就能让整块公式变成红字。
 */
function sanitizeLatex(src: string): string {
  return src
    .replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\\(?:nonumber|notag)\b/g, '')
    .replace(/\\(?:usepackage|documentclass)(?:\[[^\]]*\])?\s*\{[^}]*\}/g, '')
    .replace(/\\(?:begin|end)\{document\}/g, '')
    .trim()
}

/**
 * 渲染一段 LaTeX。
 *
 * ★ 解析失败时**不能**直接吐给用户 —— KaTeX 的 throwOnError:false
 *   会把整段源码涂成红色，一大坨红字比公式本身还难看。
 *   这里改成退回等宽原文：至少还能看懂、还能复制。
 */
function renderMath(body: string, displayMode: boolean): string {
  const clean = sanitizeLatex(body)
  try {
    return katex.renderToString(clean, {
      displayMode,
      throwOnError: true,
      output: 'html',
    })
  } catch {
    const raw = escapeHtml(body.trim())
    return displayMode
      ? `<pre class="math-raw">${raw}</pre>`
      : `<code class="math-raw">${raw}</code>`
  }
}

/**
 * 数学公式。
 *
 * 认四套写法：
 *   $...$      行内
 *   $$...$$    独立成块（行首或夹在段落里都算）
 *   \(...\)    LaTeX 惯用的行内写法
 *   \[...\]    LaTeX 惯用的块级写法
 *
 * 手写 core rule，不引入 markdown-it-texmath —— 后者与 markdown-it 15 的
 * 兼容性没验证过，而这里只需要最基础的几条规则。
 */
function mathPlugin(m: MdType): void {
  /**
   * 行首的块级公式：`$$ ... $$` 或 `\[ ... \]`。
   *
   * 块级规则逐行试 —— 段落一旦被 paragraph 规则吃掉，
   * 段里的 `$$` 就轮到行内规则处理了（见下）。
   */
  m.block.ruler.before(
    'paragraph',
    'math_block',
    (state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean => {
      const start = state.bMarks[startLine] + state.tShift[startLine]
      const max = state.eMarks[startLine]
      const first = state.src.slice(start, max)
      const trimmedFirst = first.trim()

      // `$$` 开头
      if (trimmedFirst.startsWith('$$')) {
        const rest = trimmedFirst.slice(2)
        // 同一行闭合：$$ x = 1 $$
        const closeIdx = rest.indexOf('$$')
        if (closeIdx !== -1) {
          if (silent) return true
          const token = state.push('math_block', 'math', 0)
          token.content = rest.slice(0, closeIdx).trim()
          token.map = [startLine, startLine + 1]
          state.line = startLine + 1
          return true
        }
        // 跨行：往下找收尾的 $$
        let nextLine = startLine
        let content = ''
        let closed = false
        while (nextLine + 1 < endLine) {
          nextLine++
          const s = state.bMarks[nextLine] + state.tShift[nextLine]
          const e = state.eMarks[nextLine]
          const line = state.src.slice(s, e).trim()
          // 收尾的那一行可能自己也是 `$$ x = 1 $$` 这种带开头的 ——
          // 按第一个 `$$` 截，别把开头那个也带进公式里
          const closeAt = line.indexOf('$$')
          if (closeAt !== -1) {
            content += (content ? '\n' : '') + line.slice(0, closeAt)
            closed = true
            break
          }
          content += (content ? '\n' : '') + line
        }
        if (!closed) return false
        if (silent) return true
        const token = state.push('math_block', 'math', 0)
        token.content = content.trim()
        token.map = [startLine, nextLine + 1]
        state.line = nextLine + 1
        return true
      }

      // `\[` 开头
      if (trimmedFirst.startsWith('\\[')) {
        let nextLine = startLine
        let content = trimmedFirst.slice(2)
        let closed = false
        // 同一行闭合：\[ x = 1 \]
        const closeIdx = content.indexOf('\\]')
        if (closeIdx !== -1) {
          content = content.slice(0, closeIdx)
          closed = true
        } else {
          while (nextLine + 1 < endLine) {
            nextLine++
            const s = state.bMarks[nextLine] + state.tShift[nextLine]
            const e = state.eMarks[nextLine]
            const line = state.src.slice(s, e).trim()
            const idx = line.indexOf('\\]')
            if (idx !== -1) {
              content += '\n' + line.slice(0, idx)
              closed = true
              break
            }
            content += '\n' + line
          }
        }
        if (!closed) return false
        if (silent) return true
        const token = state.push('math_block', 'math', 0)
        token.content = content.trim()
        token.map = [startLine, nextLine + 1]
        state.line = nextLine + 1
        return true
      }

      return false
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  )

  /**
   * 行内公式。
   *
   * `$...$` 只在行内找配对（跨行的 $ 交给块级规则）；
   * `$$...$$` 允许跨行 —— 段落里夹一个独立公式是常见写法。
   */
  m.inline.ruler.before('escape', 'math_inline', (state: StateInline, silent: boolean): boolean => {
    const src = state.src
    const pos = state.pos
    const ch = src[pos]

    // `\(` 与 `\[`：LaTeX 惯用写法
    if (ch === '\\' && (src[pos + 1] === '(' || src[pos + 1] === '[')) {
      // 前一个字符是反斜杠 ⇒ 那是转义出来的反斜杠，不是公式
      if (pos > 0 && src[pos - 1] === '\\') return false
      const open = src.slice(pos, pos + 2)
      const close = open === '\\(' ? '\\)' : '\\]'
      const end = src.indexOf(close, pos + 2)
      if (end === -1) return false
      const body = src.slice(pos + 2, end)
      if (!body.trim()) return false
      if (!silent) {
        const token = state.push('math_inline', 'math', 0)
        token.content = body
        token.markup = open === '\\(' ? 'inline' : 'block'
      }
      state.pos = end + 2
      return true
    }

    if (ch !== '$') return false

    // 前一个字符是字母数字 ⇒ 多半是「US$5」这种，不是公式
    if (pos > 0 && /[A-Za-z0-9]/.test(src[pos - 1])) return false

    // `$$` —— 段落里的独立公式，允许跨行
    if (src[pos + 1] === '$') {
      const end = src.indexOf('$$', pos + 2)
      if (end === -1) return false
      const body = src.slice(pos + 2, end)
      if (!body.trim()) return false
      if (!silent) {
        const token = state.push('math_inline', 'math', 0)
        token.content = body
        token.markup = 'block'
      }
      state.pos = end + 2
      return true
    }

    // `$...$` —— 只在行内找配对
    let end = -1
    for (let i = pos + 1; i < src.length; i++) {
      const c = src[i]
      if (c === '\\') {
        i++
        continue
      }
      if (c === '\n') break
      if (c === '$') {
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
      token.markup = 'inline'
    }
    state.pos = end + 1
    return true
  })

  m.renderer.rules.math_block = (tokens: Token[], idx: number) =>
    `<div class="math-block">${renderMath(tokens[idx].content, true)}</div>`

  m.renderer.rules.math_inline = (tokens: Token[], idx: number) => {
    const token = tokens[idx]
    const display = token.markup === 'block'
    const body = renderMath(token.content, display)
    // 段落里的独立公式：KaTeX 输出的是 span（display:block 由 CSS 负责），
    // 塞在 <p> 里也合法 —— 用 div 反而会把段落结构撑坏。
    return display ? `<span class="math-inline-display">${body}</span>` : body
  }
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
