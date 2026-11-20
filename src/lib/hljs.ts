import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'

/**
 * 只注册用得到的语言 —— 把 highlight.js 整个塞进包里会多出好几百 KB。
 */
const LANGS: Record<string, unknown> = {
  javascript,
  typescript,
  python,
  bash,
  json,
  xml,
  css,
  sql,
  go,
  rust,
  java,
  cpp,
  yaml,
  markdown,
}

const ALIAS: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  html: 'xml',
  svg: 'xml',
  xml_: 'xml',
  'c++': 'cpp',
  c: 'cpp',
  h: 'cpp',
  yml: 'yaml',
  md: 'markdown',
}

let registered = false

export function registerLanguages(): void {
  if (registered) return
  for (const [name, def] of Object.entries(LANGS)) {
    hljs.registerLanguage(name, def as never)
  }
  registered = true
}

/** 高亮一段代码；语言不认识就退回自动识别 */
export function highlightCode(code: string, lang: string): string {
  registerLanguages()
  const raw = lang.trim().toLowerCase()
  const key = ALIAS[raw] ?? raw
  if (key && hljs.getLanguage(key)) {
    try {
      return hljs.highlight(code, { language: key, ignoreIllegals: true }).value
    } catch {
      /* 落到自动识别 */
    }
  }
  try {
    return hljs.highlightAuto(code, Object.keys(LANGS)).value
  } catch {
    return escapeHtml(code)
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
