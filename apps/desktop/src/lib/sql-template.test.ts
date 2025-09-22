import { describe, it, expect } from 'vitest'
import type { SavedQueryVariableDef } from '@rei-db-view/types/appdb'
import {
  compileSql,
  extractVarNames,
  isReadOnlySelect,
  renderSqlPreview,
} from './sql-template'

const baseVars: SavedQueryVariableDef[] = [
  { name: 'id', type: 'number', required: true },
  { name: 'status', type: 'enum', options: ['active', 'disabled'] },
  { name: 'rawClause', type: 'raw' },
]

describe('sql-template helpers', () => {
  it('extracts variable names ignoring comments and strings', () => {
    const sql = `
      /* skip {{ignored}} */
      SELECT * FROM users
      WHERE id = {{id}}
        AND status = '{{literal}}'
        AND state = {{status}}
        -- {{also_ignored}}
    `
    expect(extractVarNames(sql).sort()).toEqual(['id', 'status'])
  })

  it('compiles SQL with positional parameters and reuses placeholders', () => {
    const compiled = compileSql(
      'select * from t where id = {{id}} and state = {{status}} or {{rawClause}}',
      baseVars,
      { id: 7, status: 'active', rawClause: "created_at > now() - interval '1 day'" },
    )
    expect(compiled.text).toContain('$1')
    expect(compiled.text).toContain('$2')
    expect(compiled.text).not.toContain('$3')
    expect(compiled.values).toEqual([7, 'active'])
  })

  it('throws when required variables are missing', () => {
    expect(() => compileSql('select {{id}}', baseVars, { status: 'active' })).toThrow(/required/i)
  })

  it('renders preview SQL with correct literal formatting', () => {
    const compiled = compileSql('select {{id}}, {{status}}', baseVars, { id: 3, status: 'disabled' })
    const preview = renderSqlPreview(compiled, baseVars)
    expect(preview).toContain("'disabled'")
    expect(preview).toContain('3')
  })

  it('casts uuid variables to avoid text comparison errors', () => {
    const vars: SavedQueryVariableDef[] = [{ name: 'userId', type: 'uuid', required: true }]
    const compiled = compileSql('select * from users where user_id = {{userId}}', vars, {
      userId: '27fe3d57-20b1-4aa9-b003-68eae5bb12e5',
    })
    expect(compiled.text).toContain('::uuid')
    expect(compiled.values).toEqual(['27fe3d57-20b1-4aa9-b003-68eae5bb12e5'])
  })

  it('detects read-only statements only for select/with', () => {
    expect(isReadOnlySelect('select 1')).toBe(true)
    expect(isReadOnlySelect('\n-- comment\nWITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(true)
    expect(isReadOnlySelect('  insert into t values (1)')).toBe(false)
  })

  it('allows clearing enum value to null even when default exists', () => {
    const vars: SavedQueryVariableDef[] = [
      { name: 'status', type: 'enum', options: ['active', 'disabled'], default: 'active' },
    ]
    const sql = 'select * from t where status = {{status}}'
    const compiledDefault = compileSql(sql, vars, {})
    expect(compiledDefault.values).toEqual(['active'])

    const compiledCleared = compileSql(sql, vars, { status: null })
    expect(compiledCleared.values).toEqual([null])
  })
})

describe('sql-template conditional blocks', () => {
  const vars: SavedQueryVariableDef[] = [
    { name: 'status', type: 'text' },
    { name: 'flag', type: 'boolean', default: true },
  ]

  it('includes when-block only if variables have value', () => {
    const sql = `
      select * from orders
      where true
      {{#when status}}
        and status = {{status}}
      {{/when}}
    `
    const withStatus = compileSql(sql, vars, { status: 'pending' })
    expect(withStatus.text).toMatch(/and status = \$1/)
    expect(withStatus.values).toEqual(['pending'])

    const withoutStatus = compileSql(sql, vars, {})
    expect(withoutStatus.text).not.toMatch(/status =/)
    expect(withoutStatus.values).toEqual([])
  })

  it('evaluates if/else expressions using presence helper', () => {
    const sql = `
      select * from orders
      where flag = {{flag}}
      {{#if presence(status) && status == 'pending'}}
        and status = {{status}}
      {{else}}
        and status is not null
      {{/if}}
    `
    const trueBranch = compileSql(sql, vars, { status: 'pending' })
    expect(trueBranch.text).toMatch(/and status = \$2/)
    expect(trueBranch.values).toEqual([true, 'pending'])

    const falseBranch = compileSql(sql, vars, { status: 'closed' })
    expect(falseBranch.text).toMatch(/and status is not null/)
    expect(falseBranch.values).toEqual([true])
  })

  it('throws when encountering unclosed blocks', () => {
    const sql = 'select 1 {{#when status}} and status = {{status}}'
    expect(() => compileSql(sql, vars, {})).toThrow(/Unclosed block/i)
  })
})
