import { describe, expect, it } from 'vitest'
import type { SchemaMetadataSnapshot, SchemaMetadataTable } from '@/lib/schema-metadata-store'
import type { SavedSqlSummary } from '@/services/savedSql'
import { buildContextSections } from './context-chunks'

function table(overrides: Partial<SchemaMetadataTable> = {}): SchemaMetadataTable {
  return {
    schema: overrides.schema ?? 'public',
    name: overrides.name ?? 'users',
    columns: overrides.columns ?? [
      { name: 'id', dataType: 'uuid', isPrimaryKey: true },
      { name: 'email', dataType: 'text' },
    ],
    columnMap: overrides.columnMap ?? new Map(),
  }
}

describe('buildContextSections', () => {
  it('creates schema section with table summaries', () => {
    const snapshot: SchemaMetadataSnapshot = {
      connectionId: 'conn1',
      updatedAt: Date.now(),
      tables: [table()],
      tablesByKey: new Map(),
      tablesByName: new Map(),
    }
    const sections = buildContextSections({ schema: snapshot, savedSql: [], recentQueries: [] })
    const schemaSection = sections.find((section) => section.id === 'schema')
    expect(schemaSection).toBeDefined()
    expect(schemaSection!.items).toHaveLength(1)
    const item = schemaSection!.items[0]!
    expect(item.chunk.kind).toBe('schema-table')
    expect(item.chunk.content.columns).toHaveLength(2)
  })

  it('creates saved SQL section with variable summary', () => {
    const saved: SavedSqlSummary = {
      id: 'sq1',
      name: 'List active users',
      description: 'Only active accounts',
      variables: [{ name: 'status', type: 'text', label: 'Status' }],
      dynamicColumns: [],
      calcItems: [],
      createdAt: null,
      updatedAt: null,
    }
    const sections = buildContextSections({ schema: null, savedSql: [saved], recentQueries: [] })
    const savedSection = sections.find((section) => section.id === 'saved-sql')
    expect(savedSection).toBeDefined()
    expect(savedSection!.items[0]!.chunk.content.sqlSummary).toContain('List active users')
  })
})
