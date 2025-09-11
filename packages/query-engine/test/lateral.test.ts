import { describe, it, expect } from 'vitest'
import { buildSelectSql } from '../src/sql'
import type { Select } from '../../types/src/ast'

describe('lookup via lateral subquery', () => {
  it('emits a concrete LEFT JOIN LATERAL subquery selecting required cols', () => {
    const ast: Select = {
      from: { name: 'orders', alias: 'o' },
      columns: [
        { kind: 'column', ref: { kind: 'colref', table: 'o', name: 'id' } },
        { kind: 'computed', alias: 'user_email', expr: { kind: 'colref', table: 'lc_1', name: 'email' }, viaJoinId: 'lc_1' }
      ],
      joins: [
        {
          type: 'LATERAL',
          to: { name: 'users', alias: 'lc_1' },
          alias: 'lc_1',
          on: { kind: 'eq', left: { kind: 'colref', table: 'o', name: 'user_id' }, right: { kind: 'colref', table: 'lc_1', name: 'id' } }
        }
      ],
      limit: 10
    }
    const { text } = buildSelectSql(ast)
    expect(text).toContain('LEFT JOIN LATERAL (SELECT')
    expect(text).toContain('FROM "users" "t"')
    expect(text).toContain('WHERE "o"."user_id" = "t"."id"')
    expect(text).toContain('AS "user_email"')
  })
})
