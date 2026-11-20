import { useState } from 'react'
import { Check, CloudArrowUp, Copy, Globe, PlugsConnected, Terminal } from '@phosphor-icons/react'
import { copyText } from '@/lib/clipboard'

/** 一行（可能多行）可复制的命令 */
function CommandBlock({ text }: { text: string }): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const onCopy = async (): Promise<void> => {
    const ok = await copyText(text)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="mt-2 flex items-start gap-1 rounded-md border border-line bg-surface-2 px-2 py-1.5">
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.7] text-ink-2">
        {text}
      </code>
      <button
        type="button"
        className="btn btn-ghost btn-icon shrink-0"
        onClick={() => void onCopy()}
        aria-label={copied ? '已复制' : '复制命令'}
        title={copied ? '已复制' : '复制'}
      >
        {copied ? <Check size={14} weight="bold" /> : <Copy size={14} weight="bold" />}
      </button>
    </div>
  )
}

interface RouteProps {
  icon: React.ReactNode
  title: string
  desc: string
  commands: string[]
  note?: string
}

/** 一条连接路径 —— 图标 + 标题 + 说明 + 命令 */
function Route({ icon, title, desc, commands, note }: RouteProps): React.ReactElement {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-muted">{icon}</span>
        <span className="text-[13px] font-medium text-ink">{title}</span>
      </div>
      <p className="mt-1 text-[12px] leading-[1.6] text-muted">{desc}</p>
      {commands.map((c) => (
        <CommandBlock key={c} text={c} />
      ))}
      {note && <p className="mt-1.5 text-[12px] leading-[1.6] text-faint">{note}</p>}
    </div>
  )
}

const LOCAL_CMD = 'API_KEY=sk-local-... npm run proxy'

const CF_SECRET_CMD = 'npx wrangler secret put API_KEY'
const CF_DEPLOY_CMD = 'npx wrangler deploy'

/**
 * 源站的 CORS 补丁。
 *
 * 源站一个 CORS 头都不返，而且 OPTIONS 预检会被它的鉴权层以 401 挡掉，
 * 所以这段必须由管理员加在 nginx 里 —— 前端绕不过去。
 */
const NGINX_SNIPPET = `# 加在 listen 1920 ssl; 那个 server 块里：
add_header Access-Control-Allow-Origin  $http_origin always;
add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
add_header Access-Control-Allow-Headers "Authorization, Content-Type" always;
if ($request_method = OPTIONS) { return 204; }`

export function SetupGuide(): React.ReactElement {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2">
        <PlugsConnected size={16} weight="bold" className="text-muted" />
        <span className="text-[13px] font-medium text-ink">怎么连上这个服务</span>
      </div>
      <p className="mt-1.5 text-[12px] leading-[1.6] text-muted">
        源站没有开放浏览器直连需要的 CORS 头，页面里的请求会被同源策略挡掉。
        三条路任选其一 —— 推荐第一条，不用注册、key 也留在本机。
      </p>

      <div className="mt-4 flex flex-col gap-5">
        <Route
          icon={<Terminal size={15} weight="bold" />}
          title="本地代理（零注册）"
          desc="在项目根目录跑起本地代理，key 留在你自己的机器上，浏览器根本拿不到它。"
          commands={[LOCAL_CMD]}
          note="然后把设置里的「代理地址」填成 http://127.0.0.1:8787"
        />

        <Route
          icon={<CloudArrowUp size={15} weight="bold" />}
          title="Cloudflare Workers（公开部署）"
          desc="README 里有「Deploy to Cloudflare」按钮。key 作为加密 secret 存在 Cloudflare 侧，浏览器同样看不到。"
          commands={[CF_SECRET_CMD, CF_DEPLOY_CMD]}
          note="部署完把 https://xxx.workers.dev 填进「代理地址」"
        />

        <Route
          icon={<Globe size={15} weight="bold" />}
          title="直连源站（需要管理员改 nginx）"
          desc="源站一个 CORS 头都不返，OPTIONS 预检还会被它的鉴权层以 401 挡掉，所以必须让服务器管理员补上这段。"
          commands={[NGINX_SNIPPET]}
          note="改完之后在设置里切到「直连源站」，地址填 https://182.92.245.176:1920"
        />
      </div>
    </div>
  )
}