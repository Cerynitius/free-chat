import { useApp } from '@/state/store'
import { MODEL } from '@/config'

/**
 * 空会话的首屏 —— 两种风格各一套。
 *
 *   网页对话：一句按时间问候的衬线大字，输入框就在它正下方（布局在 App 里居中）
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
      <div className="welcome__inner">
        <span className="welcome__mark" aria-hidden="true" />
        <h1 className="welcome__title">{greeting()}，今天想聊点什么？</h1>
      </div>
    </div>
  )
}

function TerminalWelcome(): React.ReactElement {
  return (
    <div className="term-welcome">
      <div className="term-welcome__box">
        <div className="term-welcome__title">
          <span className="term-accent">✻</span> 欢迎使用 <strong>Free Chat</strong>
        </div>
        <div className="term-welcome__line">
          模型 <span className="term-ink">{MODEL}</span> · 记录只存在这个浏览器里 · 无需注册
        </div>
        <div className="term-welcome__line term-dim">cwd: ruixiuzhang.com/freechat</div>
      </div>
      <div className="term-welcome__tips">
        <div className="term-dim">试试：</div>
        <div>
          <span className="term-dim">›</span> 解释一段代码，或者帮你写个脚本
        </div>
        <div>
          <span className="term-dim">›</span> 搜一下网上的最新消息（工具开着时会自己去查）
        </div>
        <div>
          <span className="term-dim">›</span> 按 <span className="term-ink">/</span> 回到输入框，<span className="term-ink">Ctrl+K</span> 搜索会话
        </div>
      </div>
    </div>
  )
}

export function EmptyState(): React.ReactElement {
  const ui = useApp((s) => s.settings.uiStyle)
  return ui === 'terminal' ? <TerminalWelcome /> : <WebWelcome />
}
