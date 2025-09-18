import Database from '@tauri-apps/plugin-sql'
import type {
  SavedQueryVariableDef,
  DynamicColumnDef,
  CalcItemDef,
} from '@rei-db-view/types/appdb'
import {
  SavedQueriesExport,
  normalizeImportItems,
} from '@/lib/saved-sql-import-export'
import { normalizeCalcItems as normalizeCalcItemsHelper } from '@/lib/calc-item-utils'

const TABLE = 'saved_sql'

type SavedSqlRow = {
  id: string
  name: string
  description: string | null
  sql: string
  variables: string | null
  dynamic_columns: string | null
  calc_items: string | null
  is_archived: number | null
  created_at: number | null
  updated_at: number | null
}

export type SavedSqlSummary = {
  id: string
  name: string
  description: string | null
  variables: SavedQueryVariableDef[]
  dynamicColumns: DynamicColumnDef[]
  calcItems: CalcItemDef[]
  createdAt: string | null
  updatedAt: string | null
}

export type SavedSqlRecord = SavedSqlSummary & {
  sql: string
  isArchived: boolean
}

export type ImportStats = { added: number; overwritten: number; skipped: number }

const openLocal = () => Database.load('sqlite:rdv_local.db')

const toIso = (ts: number | null) => {
  if (!Number.isFinite(ts)) return null
  const ms = ts! >= 1_000_000_000_000 ? ts! : ts! * 1000
  try {
    return new Date(ms).toISOString()
  } catch {
    return null
  }
}

const parseJson = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value) as T
    return Array.isArray(fallback) && !Array.isArray(parsed) ? fallback : parsed
  } catch {
    return fallback
  }
}

const normalizeCalcItems = (items: CalcItemDef[] | null | undefined): CalcItemDef[] =>
  normalizeCalcItemsHelper(items ?? [])

const rowToRecord = (row: SavedSqlRow): SavedSqlRecord => ({
  id: row.id,
  name: row.name,
  description: row.description,
  sql: row.sql,
  variables: parseJson<SavedQueryVariableDef[]>(row.variables, []),
  dynamicColumns: parseJson<DynamicColumnDef[]>(row.dynamic_columns, []),
  calcItems: normalizeCalcItems(parseJson<CalcItemDef[]>(row.calc_items, [])),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
  isArchived: row.is_archived === 1,
})

const rowToSummary = (row: SavedSqlRow): SavedSqlSummary => {
  const full = rowToRecord(row)
  const { sql: _sql, isArchived: _isArchived, ...rest } = full
  return rest
}

const genId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `sq_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`)

const nowMs = () => Date.now()

async function ensureUniqueName(db: any, name: string, excludeId?: string) {
  const rawRows = await db.select(
    `SELECT id FROM ${TABLE} WHERE name = $1 AND is_archived = 0${excludeId ? ' AND id <> $2' : ''} LIMIT 1`,
    excludeId ? [name, excludeId] : [name],
  )
  const rows = Array.isArray(rawRows) ? (rawRows as Array<{ id?: string }>) : []
  if (rows.length > 0) {
    const err = new Error('name_exists')
    ;(err as any).code = 'name_exists'
    throw err
  }
}

export async function listSavedSql(): Promise<SavedSqlSummary[]> {
  const db = await openLocal()
  const rows = await db.select(
    `SELECT id, name, description, sql, variables, dynamic_columns, calc_items, is_archived, created_at, updated_at FROM ${TABLE} WHERE is_archived = 0 ORDER BY updated_at DESC, name ASC`,
  )
  const list = Array.isArray(rows) ? (rows as SavedSqlRow[]) : []
  return list.map(rowToSummary)
}

export async function getSavedSql(id: string): Promise<SavedSqlRecord | null> {
  const db = await openLocal()
  const rows = await db.select(
    `SELECT id, name, description, sql, variables, dynamic_columns, calc_items, is_archived, created_at, updated_at FROM ${TABLE} WHERE id = $1 LIMIT 1`,
    [id],
  )
  const list = Array.isArray(rows) ? (rows as SavedSqlRow[]) : []
  if (list.length === 0) return null
  return rowToRecord(list[0]!)
}

export async function createSavedSql(input: {
  name: string
  description?: string | null
  sql: string
  variables?: SavedQueryVariableDef[]
  dynamicColumns?: DynamicColumnDef[]
  calcItems?: CalcItemDef[]
}): Promise<{ id: string }> {
  const name = input.name.trim()
  if (!name) throw new Error('name_required')
  const db = await openLocal()
  await ensureUniqueName(db, name)
  const id = genId()
  const now = nowMs()
  await db.execute(
    `INSERT INTO ${TABLE} (id, name, description, sql, variables, dynamic_columns, calc_items, is_archived, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $8)`,
    [
      id,
      name,
      input.description ?? null,
      input.sql,
      JSON.stringify(input.variables ?? []),
      JSON.stringify(input.dynamicColumns ?? []),
      JSON.stringify(normalizeCalcItems(input.calcItems)),
      now,
    ],
  )
  return { id }
}

