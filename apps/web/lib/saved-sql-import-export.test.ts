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
})

