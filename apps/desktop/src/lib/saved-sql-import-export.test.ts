import { describe, it, expect } from 'vitest'
import {
  normalizeImportItems,
  parseSavedQueriesExport,
  type SavedQueriesExport,
} from './saved-sql-import-export'

const baseExport: SavedQueriesExport = {
  version: 'rdv.saved-sql.v1',
  exportedAt: new Date().toISOString(),
  items: [
    {
      name: 'active_users',
      description: 'List active users',
      sql: 'select * from users where status = {{status}}',
      variables: [
        {
          name: 'status',
          type: 'enum',
          options: ['active', 'disabled'],
          default: 'active',
        },
      ],
      dynamicColumns: [
        { name: 'upper_name', code: 'row.name.toUpperCase()' },
      ],
      calcItems: [
        { name: 'total', type: 'sql', code: 'select count(*) from users' },
      ],
    },
  ],
}

describe('saved-sql import/export helpers', () => {
  it('parses valid export JSON', () => {
    const json = JSON.stringify(baseExport)
    const parsed = parseSavedQueriesExport(json)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.data.items[0]?.name).toBe('active_users')
    }
  })

  it('rejects enum without options or optionsSql', () => {
    const badExport = {
      ...baseExport,
      items: [
        {
          name: 'bad_enum',
          sql: 'select 1',
          variables: [{ name: 'val', type: 'enum' }],
        },
      ],
    }
    const parsed = parseSavedQueriesExport(JSON.stringify(badExport))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toMatch(/enum.*options/i)
    }
  })

  it('normalizes optional arrays into defaults', () => {
    const normalized = normalizeImportItems({
      ...baseExport,
      items: [
        {
          name: 'simple',
          sql: 'select 1',
          variables: [],
        },
      ],
    })
    expect(normalized).toHaveLength(1)
    expect(normalized[0]?.dynamicColumns).toEqual([])
    expect(normalized[0]?.calcItems).toEqual([])
  })
})
