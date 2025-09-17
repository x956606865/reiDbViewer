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

  it('allows clearing enum to null even when default exists', () => {
    const sql = 'select * from t where status = {{status}}'
    const withDefault = compileSql(sql, vars, {})
    expect(withDefault.values).toEqual(['new'])

    const cleared = compileSql(sql, vars, { status: null })
    expect(cleared.values).toEqual([null])
  })
})

describe('sql-template: conditional blocks', () => {
  const vars: SavedQueryVariableDef[] = [
    { name: 'status', type: 'text' },
    { name: 'deleted', type: 'boolean', default: false },
  ]

  it('keeps block only when variable present', () => {
    const sql = `
      select * from orders
      where deleted_at is null
      {{#when status}}
        and status = {{status}}
      {{/when}}
    `
    const compiledWith = compileSql(sql, vars, { status: 'shipped' })
    expect(compiledWith.text).toMatch(/and status = \$1/)
    expect(compiledWith.values).toEqual(['shipped'])

    const compiledWithout = compileSql(sql, vars, {})
    expect(compiledWithout.text).not.toMatch(/status =/)
    expect(compiledWithout.values).toEqual([])
  })

  it('supports if/else expressions with presence', () => {
    const sql = `
      select * from orders
      where deleted = {{deleted}}
      {{#if presence(status) && status == 'new'}}
        and status = {{status}}
      {{else}}
        and status is not null
      {{/if}}
    `
    const compiledTrue = compileSql(sql, vars, { status: 'new' })
    expect(compiledTrue.text).toMatch(/and status = \$2/)
    expect(compiledTrue.values).toEqual([false, 'new'])

    const compiledFalse = compileSql(sql, vars, { status: 'archived' })
    expect(compiledFalse.text).toMatch(/and status is not null/)
    expect(compiledFalse.values).toEqual([false])
  })

  it('throws on unterminated blocks', () => {
    const sql = 'select 1 {{#if status}} and status = {{status}}'
    expect(() => compileSql(sql, vars, {})).toThrowError(/Unclosed block/i)
  })
})
