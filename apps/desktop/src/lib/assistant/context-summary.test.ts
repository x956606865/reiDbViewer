import { describe, expect, it } from 'vitest'
import type { AssistantContextChunk } from '@/lib/assistant/context-chunks'
import { formatContextSummary } from './context-summary'

describe('formatContextSummary', () => {
  it('prefers provided DDL and preserves index statements without duplication', () => {
    const chunk: AssistantContextChunk = {
      id: 'schema:demo',
      kind: 'schema-table',
      title: 'public.demo',
      summary: '2 columns • PK: id',
      content: {
        schema: 'public',
        table: 'demo',
        columns: [
          {
            name: 'id',
            dataType: 'uuid',
            nullable: false,
            isPrimaryKey: true,
            isForeignKey: false,
            references: null,
          },
          {
            name: 'code',
            dataType: 'text',
            nullable: true,
            isPrimaryKey: false,
            isForeignKey: false,
            references: null,
          },
        ],
        ddl: [
          'CREATE TABLE "public"."demo" (',
          '  "id" uuid NOT NULL,',
          '  "code" text,',
          '  PRIMARY KEY ("id")',
          ');',
          'CREATE INDEX "demo_code_idx" ON "public"."demo" ("code");',
        ].join('\n'),
      },
    }

    const summary = formatContextSummary([chunk])
    expect(summary).toBeTruthy()
    if (!summary) throw new Error('summary should not be null')
    const createTableOccurrences = summary.match(/CREATE TABLE/g) ?? []
    expect(createTableOccurrences).toHaveLength(1)
    expect(summary).toContain('CREATE INDEX "demo_code_idx" ON "public"."demo" ("code");')
  })

  it('falls back to synthetic DDL when none provided', () => {
    const chunk: AssistantContextChunk = {
      id: 'schema:fallback',
      kind: 'schema-table',
      title: 'public.fallback',
      summary: '1 column',
      content: {
        schema: 'public',
        table: 'fallback',
        columns: [
          {
            name: 'id',
            dataType: 'integer',
            nullable: false,
            isPrimaryKey: true,
            isForeignKey: false,
            references: null,
          },
        ],
      },
    }

    const summary = formatContextSummary([chunk])
    expect(summary).toBeTruthy()
    if (!summary) throw new Error('summary should not be null')
    expect(summary).toContain('CREATE TABLE "public"."fallback"')
    expect(summary).toContain('PRIMARY KEY ("id")')
  })
})
