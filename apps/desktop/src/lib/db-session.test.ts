import { describe, expect, it, vi } from 'vitest'
import { __test__ } from './db-session'

const alias = '__rdv_row_json__'

describe('db-session select fallback', () => {
  it('detects unsupported datatype errors', () => {
    expect(__test__.isUnsupportedDatatypeError(new Error('unsupported datatype: JSONB[]'))).toBe(true)
    expect(__test__.isUnsupportedDatatypeError({ message: 'unsupported data type: HSTORE[]' })).toBe(true)
    expect(__test__.isUnsupportedDatatypeError(new Error('syntax error'))).toBe(false)
  })

  it('builds fallback query by stripping trailing semicolons', () => {
    const q = __test__.buildJsonFallbackQuery('SELECT 1;')
    expect(q).toBe(`SELECT to_jsonb(${alias}) AS ${alias} FROM ( SELECT 1 ) ${alias}`)
  })

  it('retries select with json fallback when encountering unsupported datatype errors', async () => {
    const calls: string[] = []
    const rows = [{ [alias]: '{"foo":1}' }]
    const baseSelect = vi.fn().mockImplementation(async (sql: string) => {
      calls.push(sql)
      if (!sql.includes('to_jsonb')) {
        throw new Error('unsupported datatype: JSONB[]')
      }
      return rows
    })
    const wrapped = __test__.wrapSelectWithFallback({ select: baseSelect })
    const result = await wrapped.select('SELECT foo FROM bar;', [])
    expect(result).toEqual([{ foo: 1 }])
    expect(calls.length).toBe(2)
    expect(calls[1]).toContain('to_jsonb')
  })

  it('rethrows original error if fallback also fails', async () => {
    const baseSelect = vi.fn().mockImplementation(async () => {
      throw new Error('unsupported datatype: JSONB[]')
    })
    const wrapped = __test__.wrapSelectWithFallback({ select: baseSelect })
    await expect(wrapped.select('SELECT foo', [])).rejects.toThrow('unsupported datatype: JSONB[]')
  })
})
