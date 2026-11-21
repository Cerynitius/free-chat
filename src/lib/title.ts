/**
 * 会话标题。
 *
 * 标题要在侧边栏里一眼扫过去 —— 所以规矩只有两条：
 *   短（最多 MAX_TITLE_LEN 个字）
 *   像标题（不是把用户的第一句话拦腰砍断）
 */

/** 标题最多这么多个字 —— 侧边栏一行放不下更多，硬截不如不截。 */
export const MAX_TITLE_LEN = 30

/** 找句读时最多往后看这么多个字 —— 再长就不像标题了 */
const SENTENCE_SCAN = 40

/** 标题里不许有的东西：换行、引号、markdown 记号 */
const NOISE = /[\r\n\t"'`*_#>|[\]（）()]/g

/** 首尾的引号 —— 模型爱给标题加引号 */
const QUOTES = /^["'「『《【\s]+|["'」』》】\s]+$/g

/** 句末的标点 —— 收尾时切掉 */
const TAIL_PUNCT = /[。！？!?；;，,、\s]+$/

/**
 * 洗一个标题：去掉噪声、压空白、限长。
 *
 * 模型给的标题常带着「《》」引号或者结尾的句号 —— 去掉。
 */
export function cleanTitle(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim()
  const unquoted = flat.replace(QUOTES, '').replace(TAIL_PUNCT, '').trim()
  const stripped = unquoted.replace(NOISE, '').trim()
  return (stripped || unquoted || flat).slice(0, MAX_TITLE_LEN).trim()
}

/**
 * 从用户的第一句话里抠一个像样的标题出来。
 *
 * 这是**兜底**：模型给的标题更好，但模型可能慢、可能失败 ——
 * 所以先本地抠一个顶上，界面上永远有名字。
 *
 * 抠法：去掉代码块和行内代码（那些不是标题），
 * 压成一行，在第一个句读处收住，再限长。
 */
export function deriveTitle(text: string): string {
  const stripped = text
    // 围栏代码块 —— 整块拿掉
    .replace(/```[\s\S]*?```/g, ' ')
    // 行内代码
    .replace(/`[^`\n]*`/g, ' ')
    // 引用 / 列表 / 标题的记号
    .replace(/^\s*[>#\-*+]\s+/gm, ' ')
    // markdown 强调记号
    .replace(/[*_]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!stripped) return ''

  // 在第一个句读处收住 —— 一句话通常就是一件事
  const m = new RegExp(`^.{1,${SENTENCE_SCAN}}?[。！？!?；;，,、]`).exec(stripped)
  let cut = m ? m[0] : stripped.slice(0, MAX_TITLE_LEN)

  cut = cut.replace(TAIL_PUNCT, '').trim()
  if (!cut) cut = stripped.slice(0, MAX_TITLE_LEN).trim()

  return cut.slice(0, MAX_TITLE_LEN).trim()
}
