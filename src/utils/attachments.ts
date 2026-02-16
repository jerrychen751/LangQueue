import type { AttachmentExportRecord, AttachmentKind, AttachmentRef } from '../types'

const ATTACHMENTS_DB_NAME = 'langqueue_attachments'
const ATTACHMENTS_STORE_NAME = 'attachments'
const ATTACHMENTS_DB_VERSION = 1
const CHUNK_DEFAULT_BYTES = 64 * 1024

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

const ALLOWED_MIME_PATTERNS = [
  /^image\//i,
  /^application\/pdf$/i,
  /^text\/plain$/i,
  /^text\/markdown$/i,
  /^text\/csv$/i,
  /^application\/msword$/i,
  /^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/i,
] as const

const ALLOWED_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'pdf',
  'txt',
  'md',
  'csv',
  'doc',
  'docx',
])

type StoredAttachmentRecord = AttachmentRef & {
  bytes: ArrayBuffer
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(ATTACHMENTS_DB_NAME, ATTACHMENTS_DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(ATTACHMENTS_STORE_NAME)) {
          db.createObjectStore(ATTACHMENTS_STORE_NAME, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error || new Error('Failed to open attachments database'))
    })
  }
  return dbPromise
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `a_${crypto.randomUUID()}`
  }
  return `a_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function extFromName(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx < 0) return ''
  return name.slice(idx + 1).toLowerCase()
}

function matchesAllowedMime(mime: string): boolean {
  if (!mime) return false
  return ALLOWED_MIME_PATTERNS.some((pattern) => pattern.test(mime))
}

export function inferAttachmentKind(mimeType: string): AttachmentKind {
  return /^image\//i.test(mimeType) ? 'image' : 'file'
}

export function isAllowedAttachment(file: Pick<File, 'type' | 'name'>): boolean {
  if (matchesAllowedMime(file.type || '')) return true
  const ext = extFromName(file.name || '')
  return ext ? ALLOWED_EXTENSIONS.has(ext) : false
}

export function validateAttachmentFile(file: Pick<File, 'size' | 'type' | 'name'>): string | null {
  if (!file || typeof file.size !== 'number' || typeof file.name !== 'string') {
    return 'Invalid attachment payload.'
  }
  if (file.size <= 0) return 'Attachment is empty.'
  if (file.size > MAX_ATTACHMENT_BYTES) return 'Attachment exceeds 25 MB limit.'
  if (!isAllowedAttachment(file)) return 'Unsupported file type.'
  return null
}

function txRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'))
  })
}

async function putRecord(record: StoredAttachmentRecord): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(ATTACHMENTS_STORE_NAME, 'readwrite')
  const store = tx.objectStore(ATTACHMENTS_STORE_NAME)
  await txRequest(store.put(record))
}

async function getRecord(id: string): Promise<StoredAttachmentRecord | null> {
  const db = await openDB()
  const tx = db.transaction(ATTACHMENTS_STORE_NAME, 'readonly')
  const store = tx.objectStore(ATTACHMENTS_STORE_NAME)
  const result = await txRequest(store.get(id))
  return (result as StoredAttachmentRecord | undefined) ?? null
}

export async function saveAttachmentFile(file: File): Promise<AttachmentRef> {
  const validation = validateAttachmentFile(file)
  if (validation) throw new Error(validation)
  const bytes = await file.arrayBuffer()
  const mimeType = file.type || 'application/octet-stream'
  const ref: AttachmentRef = {
    id: makeId(),
    name: file.name || 'attachment',
    mimeType,
    size: bytes.byteLength,
    kind: inferAttachmentKind(mimeType),
    createdAt: Date.now(),
  }
  await putRecord({ ...ref, bytes })
  return ref
}

export async function getAttachmentMeta(id: string): Promise<AttachmentRef | null> {
  const record = await getRecord(id)
  if (!record) return null
  return {
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    size: record.size,
    kind: record.kind,
    createdAt: record.createdAt,
  }
}

export async function listAttachmentMetas(): Promise<AttachmentRef[]> {
  const db = await openDB()
  const tx = db.transaction(ATTACHMENTS_STORE_NAME, 'readonly')
  const store = tx.objectStore(ATTACHMENTS_STORE_NAME)
  const all = (await txRequest(store.getAll())) as StoredAttachmentRecord[]
  return all.map((record) => ({
    id: record.id,
    name: record.name,
    mimeType: record.mimeType,
    size: record.size,
    kind: record.kind,
    createdAt: record.createdAt,
  }))
}

export async function deleteAttachment(id: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(ATTACHMENTS_STORE_NAME, 'readwrite')
  const store = tx.objectStore(ATTACHMENTS_STORE_NAME)
  await txRequest(store.delete(id))
}

export async function getAttachmentChunkBase64(
  id: string,
  offset: number,
  length: number = CHUNK_DEFAULT_BYTES
): Promise<{ chunkBase64: string; nextOffset: number; totalBytes: number; done: boolean } | null> {
  const record = await getRecord(id)
  if (!record) return null
  const safeOffset = Math.max(0, offset)
  const safeLength = Math.max(1, length)
  const totalBytes = record.bytes.byteLength
  if (safeOffset >= totalBytes) {
    return {
      chunkBase64: '',
      nextOffset: totalBytes,
      totalBytes,
      done: true,
    }
  }
  const end = Math.min(totalBytes, safeOffset + safeLength)
  const chunk = record.bytes.slice(safeOffset, end)
  const chunkBase64 = arrayBufferToBase64(chunk)
  return {
    chunkBase64,
    nextOffset: end,
    totalBytes,
    done: end >= totalBytes,
  }
}

export async function exportAttachmentRecords(ids: string[]): Promise<AttachmentExportRecord[]> {
  const unique = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.trim().length > 0)))
  const records = await Promise.all(unique.map((id) => getRecord(id)))
  return records
    .filter((entry): entry is StoredAttachmentRecord => Boolean(entry))
    .map((entry) => {
      const { bytes, ...meta } = entry
      return { ...meta, dataBase64: arrayBufferToBase64(bytes) }
    })
}

export async function importAttachmentRecords(records: AttachmentExportRecord[]): Promise<number> {
  let imported = 0
  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    if (!record.id || !record.name || !record.mimeType || typeof record.size !== 'number') continue
    const bytes = base64ToArrayBuffer(record.dataBase64 || '')
    if (bytes.byteLength === 0 && record.size > 0) continue
    const normalized: StoredAttachmentRecord = {
      id: record.id,
      name: record.name,
      mimeType: record.mimeType,
      size: bytes.byteLength,
      kind: record.kind || inferAttachmentKind(record.mimeType),
      createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
      bytes,
    }
    await putRecord(normalized)
    imported += 1
  }
  return imported
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  if (!b64) return new ArrayBuffer(0)
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}
