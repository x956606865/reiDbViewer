import { describe, it, expect } from 'vitest'
import { compileSql } from './sql-template'
import type { SavedQueryVariableDef } from '@rei-db-view/types/appdb'

describe('sql-template: raw variables', () => {
  const vars: SavedQueryVariableDef[] = [
    { name: 'id', type: 'number', required: true },
    { name: 'from', type: 'timestamp', required: true },
    { name: 'order_by', type: 'raw', required: true },
  ]

  it('inlines raw and parameterizes others', () => {
    const sql = 'SELECT * FROM t WHERE id = {{id}} AND created_at >= {{from}} ORDER BY {{order_by}}'
    const compiled = compileSql(sql, vars, {
      id: 42,
      from: new Date('2025-01-01T00:00:00Z'),
      order_by: 'created_at DESC NULLS LAST',
    })
    expect(compiled.text).toMatch(/ORDER BY created_at DESC NULLS LAST$/)
    expect(compiled.text).toMatch(/\$1/)
    expect(compiled.text).toMatch(/\$2/)
    expect(compiled.values.length).toBe(2)
  })

  it('throws when required raw missing', () => {
    const sql = 'SELECT * FROM t ORDER BY {{order_by}}'
    expect(() => compileSql(sql, vars, { id: 1, from: new Date() })).toThrow()
  })
})

describe('sql-template: enum variables', () => {
  const vars: SavedQueryVariableDef[] = [
    { name: 'status', type: 'enum', options: ['new', 'paid', 'shipped'], default: 'new' },
  ]

  it('parameterizes enum and validates options', () => {
    const sql = 'select * from t where status = {{status}}'
    const compiled = compileSql(sql, vars, { status: 'paid' })
    expect(compiled.text).toMatch(/\$1/)
    expect(compiled.values[0]).toBe('paid')
  })

  it('throws when enum value not in options', () => {
    const sql = 'select * from t where status = {{status}}'
    expect(() => compileSql(sql, vars, { status: 'canceled' })).toThrow()
  })
})
