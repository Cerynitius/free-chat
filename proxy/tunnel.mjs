#!/usr/bin/env node
/**
 * 一键起「本地代理 + Cloudflare 隧道」，并把隧道地址同步到仓库变量、触发 Pages 重新部署。
 *
 * 为什么需要它：
 *   源站 https://182.92.245.176:1920 只接受 TLS + 裸 IP（证书只有 IP SAN，没有域名），
 *   而 Cloudflare Workers 的边缘不允许直连裸 IP（错误 1003）、也不校验到能用的证书主机名
 *   （错误 526）。所以 Worker 这条路走不通 —— 代理必须跑在一台**有完整网络访问权**的机器上。
 *
 *   本机跑代理 + cloudflared 隧道，就是这样一台机器：
 *     浏览器 -> GitHub Pages  -> 隧道(trycloudflare) -> 本机代理 -> 源站
 *
 * 隧道地址每次重启都会变。这个脚本会把它写进仓库变量 VITE_PROXY_URL 并重新部署 Pages，
 * 所以隧道重启后站点会自动跟上，不用手动改配置。
 *
 * 用法：
 *   API_KEY=sk-local-xxx npm run tunnel
 */
import { spawn, execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const REPO = process.env.REPO ?? 'JiHuiYiYou/hippocrenes-model-chat'
const PORT = Number(process.env.PORT ?? 8787)
const SYNC = process.env.NO_SYNC !== '1'

/** API key：先看环境变量，再看 proxy/.dev.vars（wrangler 本地开发用的那份） */
function readKey() {
  if (process.env.API_KEY) return process.env.API_KEY.trim()
  const vars = join(here, '.dev.vars')
  if (existsSync(vars)) {
    const m = readFileSync(vars, 'utf8').match(/^API_KEY\s*=\s*(.+)$/m)
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return ''
}

function cloudflaredPath() {
  const local = join(here, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
  return existsSync(local) ? local : 'cloudflared'
}

const key = readKey()
if (!key) {
  console.error('没找到 API key —— 设环境变量 API_KEY，或在 proxy/.dev.vars 里写一行 API_KEY=...')
  process.exit(1)
}

console.log('[tunnel] 起本地代理 :' + PORT)
const server = spawn(process.execPath, [join(here, 'server.mjs')], {
  cwd: root,
  env: { ...process.env, API_KEY: key, PORT: String(PORT) },
  stdio: 'inherit',
})

console.log('[tunnel] 起 Cloudflare 隧道...')
const tunnel = spawn(cloudflaredPath(), ['tunnel', '--url', 'http://127.0.0.1:' + PORT, '--no-autoupdate'], {
  cwd: here,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let synced = ''
function onUrl(url) {
  console.log('[tunnel] 隧道地址: ' + url)
  if (!SYNC || url === synced) return
  synced = url
  run('gh', ['variable', 'set', 'VITE_PROXY_URL', '--body', url, '--repo', REPO])
    .then(() => run('gh', ['workflow', 'run', 'deploy.yml', '--repo', REPO, '--ref', 'main']))
    .then(() => console.log('[tunnel] 已同步仓库变量并触发部署'))
    .catch((e) => console.error('[tunnel] 同步失败：' + e.message))
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: root, shell: process.platform === 'win32' }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || stdout || err.message))
      else resolve(stdout)
    })
  })
}

function scan(text) {
  const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
  if (m) onUrl(m[0])
}
tunnel.stdout.on('data', (d) => scan(d.toString()))
tunnel.stderr.on('data', (d) => scan(d.toString()))

function shutdown() {
  server.kill()
  tunnel.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
tunnel.on('exit', (code) => {
  console.log('[tunnel] 隧道进程退出（code=' + code + '）')
  shutdown()
})