/**
 * Markdown → 纯文本。
 *
 * 「复制」要的是能直接粘到别处的样子：没有井号、没有星号、
 * 没有链接地址 —— 只剩人能读的那部分。
 *
 * 公式保持 $...$ 原样 —— 去掉定界符的话，LaTeX 源码就散成一堆看不懂的碎片了。
 */
export function markdownToText(src: string): string {
  if (!src) return ''

  const lines = src.split('\n')
  const out: string[] = []
  let inFence = false

  for (const line of lines) {
    const fence = /^\s*(```|~~~)/.test(line)
    if (fence) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      // 代码块：留代码，去掉围栏
      out.push(line)
      continue
    }

    let t = line
    // 图片 → 只留 alt
    t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // 链接 → 文字 + 地址
    t = t.replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1 ($2)')
    // 引用 / 列表 / 标题的记号
    t = t.replace(/^\s*>\s?/, '')
    t = t.replace(/^\s*[-*+]\s+/, '')
    t = t.replace(/^\s*\d+[.)]\s+/, '')
    t = t.replace(/^\s*#{1,6}\s+/, '')
    // 分隔线
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(t)) continue
    // 行内代码：留内容，去掉反引号
    t = t.replace(/`([^`]+)`/g, '$1')
    // 强调记号
    t = t.replace(/(\*\*|__|\*|_|~~)/g, '')
    // 表格的竖线
    t = t.replace(/\|/g, ' ')

    out.push(t.replace(/[ \t]+$/, ''))
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
