import { describe, expect, it } from 'vitest'
import { isReadOnlySql } from './tooling'

describe('isReadOnlySql', () => {
  it('accepts select queries', () => {
    expect(isReadOnlySql('SELECT * FROM users')).toBe(true)
    expect(isReadOnlySql('  with cte as (select 1) select * from cte')).toBe(true)
  })

  it('rejects write operations', () => {
    expect(isReadOnlySql('DELETE FROM users')).toBe(false)
    expect(isReadOnlySql('insert into logs values (1)')).toBe(false)
    expect(isReadOnlySql('alter table public.accounts add column flag boolean')).toBe(false)
  })
})
