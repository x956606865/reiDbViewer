import { describe, expect, it } from 'vitest'
import type { StoredRecentQuery } from './recent-queries-store'
import { __test__ } from './recent-queries-store'

const sample = (overrides: Partial<StoredRecentQuery> = {}): StoredRecentQuery => ({
  id: overrides.id ?? 'rq_1',
  title: overrides.title ?? 'Sample',
  sql: overrides.sql ?? 'select 1 as x',
  preview: overrides.preview ?? 'SELECT 1 AS x',
  executedAt: overrides.executedAt ?? 1,
  source: overrides.source ?? 'saved-sql',
  referenceId: overrides.referenceId ?? 'saved-1',
  fingerprint: overrides.fingerprint ?? 'saved-sql::saved-1::select 1 as x',
})

describe('mergeRecentQueries', () => {
  it('adds newest entry to the top and trims to limit', () => {
    const initial = [sample({ id: 'rq_old', executedAt: 10 })]
    const merged = __test__.mergeRecentQueries(initial, sample({ id: 'rq_new', executedAt: 20 }), 1)
    expect(merged).toHaveLength(1)
    expect(merged[0]!.id).toBe('rq_new')
  })

  it('deduplicates by fingerprint keeping the newest timestamp', () => {
    const existing = sample({ id: 'rq_existing', executedAt: 10 })
    const newer = sample({ id: 'rq_newer', executedAt: 30, fingerprint: 'same' })
    const merged = __test__.mergeRecentQueries([existing], newer, 5)
    expect(merged).toHaveLength(1)
    expect(merged[0]!.id).toBe('rq_newer')
    expect(merged[0]!.executedAt).toBe(30)
  })
})
