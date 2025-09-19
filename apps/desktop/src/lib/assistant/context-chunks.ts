import type { SchemaMetadataSnapshot, SchemaMetadataTable } from '@/lib/schema-metadata-store'
import type { SavedSqlSummary } from '@/services/savedSql'
import type { RecentQueryEntry } from './recent-queries-store'

export type AssistantContextKind = 'schema-table' | 'saved-sql' | 'recent-query'

export type AssistantContextChunk = {
  id: string
  kind: AssistantContextKind
  title: string
  summary: string
  content: Record<string, unknown>
}

export type AssistantContextItem = {
  id: string
  label: string
  description?: string
  chunk: AssistantContextChunk
}

export type AssistantContextSectionId = 'schema' | 'saved-sql' | 'recent-queries'

export type AssistantContextSection = {
  id: AssistantContextSectionId
  title: string
  emptyHint?: string
  items: AssistantContextItem[]
}

type BuildContextArgs = {
  schema: SchemaMetadataSnapshot | null | undefined
  savedSql: SavedSqlSummary[]
  recentQueries: RecentQueryEntry[]
}

function columnSummary(table: SchemaMetadataTable): string {
  const pkCols = table.columns.filter((col) => col.isPrimaryKey)
  const pkSummary = pkCols.length > 0 ? `PK: ${pkCols.map((col) => col.name).join(', ')}` : 'No primary key'
  const total = table.columns.length
  return `${total} column${total === 1 ? '' : 's'} • ${pkSummary}`
}

function buildSchemaItems(snapshot: SchemaMetadataSnapshot | null | undefined): AssistantContextItem[] {
  if (!snapshot) return []
  return snapshot.tables.map((table) => {
    const label = `${table.schema}.${table.name}`
    const chunk: AssistantContextChunk = {
      id: `schema:${snapshot.connectionId}:${table.schema}.${table.name}`,
      kind: 'schema-table',
      title: label,
      summary: columnSummary(table),
      content: {
        schema: table.schema,
        table: table.name,
        columns: table.columns.map((col) => ({
          name: col.name,
          dataType: col.dataType,
          nullable: col.nullable ?? null,
          isPrimaryKey: col.isPrimaryKey ?? false,
          isForeignKey: col.isForeignKey ?? false,
          references: col.references ?? null,
        })),
      },
    }
    return {
      id: chunk.id,
      label,
      description: columnSummary(table),
      chunk,
    }
  })
}

function buildSavedSqlItems(list: SavedSqlSummary[]): AssistantContextItem[] {
  if (!Array.isArray(list) || list.length === 0) return []
  return list.map((item) => {
    const variables = (item.variables ?? []).map((variable) => variable.name)
    const description = [item.description?.trim(), variables.length > 0 ? `Variables: ${variables.join(', ')}` : null]
      .filter(Boolean)
      .join(' • ')
    const chunk: AssistantContextChunk = {
      id: `saved:${item.id}`,
      kind: 'saved-sql',
      title: item.name,
      summary: description || 'Saved SQL template',
      content: {
        id: item.id,
        name: item.name,
        description: item.description,
        variables: item.variables,
        dynamicColumns: item.dynamicColumns,
        calcItems: item.calcItems,
        sqlSummary: `${item.name}${item.description ? ` — ${item.description}` : ''}`.trim(),
      },
    }
    return {
      id: chunk.id,
      label: item.name,
      description: description || undefined,
      chunk,
    }
  })
}

function buildRecentQueryItems(list: RecentQueryEntry[]): AssistantContextItem[] {
  if (!Array.isArray(list) || list.length === 0) return []
  return list.map((entry) => {
    const ts = new Date(entry.executedAt).toISOString()
    const chunk: AssistantContextChunk = {
      id: `recent:${entry.id}`,
      kind: 'recent-query',
      title: entry.title,
      summary: entry.preview,
      content: {
        id: entry.id,
        title: entry.title,
        sql: entry.sql,
        preview: entry.preview,
        executedAt: entry.executedAt,
        executedAtIso: ts,
        source: entry.source,
        referenceId: entry.referenceId ?? null,
      },
    }
    return {
      id: chunk.id,
      label: entry.title,
      description: entry.preview,
      chunk,
    }
  })
}

export function buildContextSections(args: BuildContextArgs): AssistantContextSection[] {
  const sections: AssistantContextSection[] = []
  const schemaItems = buildSchemaItems(args.schema)
  sections.push({
    id: 'schema',
    title: 'Schema',
    emptyHint: '连接后可选择要包含的表结构。',
    items: schemaItems,
  })
  const savedItems = buildSavedSqlItems(args.savedSql)
  sections.push({
    id: 'saved-sql',
    title: 'Saved SQL',
    emptyHint: '保存的查询会出现在这里，用于提供上下文。',
    items: savedItems,
  })
  const recentItems = buildRecentQueryItems(args.recentQueries)
  sections.push({
    id: 'recent-queries',
    title: '最近查询',
    emptyHint: '最近执行的查询将自动记录，方便引用。',
    items: recentItems,
  })
  return sections
}