export async function updateSavedSql(
  id: string,
  patch: Partial<{
    name: string
    description: string | null
    sql: string
    variables: SavedQueryVariableDef[]
    dynamicColumns: DynamicColumnDef[]
    calcItems: CalcItemDef[]
    isArchived: boolean
  }>,
): Promise<void> {
  if (!id) throw new Error('id_required')
  const db = await openLocal()
  const sets: string[] = []
  const params: any[] = []
  let paramIndex = 1
  const push = (clause: string, value: any) => {
    sets.push(`${clause} $${paramIndex}`)
    params.push(value)
    paramIndex += 1
  }
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new Error('name_required')
    await ensureUniqueName(db, name, id)
    push('name =', name)
  }
  if (patch.description !== undefined) push('description =', patch.description ?? null)
  if (patch.sql !== undefined) push('sql =', patch.sql)
  if (patch.variables !== undefined) push('variables =', JSON.stringify(patch.variables))
  if (patch.dynamicColumns !== undefined)
    push('dynamic_columns =', JSON.stringify(patch.dynamicColumns))
  if (patch.calcItems !== undefined)
    push('calc_items =', JSON.stringify(normalizeCalcItems(patch.calcItems)))
  if (patch.isArchived !== undefined) push('is_archived =', patch.isArchived ? 1 : 0)
  if (sets.length === 0) return
  push('updated_at =', nowMs())
  params.push(id)
  await db.execute(`UPDATE ${TABLE} SET ${sets.join(', ')} WHERE id = $${paramIndex}`, params)
}

export async function archiveSavedSql(id: string): Promise<void> {
  await updateSavedSql(id, { isArchived: true })
}

export async function removeSavedSql(id: string): Promise<void> {
  if (!id) return
  const db = await openLocal()
  await db.execute(`DELETE FROM ${TABLE} WHERE id = $1`, [id])
}

export async function exportAllSavedSql(): Promise<SavedQueriesExport> {
  const db = await openLocal()
  const rows = await db.select(
    `SELECT id, name, description, sql, variables, dynamic_columns, calc_items, is_archived, created_at, updated_at FROM ${TABLE} WHERE is_archived = 0 ORDER BY name ASC`,
  )
  const list = Array.isArray(rows) ? (rows as SavedSqlRow[]) : []
  const items = list.map((row) => {
    const variables = parseJson<SavedQueryVariableDef[]>(row.variables, [])
    const dynamicColumns = parseJson<DynamicColumnDef[]>(row.dynamic_columns, [])
    const calcItems = normalizeCalcItems(parseJson<CalcItemDef[]>(row.calc_items, []))
    return {
      name: row.name,
      description: row.description,
      sql: row.sql,
      variables,
      dynamicColumns,
      calcItems: calcItems.map((ci) => ({
        name: ci.name,
        type: ci.type,
        code: ci.code,
        runMode: ci.runMode ?? 'manual',
        kind: ci.kind ?? 'single',
      })),
    }
  })
  return {
    version: 'rdv.saved-sql.v1',
    exportedAt: new Date().toISOString(),
    items,
  }
}

export async function importSavedSql(
  data: SavedQueriesExport,
  opts: { overwrite: boolean },
): Promise<ImportStats> {
  const normalized = normalizeImportItems(data)
  if (normalized.length === 0) return { added: 0, overwritten: 0, skipped: 0 }
  const db = await openLocal()
  let added = 0
  let overwritten = 0
  let skipped = 0
  for (const item of normalized) {
    const name = item.name.trim()
    if (!name) {
      skipped += 1
      continue
    }
    const existingRows = await db.select(
      `SELECT id, name, description, sql, variables, dynamic_columns, calc_items, is_archived, created_at, updated_at FROM ${TABLE} WHERE name = $1 LIMIT 1`,
      [name],
    )
    const existing = Array.isArray(existingRows) ? (existingRows as SavedSqlRow[]) : []
    if (existing.length > 0) {
      if (!opts.overwrite) {
        skipped += 1
        continue
      }
      await updateSavedSql(existing[0]!.id, {
        name,
        description: item.description ?? null,
        sql: item.sql,
        variables: item.variables,
        dynamicColumns: item.dynamicColumns ?? [],
        calcItems: item.calcItems ?? [],
        isArchived: false,
      })
      overwritten += 1
      continue
    }
    await createSavedSql({
      name,
      description: item.description ?? null,
      sql: item.sql,
      variables: item.variables,
      dynamicColumns: item.dynamicColumns ?? [],
      calcItems: item.calcItems ?? [],
    })
    added += 1
  }
  return { added, overwritten, skipped }
}
