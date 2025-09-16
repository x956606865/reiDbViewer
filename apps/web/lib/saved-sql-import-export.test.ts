import { describe, it, expect } from 'vitest'
import { normalizeImportItems, parseSavedQueriesExport } from './saved-sql-import-export'

describe('saved-sql import/export schema', () => {
  it('parses valid export json', () => {
    const sample = {
      version: 'rdv.saved-sql.v1',
      exportedAt: new Date().toISOString(),
      items: [
        {
          name: 'reports/daily/top_users',
          description: 'Top users by score',
          sql: 'SELECT * FROM users WHERE created_at >= {{from}}',
          variables: [
            { name: 'from', type: 'timestamp', required: true },
          ],
          dynamicColumns: [{ name: 'fullName', code: 'return `${row.first_name} ${row.last_name}`' }],
          calcItems: [
            { name: 'total_users', type: 'sql', code: 'select count(*) as total from ({{_sql}}) t', runMode: 'manual' },
            { name: 'sum_score', type: 'js', code: '(vars, rows) => rows.reduce((s,r)=>s+(r.score||0),0)', runMode: 'manual' },
          ],
        },
      ],
    }
    const parsed = parseSavedQueriesExport(JSON.stringify(sample))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      const items = normalizeImportItems(parsed.data)
      expect(items.length).toBe(1)
      expect(items[0].name).toContain('top_users')
      expect(items[0].variables[0].name).toBe('from')
      expect(items[0].dynamicColumns?.[0].name).toBe('fullName')
      expect(items[0].calcItems?.[0].name).toBe('total_users')
    }
  })

  it('rejects invalid version', () => {
    const bad = { version: 'v0', exportedAt: new Date().toISOString(), items: [] }
    const parsed = parseSavedQueriesExport(JSON.stringify(bad))
    expect(parsed.ok).toBe(false)
  })

  it('rejects invalid variable name', () => {
    const bad = {
      version: 'rdv.saved-sql.v1',
      exportedAt: new Date().toISOString(),
      items: [
        { name: 'x', sql: 'select 1', variables: [{ name: '1bad', type: 'text' }] },
      ],
    }
    const parsed = parseSavedQueriesExport(JSON.stringify(bad))
    expect(parsed.ok).toBe(false)
  })

  it('supports enum variable with options', () => {
    const sample = {
      version: 'rdv.saved-sql.v1',
      exportedAt: new Date().toISOString(),
      items: [
        {
          name: 'reports/by_status',
          sql: 'select * from orders where status = {{status}}',
          variables: [
            { name: 'status', type: 'enum', options: ['new', 'paid', 'shipped'], default: 'new' },
          ],
        },
      ],
    }
    const parsed = parseSavedQueriesExport(JSON.stringify(sample))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      const items = normalizeImportItems(parsed.data)
      expect(items[0].variables[0].type).toBe('enum')
      expect((items[0].variables[0] as any).options?.length).toBe(3)
    }
  })

  it('allows enum with optionsSql only', () => {
    const sample = {
      version: 'rdv.saved-sql.v1',
      exportedAt: new Date().toISOString(),
      items: [
        {
          name: 'reports/by_status_sql',
          sql: 'select 1',
          variables: [
            { name: 'status', type: 'enum', optionsSql: 'select distinct status from orders' },
          ],
        },
      ],
    }
    const parsed = parseSavedQueriesExport(JSON.stringify(sample))
    expect(parsed.ok).toBe(true)
  })

  it('defaults calc runMode when omitted', () => {
    const sample = {
      version: 'rdv.saved-sql.v1',
      exportedAt: new Date().toISOString(),
      items: [
        {
          name: 'reports/with_calc',
          sql: 'select 1',
          calcItems: [{ name: 'total', type: 'sql', code: 'select count(*) from ({{_sql}}) t' }],
        },
      ],
    }
    const parsed = parseSavedQueriesExport(JSON.stringify(sample))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      const items = normalizeImportItems(parsed.data)
      expect(items[0].calcItems?.[0]?.runMode).toBe('manual')
    }
  })

  it('supports calc item group definitions', () => {
    const sample = {
      version: 'rdv.saved-sql.v1',
      exportedAt: new Date().toISOString(),
      items: [
        {
          name: 'reports/grouped',
          sql: 'select 1',
          calcItems: [
            {
              name: 'metrics',
              type: 'sql',
              code: 'select metric_name, metric_value from metrics',
              kind: 'group',
              runMode: 'always',
            },
          ],
        },
      ],
    }
    const parsed = parseSavedQueriesExport(JSON.stringify(sample))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      const items = normalizeImportItems(parsed.data)
      expect(items[0].calcItems?.[0]?.kind).toBe('group')
    }
  })

  it('rejects js calc group', () => {
    const sample = {
      version: 'rdv.saved-sql.v1',
      exportedAt: new Date().toISOString(),
      items: [
        {
          name: 'invalid',
          sql: 'select 1',
          calcItems: [
            {
              name: 'bad',
              type: 'js',
              code: '(vars) => vars',
              kind: 'group',
            },
          ],
        },
      ],
    }
    const parsed = parseSavedQueriesExport(JSON.stringify(sample))
    expect(parsed.ok).toBe(false)
  })
})
