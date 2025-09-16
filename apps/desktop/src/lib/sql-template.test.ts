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

  it('detects read-only statements only for select/with', () => {
    expect(isReadOnlySelect('select 1')).toBe(true)
    expect(isReadOnlySelect('\n-- comment\nWITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(true)
    expect(isReadOnlySelect('  insert into t values (1)')).toBe(false)
  })
})
