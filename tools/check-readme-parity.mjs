#!/usr/bin/env node
// README.md / README.zh-CN.md 的章节骨架必须一致 —— 两份门面文档同步更新，别只改一份。
//
// 机器可读的标记长这样：
//   <!-- sections: intro features quickstart ... -->
//
// 规则来自仓库根的 WORKING-RULES：两份 README 必须同步改，门面分叉比内容旧更糟。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const en = read('README.md')
const zh = read('README.zh-CN.md')

const sections = (md) => {
  const m = md.match(/<!--\s*sections:\s*([a-z0-9,\-\s]+)\s*-->/i)
  return m ? m[1].trim().split(/[\s,]+/).filter(Boolean) : []
}

const problems = []

const a = sections(en)
const b = sections(zh)

if (a.length === 0) problems.push('README.md 缺少 <!-- sections: ... --> 章节清单标记')
if (b.length === 0) problems.push('README.zh-CN.md 缺少 <!-- sections: ... --> 章节清单标记')

if (a.length > 0 && b.length > 0) {
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
    problems.push('两份 README 的章节清单不一致')
    problems.push('  README.md      : ' + a.join(', '))
    problems.push('  README.zh-CN.md: ' + b.join(', '))
  }
}

// 两份 README 必须互相链接
if (!en.includes('README.zh-CN.md')) problems.push('README.md 没有链接到 README.zh-CN.md')
if (!zh.includes('README.md')) problems.push('README.zh-CN.md 没有链接到 README.md')

// 版本号必须和 package.json 一致
const pkg = JSON.parse(read('package.json'))
if (!en.includes(pkg.version)) problems.push(`README.md 里没有版本号 ${pkg.version}`)
if (!zh.includes(pkg.version)) problems.push(`README.zh-CN.md 里没有版本号 ${pkg.version}`)

// 英文门面不许混中文（代码块除外）
const enProse = en
  .replace(/```[\s\S]*?```/g, '')
  .replace(/`[^`]*`/g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
const cjk = enProse.match(/[\u4e00-\u9fff]/g)
if (cjk) problems.push('README.md 的正文里出现了中文（英文门面不许中英混写）')

if (problems.length) {
  for (const p of problems) console.error('✗ ' + p)
  process.exit(1)
}

console.log('✓ README 中英文同步（' + a.length + ' 个章节，版本 ' + pkg.version + '）')