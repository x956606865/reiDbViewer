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
        { name: 'total', type: 'sql', code: 'select count(*) from users', runMode: 'manual' },
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

  it('defaults calc runMode to manual when missing', () => {
    const parsed = parseSavedQueriesExport(
      JSON.stringify({
        ...baseExport,
        items: [
          {
            name: 'total_only',
            sql: 'select 1',
            calcItems: [{ name: 'total', type: 'sql', code: 'select count(*) from ({{_sql}}) t' }],
          },
        ],
      })
    )
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.data.items[0]?.calcItems?.[0]?.runMode).toBe('manual')
    }
  })

  it('supports calc data group definitions', () => {
    const parsed = parseSavedQueriesExport(
      JSON.stringify({
        ...baseExport,
        items: [
          {
            name: 'grouped_metrics',
            sql: 'select 1',
            calcItems: [
              {
                name: 'metrics_group',
                type: 'sql',
                code: 'select metric_name, metric_value from metrics',
                kind: 'group',
              },
            ],
          },
        ],
      })
    )
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.data.items[0]?.calcItems?.[0]?.kind).toBe('group')
    }
  })

  it('rejects js calc group definition', () => {
    const parsed = parseSavedQueriesExport(
      JSON.stringify({
        ...baseExport,
        items: [
          {
            name: 'invalid_group',
            sql: 'select 1',
            calcItems: [
              {
                name: 'bad_js_group',
                type: 'js',
                code: '() => 1',
                kind: 'group',
              },
            ],
          },
        ],
      })
    )
    expect(parsed.ok).toBe(false)
  })
})
