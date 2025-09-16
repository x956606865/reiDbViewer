// Utilities for handling SQL templates with named variables like {{varName}}
// This compiles to parameterized SQL ($1, $2, ...) and returns a values array.

import { z } from 'zod'
import type { SavedQueryVariableDef } from '@rei-db-view/types/appdb'

export const VarValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.date(),
  z.null(),
  z.any(),
])

const varNameRe = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

// Remove single-line and block comments and single-quoted literals to reduce false-positive placeholder matches
function stripStringsAndComments(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    const ch2 = sql.slice(i, i + 2)
    if (ch2 === '--') {
      // single-line comment
      const nl = sql.indexOf('\n', i + 2)
      i = nl === -1 ? sql.length : nl
      out += '\n'
      continue
    }
    if (ch2 === '/*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      out += ' '
      continue
    }
    if (ch === "'") {
      // string literal
      i++
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i - 1] !== '\\') { i++; break }
        i++
      }
      out += "''" // keep length small
      continue
    }
    out += ch
    i++
  }
  return out
}

export function extractVarNames(sql: string): string[] {
  const cleaned = stripStringsAndComments(sql)
  const names = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = varNameRe.exec(cleaned))) {
    if (m[1]) names.add(m[1]!)
  }
  return Array.from(names)
}

export type CompiledSql = { text: string; values: any[]; placeholders: string[] }

export function isReadOnlySelect(sql: string): boolean {
  const t = stripStringsAndComments(sql).trim().toLowerCase()
  // allow starting with WITH or SELECT only
  if (t.startsWith('with ') || t.startsWith('select ')) return true
  return false
}

export function compileSql(
  sql: string,
  vars: SavedQueryVariableDef[],
  input: Record<string, unknown>
): CompiledSql {
  const byName = new Map<string, SavedQueryVariableDef>()
  for (const v of vars) byName.set(v.name, v)
  const placeholders: string[] = []
  const values: any[] = []
  const used = new Map<string, number>()

  // Replace {{name}} occurrences with $n (same var reused maps to same $n)
  const text = sql.replace(varNameRe, (_, raw: string) => {
    const name = String(raw)
    if (!byName.has(name)) throw new Error(`Undefined variable: ${name}`)
    const def = byName.get(name)!
    // For raw type, inline the value literally into SQL (no parameterization)
    if (def.type === 'raw') {
      const val = normalizeValue(name, def, input[name])
      // Insert as-is (string); caller must ensure it is syntactically valid
      return String(val ?? '')
    }
    if (used.has(name)) return `$${used.get(name)}`
    const val = normalizeValue(name, def, input[name])
    values.push(val)
    const idx = values.length
    placeholders.push(name)
    used.set(name, idx)
    return `$${idx}`
  })

  return { text, values, placeholders }
}

// Render a human-friendly SQL string by inlining parameter values into the
// compiled parameterized SQL. This is ONLY for preview purposes. It must never
// be used for execution because values are stringified and quoted.
export function renderSqlPreview(compiled: CompiledSql, vars: SavedQueryVariableDef[]): string {
  const defByName = new Map(vars.map(v => [v.name, v] as const))
  const { text, values, placeholders } = compiled
  const esc = (s: string) => s.replaceAll("'", "''")
  const fmtDate = (d: Date) => {
    const z = new Date(d)
    const yyyy = z.getUTCFullYear()
    const mm = String(z.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(z.getUTCDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }
  const fmt = (name: string | undefined, val: any): string => {
    if (val === null || val === undefined) return 'NULL'
    const def = name ? defByName.get(name) : undefined
    const t = def?.type
    switch (t) {
      case 'number':
        return String(val)
      case 'boolean':
        return val ? 'TRUE' : 'FALSE'
      case 'date':
        return `'${fmtDate(val instanceof Date ? val : new Date(String(val)))}'::date`
      case 'timestamp':
        return `'${(val instanceof Date ? val : new Date(String(val))).toISOString()}'::timestamptz`
      case 'json': {
        const json = typeof val === 'string' ? val : JSON.stringify(val)
        return `'${esc(json)}'::jsonb`
      }
      case 'enum':
        return `'${esc(String(val))}'`
      case 'uuid':
      case 'text':
      default:
        return `'${esc(String(val))}'`
    }
  }

  return text.replace(/\$(\d+)/g, (_m, g1) => {
    const idx = Number(g1) - 1
    const name = placeholders[idx]
    const val = values[idx]
    return fmt(name, val)
  })
}

function normalizeValue(name: string, def: SavedQueryVariableDef, raw: unknown): any {
  const required = !!def.required
  const type = def.type
  if (raw === undefined || raw === null || raw === '') {
    if (required && def.default === undefined) throw new Error(`Variable ${name} is required`)
    return def.default ?? null
  }
  switch (type) {
    case 'text':
      return String(raw)
    case 'uuid':
      return String(raw)
    case 'enum': {
      const v = String(raw)
      if (Array.isArray(def.options) && def.options.length > 0) {
        if (!def.options.includes(v)) {
          throw new Error(`Variable ${name} must be one of: ${def.options.join(', ')}`)
        }
      }
      return v
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(n)) throw new Error(`Variable ${name} must be a number`)
      return n
    }
    case 'boolean':
      if (typeof raw === 'boolean') return raw
      if (raw === 'true' || raw === '1' || raw === 1) return true
      if (raw === 'false' || raw === '0' || raw === 0) return false
      throw new Error(`Variable ${name} must be a boolean`)
    case 'date': {
      const d = raw instanceof Date ? raw : new Date(String(raw))
      if (Number.isNaN(d.getTime())) throw new Error(`Variable ${name} must be a date`)
      return d
    }
    case 'timestamp': {
      const d = raw instanceof Date ? raw : new Date(String(raw))
      if (Number.isNaN(d.getTime())) throw new Error(`Variable ${name} must be a timestamp`)
      return d
    }
    case 'json': {
      if (typeof raw === 'string') {
        try { return JSON.parse(raw) } catch { throw new Error(`Variable ${name} must be valid JSON`) }
      }
      return raw
    }
    case 'raw':
      return String(raw)
    default:
      return raw
  }
}

export const __test__ = { stripStringsAndComments, extractVarNames, normalizeValue }
