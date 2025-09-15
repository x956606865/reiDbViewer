import { z } from 'zod'
import type { SavedQueryVariableDef, DynamicColumnDef, CalcItemDef } from '@rei-db-view/types/appdb'

// File format v1
export const SavedQueriesExportSchema = z.object({
  version: z.literal('rdv.saved-sql.v1'),
  exportedAt: z.string().datetime().or(z.string()),
  items: z.array(
    z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).nullable().optional(),
      sql: z.string().min(1),
      variables: z
        .array(
          z.object({
            name: z.string().min(1).max(64).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
            label: z.string().max(100).optional(),
            type: z.enum(['text', 'number', 'boolean', 'date', 'timestamp', 'json', 'uuid', 'raw']),
            required: z.boolean().optional(),
            default: z.any().optional(),
          })
        )
        .default([]),
      dynamicColumns: z
        .array(
          z.object({
            name: z.string().min(1).max(64),
            code: z.string().min(1),
            manualTrigger: z.boolean().optional(),
          })
        )
        .default([])
        .optional(),
      calcItems: z
        .array(
          z.object({
            name: z.string().min(1).max(64),
            type: z.enum(['sql', 'js']),
            code: z.string().min(1),
          })
        )
        .default([])
        .optional(),
    })
  ),
})

export type SavedQueriesExport = z.infer<typeof SavedQueriesExportSchema>

export function parseSavedQueriesExport(jsonText: string):
  | { ok: true; data: SavedQueriesExport }
  | { ok: false; error: string } {
  try {
    const raw = JSON.parse(jsonText)
    const parsed = SavedQueriesExportSchema.safeParse(raw)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.errors.map((e) => e.message).join('; ') }
    }
    return { ok: true, data: parsed.data }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) }
  }
}

export type ImportItem = {
  name: string
  description?: string | null
  sql: string
  variables: SavedQueryVariableDef[]
  dynamicColumns?: DynamicColumnDef[]
  calcItems?: CalcItemDef[]
}

export function normalizeImportItems(data: SavedQueriesExport): ImportItem[] {
  return data.items.map((it) => ({
    name: it.name,
    description: it.description ?? null,
    sql: it.sql,
    variables: Array.isArray(it.variables) ? it.variables : [],
    dynamicColumns: Array.isArray(it.dynamicColumns) ? it.dynamicColumns : [],
    calcItems: Array.isArray(it.calcItems) ? it.calcItems : [],
  }))
}
