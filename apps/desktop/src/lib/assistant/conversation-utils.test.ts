import { describe, expect, it } from 'vitest'
import {
  calculateAggregatedMetrics,
  deriveConversationTitle,
  estimateTokenUsage,
  snapshotContextChunks,
  type AssistantConversationMessage,
} from './conversation-utils'
import type { AssistantContextChunk } from './context-chunks'

describe('deriveConversationTitle', () => {
  it('prefers the first user message and trims to 80 characters', () => {
    const messages: AssistantConversationMessage[] = [
      { id: 'a', role: 'assistant', text: 'Hello there', createdAt: 1 },
      {
        id: 'b',
        role: 'user',
        text: '   List all invoices pending payment in Q4 2024 and sort by amount descending.   ',
        createdAt: 2,
      },
      { id: 'c', role: 'assistant', text: 'Working on it…', createdAt: 3 },
    ]
    const title = deriveConversationTitle(messages, 'New conversation')
    expect(title).toBe('List all invoices pending payment in Q4 2024 and sort by amount descending.')
  })

  it('falls back to default when no user message exists', () => {
    const messages: AssistantConversationMessage[] = [
      { id: 'a', role: 'assistant', text: 'System ready', createdAt: 1 },
    ]
    const title = deriveConversationTitle(messages, 'New conversation')
    expect(title).toBe('New conversation')
  })
})

describe('estimateTokenUsage', () => {
  it('estimates tokens from text length', () => {
    expect(estimateTokenUsage('Hello world')).toBe(3)
  })

  it('returns zero for empty input', () => {
    expect(estimateTokenUsage('   ')).toBe(0)
  })
})

describe('calculateAggregatedMetrics', () => {
  it('aggregates totals and averages across messages', () => {
    const messages: AssistantConversationMessage[] = [
      {
        id: 'u1',
        role: 'user',
        text: 'Show the revenue summary',
        createdAt: 1,
        metrics: { inputTokens: 12, contextTokens: 24 },
      },
      {
        id: 'a1',
        role: 'assistant',
        text: 'Here is the revenue summary…',
        createdAt: 2,
        metrics: { latencyMs: 900, outputTokens: 36 },
      },
      {
        id: 'a2',
        role: 'assistant',
        text: 'Additional notes…',
        createdAt: 3,
        metrics: { latencyMs: 1100, outputTokens: 18 },
      },
    ]
    const summary = calculateAggregatedMetrics(messages)
    expect(summary.totalInputTokens).toBe(12)
    expect(summary.totalOutputTokens).toBe(54)
    expect(summary.totalContextTokens).toBe(24)
    expect(summary.messageCount).toBe(3)
    expect(summary.averageLatencyMs).toBeCloseTo(1000, 5)
    expect(summary.lastLatencyMs).toBe(1100)
  })
})

describe('snapshotContextChunks', () => {
  it('deep copies chunks and applies limit', () => {
    const chunks: AssistantContextChunk[] = [
      {
        id: 'schema:one',
        kind: 'schema-table',
        title: 'public.users',
        summary: '4 columns',
        content: { schema: 'public', table: 'users', columns: [{ name: 'id' }] },
      },
      {
        id: 'saved:two',
        kind: 'saved-sql',
        title: 'Top customers',
        summary: 'Customers by revenue',
        content: { id: 's1', name: 'Top customers' },
      },
    ]
    const snapshot = snapshotContextChunks(chunks, 1)
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]?.id).toBe('schema:one')
    expect(snapshot[0]).not.toBe(chunks[0])
    expect(snapshot[0]?.content).not.toBe(chunks[0]?.content)
    expect(snapshot[0]?.content).toEqual(chunks[0]?.content)
  })

  it('trims overly long summaries', () => {
    const longSummary = 'x'.repeat(400)
    const chunks: AssistantContextChunk[] = [
      {
        id: 'schema:one',
        kind: 'schema-table',
        title: 'public.users',
        summary: longSummary,
        content: {},
      },
    ]
    const snapshot = snapshotContextChunks(chunks)
    expect(snapshot[0]?.summary.length).toBeLessThanOrEqual(240)
  })
})
