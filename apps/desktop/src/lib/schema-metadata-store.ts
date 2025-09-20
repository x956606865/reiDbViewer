import { readSchemaCache, type IndexCacheEntry, type SchemaCachePayload } from '@/lib/schema-cache'
import { getCurrentConnId, subscribeCurrentConnId } from '@/lib/current-conn'

export type SchemaMetadataColumn = {
  name: string
  dataType: string
  nullable?: boolean
  isPrimaryKey?: boolean
  isForeignKey?: boolean
  references?: { schema: string; table: string; column: string }
}

export type SchemaMetadataTable = {
  schema: string
  name: string
  columns: SchemaMetadataColumn[]
  columnMap: Map<string, SchemaMetadataColumn>
  ddl: string | null
  indexes: IndexCacheEntry[]
}

export type SchemaMetadataSnapshot = {
  connectionId: string
  updatedAt: number
  tables: SchemaMetadataTable[]
  tablesByKey: Map<string, SchemaMetadataTable>
  tablesByName: Map<string, SchemaMetadataTable[]>
}

type Listener = (snapshot: SchemaMetadataSnapshot | null) => void

const listeners = new Set<Listener>()
const pendingLoads = new Map<string, Promise<SchemaMetadataSnapshot | null>>()
const lastApplied = new Map<string, number>()

let currentSnapshot: SchemaMetadataSnapshot | null = null
let currentConnectionId: string | null = null
let initialized = false

const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_$]*$/i

function normalizeIdentifier(raw: string): string {
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    const inner = trimmed.slice(1, -1).replace(/""/g, '"')
    return inner
  }
  return trimmed.toLowerCase()
}

function formatIdentifier(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (!IDENTIFIER_PATTERN.test(trimmed) || trimmed !== trimmed.toLowerCase()) {
    return `"${trimmed.replace(/"/g, '""')}"`
  }
  return trimmed
}

function buildTable(
  payload: SchemaCachePayload['tables'][number],
  ddl: string | null,
  indexes: IndexCacheEntry[],
): SchemaMetadataTable {
  const columnMap = new Map<string, SchemaMetadataColumn>()
  const columns = (payload.columns || []).map((col) => {
    const info: SchemaMetadataColumn = {
      name: col.name,
      dataType: col.dataType,
      nullable: col.nullable,
      isPrimaryKey: col.isPrimaryKey,
      isForeignKey: col.isForeignKey,
      references: col.references,
    }
    columnMap.set(normalizeIdentifier(col.name), info)
    return info
  })
  return {
    schema: payload.schema,
    name: payload.name,
    columns,
    columnMap,
    ddl,
    indexes,
  }
}

function buildSnapshot(connId: string, payload: SchemaCachePayload, updatedAt: number): SchemaMetadataSnapshot {
  const ddlMap = new Map<string, string>()
  for (const entry of payload.ddls || []) {
    if (!entry) continue
    const normalizedKey = `${normalizeIdentifier(entry.schema)}.${normalizeIdentifier(entry.name)}`
    if (!normalizedKey.trim()) continue
    ddlMap.set(normalizedKey, entry.ddl)
  }
  const indexMap = new Map<string, IndexCacheEntry[]>()
  for (const entry of payload.indexes || []) {
    if (!entry) continue
    const normalizedKey = `${normalizeIdentifier(entry.schema)}.${normalizeIdentifier(entry.name)}`
    const list = (entry.indexes || []).map((ix) => ({ ...ix }))
    indexMap.set(normalizedKey, list)
  }
  const tables = (payload.tables || []).map((table) => {
    const normalizedKey = `${normalizeIdentifier(table.schema)}.${normalizeIdentifier(table.name)}`
    const ddl = ddlMap.get(normalizedKey) ?? null
    const indexes = indexMap.get(normalizedKey) ?? []
    return buildTable(table, ddl, indexes)
  })
  const tablesByKey = new Map<string, SchemaMetadataTable>()
  const tablesByName = new Map<string, SchemaMetadataTable[]>()
  for (const table of tables) {
    const key = `${normalizeIdentifier(table.schema)}.${normalizeIdentifier(table.name)}`
    tablesByKey.set(key, table)
    const nameKey = normalizeIdentifier(table.name)
    const arr = tablesByName.get(nameKey) || []
    arr.push(table)
    tablesByName.set(nameKey, arr)
  }
  return {
    connectionId: connId,
    updatedAt,
    tables,
    tablesByKey,
    tablesByName,
  }
}

