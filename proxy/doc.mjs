#!/usr/bin/env node
/**
 * 起文档服务 —— 找一个能用的 python，把 doc_service.py 跑起来。
 *
 * 为什么不直接在 npm script 里写 "python proxy/doc_service.py"：
 * 各家机器上 python 叫法不一样（python3 / python / py -3），
 * 写死一个总有机器跑不起来。这里挨个试。
 *
 * 用法：
 *     npm run doc
 *     npm run doc -- --port 9000
 */
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, 'doc_service.py')
const rest = process.argv.slice(2)

/** 挨个试 —— 谁先答应就用谁 */
const CANDIDATES = [
  { cmd: 'python3', args: [] },
  { cmd: 'python', args: [] },
  { cmd: 'py', args: ['-3'] },
]

let chosen = null
for (const candidate of CANDIDATES) {
  const probe = spawnSync(candidate.cmd, [...candidate.args, '--version'], { stdio: 'ignore' })
  if (probe.status === 0) {
    chosen = candidate
    break
  }
}

if (!chosen) {
  console.error(
    '[doc] 找不到 python。装一个 3.10 以上的（Windows 上可以下 python.org，' +
      '或者用 conda / venv），然后再 pip install -r proxy/requirements-doc.txt。',
  )
  process.exit(1)
}

const child = spawn(chosen.cmd, [...chosen.args, script, ...rest], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
