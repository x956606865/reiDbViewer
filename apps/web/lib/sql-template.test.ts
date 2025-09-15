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

