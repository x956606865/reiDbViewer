import { describe, it, expect } from 'vitest'
import { buildExplainSQL, rowsToPlanText } from './pg-explain'

describe('pg-explain utils', () => {
  it('buildExplainSQL uses TEXT by default', () => {
    const out = buildExplainSQL('SELECT 1')
    expect(out).toMatch(/^EXPLAIN \(FORMAT TEXT, VERBOSE FALSE, COSTS TRUE, SETTINGS FALSE\) SELECT 1$/)
  })

  it('buildExplainSQL supports JSON', () => {
    const out = buildExplainSQL('SELECT 1', 'json')
    expect(out).toBe('EXPLAIN (FORMAT JSON) SELECT 1')
  })

  it('buildExplainSQL supports ANALYZE TRUE', () => {
    const out = buildExplainSQL('SELECT 1', { analyze: true, format: 'text' })
    expect(out).toMatch(/^EXPLAIN \(ANALYZE TRUE, FORMAT TEXT, VERBOSE FALSE, COSTS TRUE, SETTINGS FALSE\) SELECT 1$/)
  })

  it('rowsToPlanText joins QUERY PLAN rows', () => {
    const txt = rowsToPlanText([
      { 'QUERY PLAN': 'Seq Scan on t  (cost=0.00..1.05 rows=5 width=4)' },
      { 'QUERY PLAN': '  Filter: (id > 0)' },
    ])
    expect(txt).toContain('Seq Scan on t')
    expect(txt.split('\n').length).toBe(2)
  })
})
