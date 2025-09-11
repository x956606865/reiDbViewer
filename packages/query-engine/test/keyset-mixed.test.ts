import { describe, it, expect } from 'vitest'
import { buildKeysetPredicate } from '../src/keyset'

describe('keyset mixed directions', () => {
  it('generates OR-of-layers predicate when directions differ', () => {
    const p = buildKeysetPredicate(
      [
        { expr: { kind: 'colref', name: 'created_at' }, dir: 'DESC' },
        { expr: { kind: 'colref', name: 'id' }, dir: 'ASC' }
      ],
      { last: { created_at: '2025-01-01T00:00:00Z', id: 100 } },
      't'
    )
    expect(p).not.toBeNull()
    // should contain OR and proper operators for DESC / ASC
    expect(p!.clause).toContain('t."created_at" < $1')
    expect(p!.clause).toContain('OR')
    expect(p!.clause).toContain('t."created_at" = $2')
    expect(p!.clause).toContain('t."id" > $3')
  })
})

