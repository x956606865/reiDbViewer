const PROHIBITED_KEYWORDS = /(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COMMENT|MERGE|CALL|DO|BEGIN|COMMIT|ROLLBACK)\b/i

function stripSqlComments(input: string): string {
  return input
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

export function isReadOnlySql(text: string | null | undefined): boolean {
  if (!text) return false
  const stripped = stripSqlComments(text)
  const normalized = stripped.trim()
  if (!normalized) return false
  if (PROHIBITED_KEYWORDS.test(normalized)) return false
  return /^with\s+/i.test(normalized) || /^select\s+/i.test(normalized)
}

export type SimulatedToolCall = {
  id: string
  name: string
  kind: 'sql_preview'
  input: { sql: string }
  status: 'success' | 'error'
  result?: {
    columns: string[]
    rows: Array<Record<string, unknown>>
    summary?: string | null
  }
  message?: string
}

export function simulateSqlPreview(sql: string): SimulatedToolCall {
  if (!isReadOnlySql(sql)) {
    return {
      id: `tool_${Math.random().toString(36).slice(2)}`,
      name: 'readonly-sql-preview',
      kind: 'sql_preview',
      input: { sql },
      status: 'error',
      message: 'Only read-only SELECT/WITH statements are allowed.',
    }
  }

  return {
    id: `tool_${Math.random().toString(36).slice(2)}`,
    name: 'readonly-sql-preview',
    kind: 'sql_preview',
    input: { sql },
    status: 'success',
    result: {
      columns: ['example', 'rows'],
      rows: [
        { example: 'total_rows', rows: 123 },
        { example: 'sample_value', rows: 'demo' },
        { example: 'note', rows: 'Simulated result (no live query executed)' },
      ],
      summary: 'Simulated execution result. Configure real tool runner to execute against the read-only pool.',
    },
  }
}

export const __test__ = {
  stripSqlComments,
}
