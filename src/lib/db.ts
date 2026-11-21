/**
 * 会话的本地存储：IndexedDB。
 *
 * 为什么不用 localStorage 了：它只有 5 MB 左右、整份 JSON 一次写，
 * 会话一多（或者有一段长回答）就写不进去，只能砍到最近 50 条。
 * IndexedDB 按会话一条一条存，配额是磁盘空间的一个比例，几百条会话也放得下。
 *
 * 设置、侧边栏状态、草稿这些小东西仍在 localStorage —— 同步读，
 * 主题在第一帧就能定下来，不闪。
 */
import type { Conversation } from '@/state/types'

const DB_NAME = 'free-chat'
const DB_VERSION = 1
const STORE = 'conversations'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('这个浏览器不支持 IndexedDB'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' })
        s.createIndex('updatedAt', 'updatedAt')
      }
    }
    req.onsuccess = () => {
      const db = req.result
      // 别的标签页升级了库 ⇒ 这边让路，下次用的时候重开
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打不开'))
    req.onblocked = () => reject(new Error('IndexedDB 被另一个标签页占着'))
  })
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('写入被中止'))
    tx.onerror = () => reject(tx.error ?? new Error('写入失败'))
  })
}

/** 读出全部会话（不保证顺序 —— 界面自己按时间排） */
export async function loadConversations(): Promise<Conversation[]> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const req = tx.objectStore(STORE).getAll()
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve((req.result as Conversation[]) ?? [])
    req.onerror = () => reject(req.error ?? new Error('读取失败'))
  })
}

/** 按 id 读几条会话（别的标签页改了哪几条，就只读哪几条） */
export async function getConversations(ids: string[]): Promise<Conversation[]> {
  if (!ids.length) return []
  const db = await openDb()
  const store = db.transaction(STORE, 'readonly').objectStore(STORE)
  const all = await Promise.all(
    ids.map(
      (id) =>
        new Promise<Conversation | undefined>((resolve, reject) => {
          const req = store.get(id)
          req.onsuccess = () => resolve(req.result as Conversation | undefined)
          req.onerror = () => reject(req.error ?? new Error('读取失败'))
        }),
    ),
  )
  return all.filter((c): c is Conversation => !!c)
}

/** 一个事务里写入 + 删除 —— 要么都成，要么都不成 */
export async function writeConversations(put: Conversation[], del: string[]): Promise<void> {
  if (!put.length && !del.length) return
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  for (const c of put) store.put(c)
  for (const id of del) store.delete(id)
  await done(tx)
}

export async function clearConversations(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).clear()
  await done(tx)
}

// ── 存储配额与持久化 ─────────────────────────────────────────

export interface StorageInfo {
  /** 已用字节（整个站点：IndexedDB + localStorage + 缓存） */
  usage: number | null
  /** 浏览器给这个站点的上限 */
  quota: number | null
  /** 是否已申请到「持久存储」—— 申请到了，浏览器清理空间时不会动这里的数据 */
  persisted: boolean | null
}

export async function storageInfo(): Promise<StorageInfo> {
  const s = navigator.storage
  if (!s) return { usage: null, quota: null, persisted: null }
  const [est, persisted] = await Promise.all([
    s.estimate ? s.estimate().catch(() => null) : Promise.resolve(null),
    s.persisted ? s.persisted().catch(() => null) : Promise.resolve(null),
  ])
  return { usage: est?.usage ?? null, quota: est?.quota ?? null, persisted }
}

/** 申请持久存储。Chrome 按使用情况静默批准或拒绝，Firefox 会弹一个询问 */
export async function requestPersist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
