import { useMemo } from 'react'
import { renderMarkdown } from '@/lib/markdown'
import { CodeBlock } from './CodeBlock'

/**
 * Markdown 渲染。
 *
 * 代码块被 markdown-it 的 fence 规则替换成了占位 div，切段之后由 CodeBlock
 * 组件接手 —— 这样复制按钮是真正的 React 组件，能带图标、能响应状态，
 * 而不是往 DOM 里塞黑魔法。
 */
export function Markdown({ content }: { content: string }): React.ReactElement {
  const segments = useMemo(() => renderMarkdown(content), [content])

  return (
    <div className="prose-chat">
      {segments.map((seg, i) =>
        seg.kind === 'code' ? (
          <CodeBlock key={i} code={seg.code} lang={seg.lang} />
        ) : (
          <div key={i} className="prose-seg" dangerouslySetInnerHTML={{ __html: seg.html }} />
        ),
      )}
    </div>
  )
}
