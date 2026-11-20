import { useApp } from '@/state/store'
import { SetupGuide } from './SetupGuide'

interface Props {
  onPick: (text: string) => void
}

/**
 * 空会话的首屏。
 *
 * 建议必须是「具体到能直接开工」的问题 —— 泛泛的「介绍一下你自己」只会让人
 * 多打一行字，实际价值为零。
 */
const SUGGESTIONS: { text: string; label: string }[] = [
  {
    label: '写代码 + 单测',
    text: '写一个带重试和超时的 fetch 封装，给出 TypeScript 实现和单元测试',
  },
  {
    label: '讲清楚原理',
    text: '解释 Transformer 的多头注意力，给出一个最小的可运行实现',
  },
  {
    label: '跨语言改写',
    text: '把下面这段 Python 并发爬虫改写成 Go，并说明取舍',
  },
  {
    label: '系统设计',
    text: '为一个日活百万的 IM 系统设计消息存储方案',
  },
]

export function EmptyState({ onPick }: Props): React.ReactElement {
  const settings = useApp((s) => s.settings)

  // 只有「代理模式但没填地址」才算没配好 —— 直连模式地址有默认值
  const notConfigured = settings.mode === 'proxy' && !settings.proxyUrl.trim()

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col">
        <h1 className="font-serif text-[28px] leading-[1.25] tracking-[-0.02em] text-ink sm:text-[34px]">
          聊点什么？
        </h1>
        <p className="mt-2 max-w-xl text-[14px] leading-[1.7] text-muted">
          一个直连 DeepSeek 兼容接口的流式对话前端 —— 支持思考过程、代码高亮与公式渲染。
          随便说点具体的，效果比客套话好得多。
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.text}
              type="button"
              onClick={() => onPick(s.text)}
              className="group flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-faint hover:bg-surface-2"
            >
              <span className="tag shrink-0 normal-case">{s.label}</span>
              <span className="text-[13px] leading-[1.5] text-ink-2 group-hover:text-ink">
                {s.text}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-8">
          {notConfigured ? (
            <SetupGuide />
          ) : (
            <p className="text-[12px] leading-[1.6] text-muted">
              已经连到{' '}
              <span className="font-mono text-ink-2">
                {settings.mode === 'proxy' ? settings.proxyUrl : settings.baseUrl}
              </span>
              。想换地址、换模型或调参数，点右上角的齿轮进设置。
            </p>
          )}
        </div>
      </div>
    </div>
  )
}