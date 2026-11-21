import { useApp } from '@/state/store'
import { MODEL } from '@/config'

/**
 * 空会话的首屏 —— 两种风格各一套。
 *
 *   网页对话：一句按时间问候的大字，输入框和起手式在它正下方（布局在 App 里居中）
 *   终端    ：一个带边框的欢迎框，像命令行工具启动时打印的那一屏
 *
 * 动画全在 CSS 里；不喜欢动效的人直接看到最终样子。
 */

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 13) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

function WebWelcome(): React.ReactElement {
  return (
    <div className="welcome">
      <h1 className="welcome__title">{greeting()}，想聊点什么？</h1>
    </div>
  )
}

/** 新会话时挂在输入框下面的几个起手式 —— 点一下填进输入框，不直接发 */
export const STARTERS: { label: string; text: string }[] = [
  { label: '写点东西', text: '帮我写一段' },
  { label: '学点知识', text: '用通俗的话给我讲讲' },
  { label: '写代码', text: '帮我写一个脚本，' },
  { label: '查最新消息', text: '搜一下最近关于' },
  { label: '出主意', text: '我在纠结' },
]

export function Starters({ onPick }: { onPick: (text: string) => void }): React.ReactElement {
  return (
    <div className="starters">
      {STARTERS.map((s) => (
        <button key={s.label} type="button" className="starters__chip" onClick={() => onPick(s.text)}>
          {s.label}
        </button>
      ))}
    </div>
  )
}

function TerminalWelcome(): React.ReactElement {
  return (
    <div className="term-welcome">
      <div className="term-welcome__box">
        <div className="term-welcome__title">
          <span className="term-accent">✻</span> 欢迎使用 <strong>Free Chat</strong>！
        </div>
        <div className="term-welcome__line term-dim">
          模型 {MODEL} · 记录只存在这个浏览器里
        </div>
        <div className="term-welcome__line term-dim">cwd: ruixiuzhang.com/freechat</div>
      </div>
      <div className="term-welcome__tips">
        <div className="term-dim">上手提示：</div>
        <ol>
          <li>直接问问题，或者贴一段代码让它解释</li>
          <li>工具开着的时候，它会自己上网搜、读网页</li>
          <li>
            <span className="term-ink">/</span> 回到输入框，<span className="term-ink">Ctrl+K</span> 搜索会话
          </li>
        </ol>
      </div>
    </div>
  )
}

export function EmptyState(): React.ReactElement {
  const ui = useApp((s) => s.settings.uiStyle)
  return ui === 'terminal' ? <TerminalWelcome /> : <WebWelcome />
}