function notify() {
  for (const listener of listeners) {
    try {
      listener(currentSnapshot)
    } catch (err) {
      console.error('schema-metadata listener error', err)
    }
  }
}

function clearSnapshot() {
  if (currentSnapshot) {
    currentSnapshot = null
    notify()
  }
}

async function loadForConnection(connId: string, { force }: { force?: boolean } = {}): Promise<SchemaMetadataSnapshot | null> {
  if (!connId) {
    clearSnapshot()
    return null
  }
  const lastTs = lastApplied.get(connId)
  if (!force && currentSnapshot?.connectionId === connId && currentSnapshot.updatedAt === lastTs && currentSnapshot.tables.length > 0) {
    return currentSnapshot
  }
  if (!force && pendingLoads.has(connId)) {
    return await pendingLoads.get(connId)!
  }
  const promise = (async () => {
    try {
      const cached = await readSchemaCache(connId)
      if (!cached) {
        if (currentConnectionId === connId) clearSnapshot()
        lastApplied.delete(connId)
        return null
      }
      const snapshot = buildSnapshot(connId, cached.payload, cached.updatedAt || Math.floor(Date.now() / 1000))
      lastApplied.set(connId, snapshot.updatedAt)
      if (currentConnectionId === connId) {
        currentSnapshot = snapshot
        notify()
      }
      return snapshot
    } catch (err) {
      if (currentConnectionId === connId) {
        console.warn('failed to load schema metadata', err)
      }
      throw err
    } finally {
      pendingLoads.delete(connId)
    }
  })()
  pendingLoads.set(connId, promise)
  return await promise
}

function handleConnectionChange(connId: string | null) {
  currentConnectionId = connId
  if (!connId) {
    clearSnapshot()
    return
  }
  void loadForConnection(connId).catch(() => {})
}

function ensureInitialized() {
  if (initialized) return
  if (typeof window === 'undefined') return
  initialized = true
  currentConnectionId = getCurrentConnId()
  if (currentConnectionId) {
    void loadForConnection(currentConnectionId).catch(() => {})
  }
  subscribeCurrentConnId((id) => handleConnectionChange(id))
}

export function getSchemaMetadataSnapshot(): SchemaMetadataSnapshot | null {
  ensureInitialized()
  return currentSnapshot
}

export function subscribeSchemaMetadata(listener: Listener): () => void {
  ensureInitialized()
  listeners.add(listener)
  listener(currentSnapshot)
  return () => {
    listeners.delete(listener)
  }
}

export async function ensureSchemaMetadataForConnection(connId: string | null, opts?: { force?: boolean }) {
  ensureInitialized()
  const target = connId ?? currentConnectionId
  if (!target) {
    clearSnapshot()
    return null
  }
  return await loadForConnection(target, { force: opts?.force })
}

export function applySchemaMetadataPayload(connId: string, payload: SchemaCachePayload, updatedAt?: number) {
  ensureInitialized()
  const snapshot = buildSnapshot(connId, payload, updatedAt || Math.floor(Date.now() / 1000))
  lastApplied.set(connId, snapshot.updatedAt)
  currentConnectionId = connId
  currentSnapshot = snapshot
  notify()
}

export function formatIdentifierIfNeeded(name: string): string {
  return formatIdentifier(name)
}

export function normalizeIdentifierForLookup(name: string): string {
  return normalizeIdentifier(name)
}
