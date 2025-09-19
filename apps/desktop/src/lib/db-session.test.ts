import { describe, expect, it, vi } from 'vitest'
import { __test__ } from './db-session'

const alias = '__rdv_row_json__'

describe('db-session select fallback', () => {
  it('detects unsupported datatype errors', () => {
    expect(__test__.isUnsupportedDatatypeError(new Error('unsupported datatype: JSONB[]'))).toBe(true)
    expect(__test__.isUnsupportedDatatypeError({ message: 'unsupported data type: HSTORE[]' })).toBe(true)
    expect(__test__.isUnsupportedDatatypeError(new Error('syntax error'))).toBe(false)
  })

  it('detects select statements with leading comments', () => {
    expect(__test__.isLikelySelectQuery('SELECT 1')).toBe(true)
    expect(__test__.isLikelySelectQuery('  -- comment\nSELECT 1')).toBe(true)
    expect(__test__.isLikelySelectQuery('/* note */ SELECT 1')).toBe(true)
    expect(__test__.isLikelySelectQuery('EXPLAIN SELECT 1')).toBe(false)
  })

  it('builds fallback query by stripping trailing semicolons', () => {
    const q = __test__.buildJsonFallbackQuery('SELECT 1;')
    expect(q).toBe(`SELECT row_to_json(__rdv_row_source__)::text AS ${alias} FROM (\nSELECT 1\n) __rdv_row_source__`)
  })

  it('builds fallback query and removes trailing line comments', () => {
    const q = __test__.buildJsonFallbackQuery('SELECT 1; -- label')
    expect(q).toBe(`SELECT row_to_json(__rdv_row_source__)::text AS ${alias} FROM (\nSELECT 1\n) __rdv_row_source__`)
  })

  it('retries select with json fallback when encountering unsupported datatype errors', async () => {
    const calls: string[] = []
    const rows = [{ [alias]: '{"foo":1}' }]
    const baseSelect = vi.fn().mockImplementation(async (sql: string) => {
      calls.push(sql)
      if (!sql.includes('row_to_json')) {
        throw new Error('unsupported datatype: JSONB[]')
      }
      return rows
    })
    const wrapped = __test__.wrapSelectWithFallback({ select: baseSelect })
    const result = await wrapped.select('SELECT foo FROM bar;', [])
    expect(result).toEqual([{ foo: 1 }])
    expect(calls.length).toBe(2)
    expect(calls[1]).toContain('row_to_json')
  })

  it('rethrows original error if fallback also fails, preserving instance', async () => {
    const original = new Error('unsupported datatype: JSONB[]')
    const baseSelect = vi.fn().mockImplementation(async () => {
      throw original
    })
    const wrapped = __test__.wrapSelectWithFallback({ select: baseSelect })
    await expect(wrapped.select('SELECT foo', [])).rejects.toBe(original)
    expect(original.message).toBe('unsupported datatype: JSONB[] (fallback failed: unsupported datatype: JSONB[])')
    expect((original as any).cause).toBeUndefined()
  })

  it('prefers json fallback for selects when enabled', async () => {
    const calls: string[] = []
    const baseSelect = vi.fn().mockImplementation(async (sql: string) => {
      calls.push(sql)
      if (sql.includes('row_to_json')) {
        return [{ [alias]: '{"id":"abc"}' }]
      }
      throw new Error('should not call original query')
    })
    const wrapped = __test__.wrapSelectWithFallback({ select: baseSelect }, { preferJsonFallback: true })
    const result = await wrapped.select('SELECT id FROM table', [])
    expect(result).toEqual([{ id: 'abc' }])
    expect(calls.length).toBe(1)
    expect(calls[0]).toContain('row_to_json')
  })

  it('falls back to original query when json wrapper fails', async () => {
    const calls: string[] = []
    const baseSelect = vi.fn().mockImplementation(async (sql: string) => {
      calls.push(sql)
      if (sql.includes('row_to_json')) {
        throw new Error('syntax error at or near "SELECT"')
      }
      return [{ foo: 'bar' }]
    })
    const wrapped = __test__.wrapSelectWithFallback({ select: baseSelect }, { preferJsonFallback: true })
    const result = await wrapped.select('SELECT foo FROM table', [])
    expect(result).toEqual([{ foo: 'bar' }])
    expect(calls.length).toBe(2)
    expect(calls[0]).toContain('row_to_json')
    expect(calls[1]).toBe('SELECT foo FROM table')
  })

  it('skips forced fallback for non-select statements', async () => {
    const baseSelect = vi.fn().mockResolvedValue([{ plan: 'Seq Scan' }])
    const wrapped = __test__.wrapSelectWithFallback({ select: baseSelect }, { preferJsonFallback: true })
    const result = await wrapped.select('EXPLAIN SELECT * FROM users', [])
    expect(result).toEqual([{ plan: 'Seq Scan' }])
    expect(baseSelect).toHaveBeenCalledTimes(1)
    expect(baseSelect).toHaveBeenCalledWith('EXPLAIN SELECT * FROM users', [])
  })
})
