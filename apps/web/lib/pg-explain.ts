export function buildExplainSQL(
  sql: string,
  options: { format?: 'text' | 'json'; analyze?: boolean } | 'text' | 'json' = { format: 'text', analyze: false }
) {
  const opts = typeof options === 'string' ? { format: options as 'text' | 'json', analyze: false } : (options || {})
  const format = (opts.format || 'text').toUpperCase()
  const analyze = !!opts.analyze
  const parts: string[] = []
  if (format === 'JSON') parts.push('FORMAT JSON')
  else parts.push('FORMAT TEXT', 'VERBOSE FALSE', 'COSTS TRUE', 'SETTINGS FALSE')
  if (analyze) parts.unshift('ANALYZE TRUE')
  const optionsSql = parts.join(', ')
  return `EXPLAIN (${optionsSql}) ${sql}`
}

export function rowsToPlanText(rows: Array<Record<string, unknown>>): string {
  if (!Array.isArray(rows) || rows.length === 0) return ''
  // Postgres returns a single column named "QUERY PLAN" in TEXT mode
  const lines: string[] = []
  for (const r of rows) {
    const v = (r as any)['QUERY PLAN']
    if (typeof v === 'string') lines.push(v)
    else if (v != null) lines.push(String(v))
  }
  return lines.join('\n')
}
