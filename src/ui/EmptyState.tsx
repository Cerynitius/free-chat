/**
 * 空会话的首屏。
 *
 * 只有品牌字 —— 不放介绍文案、不放建议问题、不放连接指南。
 * 这个应用是给一个模型专用的，用不着教用户怎么用。
 *
 * 品牌字是「写」出来的：一个字一个字显影，写完留一道金线，
 * 光标闪几下就收起来。动画全在 CSS 里 —— 关掉动效偏好的人
 * 直接看到写完的样子，不看过程。
 */

/** 标题 —— 一笔一笔写出来的就是这几个字 */
const TITLE = 'Free Chat'

/** 每个字之间隔多久（毫秒）—— 写字的速度 */
const CHAR_DELAY_MS = 62

/** 第一个字什么时候开始写（毫秒） */
const START_DELAY_MS = 300

export function EmptyState(): React.ReactElement {
  return (
    <div className="welcome">
      <div className="welcome__inner">
        <h1 className="welcome__title">
          {TITLE.split('').map((ch, i) => (
            <span
              key={`${ch}-${i}`}
              className="welcome__char"
              /* 每个字错开一点点 —— 延迟直接算好写进 style，省一层自定义属性 */
              style={{ animationDelay: `${START_DELAY_MS + i * CHAR_DELAY_MS}ms` }}
            >
              {ch}
            </span>
          ))}
          <i className="welcome__caret" aria-hidden="true" />
        </h1>
        <span className="welcome__rule" aria-hidden="true" />
      </div>
    </div>
  )
}
