/**
 * 空会话的首屏。
 *
 * 只有品牌字 —— 不放介绍文案、不放建议问题、不放连接指南。
 * 这个应用是给一个模型专用的，用不着教用户怎么用。
 */
export function EmptyState(): React.ReactElement {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <h1 className="font-serif text-[26px] tracking-[-0.02em] text-ink sm:text-[32px]">
        Hippocrene&apos;s Model Chat
      </h1>
    </div>
  )
}