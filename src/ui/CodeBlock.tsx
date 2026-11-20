import { useMemo, useState } from 'react'
import { Check, Copy } from '@phosphor-icons/react'
import { highlightCode } from '@/lib/hljs'
import { copyText } from '@/lib/clipboard'

export function CodeBlock({ code, lang }: { code: string; lang: string }): React.ReactElement {
  const html = useMemo(() => highlightCode(code, lang), [code, lang])
  const [copied, setCopied] = useState(false)

  const onCopy = async (): Promise<void> => {
    const ok = await copyText(code)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="code-block">
      <div className="code-block__head">
        <span className="code-block__lang">{lang || 'text'}</span>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onCopy}
          aria-label={copied ? '已复制' : '复制代码'}
          title={copied ? '已复制' : '复制代码'}
        >
          {copied ? <Check size={15} weight="bold" /> : <Copy size={15} weight="bold" />}
        </button>
      </div>
      <div className="code-block__pre">
        <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}
