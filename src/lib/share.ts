/**
 * 分享：把会话编码进 URL hash，纯客户端，不需要后端。
 *
 * 形如  #s=<base64url(JSON)>
 * 打开带 hash 的链接时，应用导入这份对话，但**不覆盖本地历史**。
 */

const PREFIX = '#s='

export function encodeConversation(conversation: unknown): string {
  const json = JSON.stringify(conversation)
  const bytes = new TextEncoder().encode(json)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeConversation<T>(hash: string): T | null {
  if (!hash.startsWith(PREFIX)) return null
  const raw = hash.slice(PREFIX.length)
  if (!raw) return null
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (raw.length % 4)) % 4)
    const bin = atob(b64)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    return null
  }
}

export function buildShareUrl(conversation: unknown): string {
  const base = `${location.origin}${location.pathname}`
  return `${base}${PREFIX}${encodeConversation(conversation)}`
}

/** 当前 URL 里是不是带着分享内容 */
export function hasSharedHash(hash = location.hash): boolean {
  return hash.startsWith(PREFIX) && hash.length > PREFIX.length
}
