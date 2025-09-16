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
          z
            .object({
              name: z
                .string()
                .min(1)
                .max(64)
                .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
              label: z.string().max(100).optional(),
              type: z.enum([
                'text',
                'number',
                'boolean',
                'date',
                'timestamp',
                'json',
                'uuid',
                'raw',
                'enum',
              ]),
              required: z.boolean().optional(),
              default: z.any().optional(),
              options: z.array(z.string()).min(1).optional(),
              optionsSql: z.string().min(1).optional(),
            })
            .superRefine((val, ctx) => {
              if (val.type === 'enum') {
                // 允许：options 非空；或未提供 options 但提供了 optionsSql（可后续拉取）
                const hasOptions = Array.isArray(val.options) && val.options.length > 0
                const hasSql = typeof val.optionsSql === 'string' && val.optionsSql.trim().length > 0
                if (!hasOptions && !hasSql) {
                  ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'enum 需要提供 options 或 optionsSql 之一', path: ['options'] })
                }
                if (val.default !== undefined && val.default !== null) {
                  const def = String(val.default)
                  if (hasOptions && !val.options!.includes(def)) {
                    ctx.addIssue({
                      code: z.ZodIssueCode.custom,
                      message: 'enum 默认值必须在 options 中',
                      path: ['default'],
                    })
                  }
                }
              } else {
                if (val.optionsSql) {
                  ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'optionsSql 仅适用于 enum 类型', path: ['optionsSql'] })
                }
              }
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
            runMode: z.enum(['always', 'initial', 'manual']).default('manual'),
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
