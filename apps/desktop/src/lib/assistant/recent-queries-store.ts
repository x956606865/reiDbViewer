import Database from '@tauri-apps/plugin-sql'

const STORAGE_KEY = 'assistant.recentQueries.v1'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export type RecentQuerySource = 'saved-sql' | 'ad-hoc'

export type RecentQueryEntry = {
  id: string
  title: string
  sql: string
  preview: string
  executedAt: number
  source: RecentQuerySource
  referenceId?: string | null
}

type RecentQueryInput = Partial<Omit<RecentQueryEntry, 'id' | 'executedAt' | 'preview'>> & {
  sql: string
  executedAt?: number
  preview?: string | null
  title?: string | null
  source?: RecentQuerySource
  referenceId?: string | null
}

export type StoredRecentQuery = RecentQueryEntry & {
  fingerprint: string
}

export type StoredPayload = {
  version: 1
  items: StoredRecentQuery[]
}

function openLocal() {
  return Database.load('sqlite:rdv_local.db')
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function normalizeSql(sql: string): string {
  return normalizeWhitespace(sql).toLowerCase()
}

function capPreview(preview: string): string {
  const max = 600
  if (preview.length <= max) return preview
  return preview.slice(0, max - 3) + '...'
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `rq_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function fingerprint(entry: RecentQueryEntry): string {
  const src = entry.source ?? 'saved-sql'
  const ref = entry.referenceId ? entry.referenceId.trim().toLowerCase() : ''
  return `${src}::${ref}::${normalizeSql(entry.sql)}`
}

function ensureStored(entry: RecentQueryEntry): StoredRecentQuery {
  return {
    ...entry,
    preview: capPreview(entry.preview ?? normalizeWhitespace(entry.sql)),
    fingerprint: fingerprint(entry),
  }
}

function sortByExecutedAt(items: StoredRecentQuery[]): StoredRecentQuery[] {
  return [...items].sort((a, b) => (b.executedAt ?? 0) - (a.executedAt ?? 0))
}

async function loadStored(): Promise<StoredRecentQuery[]> {
  try {
    const db = await openLocal()
    // @ts-ignore select exists on plugin connection
    const rows = await db.select<any[]>(`SELECT v FROM app_prefs WHERE k = $1`, [STORAGE_KEY])
    const raw = Array.isArray(rows) ? rows[0]?.v : undefined
    if (!raw) return []
    const parsed = JSON.parse(String(raw)) as StoredPayload | null
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.items)) return []
    return parsed.items.map((item) => ({
      ...item,
      fingerprint: item.fingerprint || fingerprint(item),
    }))
  } catch (err) {
    console.warn('failed to load recent queries', err)
    return []
  }
}

async function saveStored(items: StoredRecentQuery[]): Promise<void> {
  const payload: StoredPayload = { version: 1, items }
  const db = await openLocal()
  // @ts-ignore execute exists on plugin connection
  await db.execute(
    `INSERT INTO app_prefs (k, v) VALUES ($1, $2)
     ON CONFLICT(k) DO UPDATE SET v = EXCLUDED.v`,
    [STORAGE_KEY, JSON.stringify(payload)],
  )
}

function sanitizeInput(entry: RecentQueryInput): RecentQueryEntry {
  const executedAt = Number.isFinite(entry.executedAt) ? Number(entry.executedAt) : Date.now()
  const sql = entry.sql || ''
  const preview = capPreview(
    entry.preview?.trim() && entry.preview.trim().length > 2 ? entry.preview.trim() : normalizeWhitespace(sql),
  )
  const title = entry.title?.trim() || 'Untitled query'
  const source = entry.source ?? 'saved-sql'
  return {
    id: entry.id?.trim() || generateId(),
    title,
    sql,
    preview,
    executedAt,
    source,
    referenceId: entry.referenceId?.trim() || null,
  }
}

function clampLimit(limit?: number): number {
  const num = Number.isFinite(limit) ? Number(limit) : DEFAULT_LIMIT
  return Math.max(1, Math.min(num, MAX_LIMIT))
}

function mergeRecentQueries(
  current: StoredRecentQuery[],
  incoming: StoredRecentQuery,
  limit: number,
): StoredRecentQuery[] {
  const deduped = current.filter((item) => item.fingerprint !== incoming.fingerprint)
  const merged = [incoming, ...deduped]
  return sortByExecutedAt(merged).slice(0, limit)
}

export async function recordRecentQuery(entry: RecentQueryInput, opts?: { limit?: number }) {
  const sanitized = ensureStored(sanitizeInput(entry))
  const existing = await loadStored()
  const limit = clampLimit(opts?.limit)
  const merged = mergeRecentQueries(existing, sanitized, limit)
  await saveStored(merged)
}

export async function loadRecentQueries(limit?: number): Promise<RecentQueryEntry[]> {
  const stored = await loadStored()
  const normalized = sortByExecutedAt(stored)
  const cap = clampLimit(limit)
  return normalized.slice(0, cap).map((item) => ({
    id: item.id,
    title: item.title,
    sql: item.sql,
    preview: item.preview,
    executedAt: item.executedAt,
    source: item.source,
    referenceId: item.referenceId ?? null,
  }))
}

export const __test__ = {
  mergeRecentQueries,
  ensureStored,
}
