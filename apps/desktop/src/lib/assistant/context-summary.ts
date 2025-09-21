import type { AssistantContextChunk } from '@/lib/assistant/context-chunks'
import { sanitizeMarkdownText } from '@/lib/assistant/markdown-sanitize'

const MAX_CONTEXT_CHUNKS = 6

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  return null
}

type ColumnReference = {
  schema?: string | null
  table?: string | null
  column?: string | null
}

type ColumnDescriptor = {
  name: string
  dataType: string
  nullable: boolean
  isPrimaryKey: boolean
  isForeignKey: boolean
  references: ColumnReference | null
}

function parseColumns(raw: unknown): ColumnDescriptor[] {
  if (!Array.isArray(raw)) return []
  const result: ColumnDescriptor[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const name = asString(item.name)
    const dataType = asString(item.dataType) ?? 'text'
    const nullable = asBoolean(item.nullable)
    const isPrimaryKey = asBoolean(item.isPrimaryKey) ?? false
    const isForeignKey = asBoolean(item.isForeignKey) ?? false
    const references = isRecord(item.references)
      ? {
          schema: asString(item.references.schema),
          table: asString(item.references.table),
          column: asString(item.references.column),
        }
      : null
    if (!name) continue
    result.push({
      name,
      dataType,
      nullable: nullable ?? true,
      isPrimaryKey,
      isForeignKey,
      references,
    })
  }
  return result
}

function formatSchemaTableChunk(chunk: AssistantContextChunk): string | null {
  if (!isRecord(chunk.content)) return null
  const content = chunk.content as Record<string, unknown>
  const schema = asString(content.schema)
  const table = asString(content.table)
  if (!schema || !table) return null
  const columns = parseColumns(content.columns)
  if (columns.length === 0) return null

  const providedDdl = asString(content.ddl)

  const ddl = (() => {
    if (providedDdl) return providedDdl

    const columnDefs: string[] = []
    const primaryKeys: string[] = []
    const foreignKeys: string[] = []

    for (const column of columns) {
      const nullableSegment = column.nullable ? '' : ' NOT NULL'
      columnDefs.push(`  "${column.name}" ${column.dataType}${nullableSegment}`)
      if (column.isPrimaryKey) {
        primaryKeys.push(`"${column.name}"`)
      }
      if (column.isForeignKey && column.references) {
        const refSchema = column.references.schema
        const refTable = column.references.table
        const refColumn = column.references.column
        if (refSchema && refTable && refColumn) {
          foreignKeys.push(
            `  FOREIGN KEY ("${column.name}") REFERENCES "${refSchema}"."${refTable}" ("${refColumn}")`,
          )
        }
      }
    }

    if (primaryKeys.length > 0) {
      columnDefs.push(`  PRIMARY KEY (${primaryKeys.join(', ')})`)
    }
    columnDefs.push(...foreignKeys)

    return `CREATE TABLE "${schema}"."${table}" (\n${columnDefs.join(',\n')}\n);`
  })()
  const lines: string[] = []
  const schemaLabel = sanitizeMarkdownText(schema)
  const tableLabel = sanitizeMarkdownText(table)
  const summary = sanitizeMarkdownText(chunk.summary)
  lines.push(`Table "${schemaLabel}"."${tableLabel}" — ${summary}`)
  lines.push('```sql')
  lines.push(sanitizeMarkdownText(ddl))
  lines.push('```')
  return lines.join('\n')
}

function formatGenericChunk(chunk: AssistantContextChunk, index: number): string {
  const title = sanitizeMarkdownText(chunk.title)
  const summary = sanitizeMarkdownText(chunk.summary)
  let line = `${index}. ${title} — ${summary}`
  if (isRecord(chunk.content)) {
    try {
      const contentString = JSON.stringify(chunk.content)
      if (contentString) {
        const trimmed = contentString.length > 240 ? `${contentString.slice(0, 240)}…` : contentString
        line += `\n   content: ${sanitizeMarkdownText(trimmed)}`
      }
    } catch {
      // ignore serialization issues
    }
  }
  return line
}

export function formatContextSummary(chunks: AssistantContextChunk[]): string | null {
  if (!Array.isArray(chunks) || chunks.length === 0) return null
  const limited = chunks.slice(0, MAX_CONTEXT_CHUNKS)
  const blocks: string[] = []
  for (let i = 0; i < limited.length; i += 1) {
    const chunk = limited[i]
    if (chunk.kind === 'schema-table') {
      const formatted = formatSchemaTableChunk(chunk)
      if (formatted) {
        blocks.push(`${i + 1}. ${formatted}`)
        continue
      }
    }
    blocks.push(formatGenericChunk(chunk, i + 1))
  }
  if (chunks.length > MAX_CONTEXT_CHUNKS) {
    blocks.push(`(+${chunks.length - MAX_CONTEXT_CHUNKS} more context chunks omitted)`)
  }
  if (blocks.length === 0) return null
  return `Context summary:\n${blocks.join('\n')}`
}

export const __test__ = {
  formatContextSummary,
}
