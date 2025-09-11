import { describe, it, expect } from 'vitest'
import { buildKeysetPredicate } from '../src/keyset'

describe('keyset predicate', () => {
  it('generates tuple comparison with ASC order', () => {
    const p = buildKeysetPredicate(
      [{ expr: { kind: 'colref', name: 'id' }, dir: 'ASC' }],
      { last: { id: 100 } },
      't'
    )
    expect(p).not.toBeNull()
    expect(p!.clause).toContain('(t."id")')
    expect(p!.clause).toContain('> ($1)')
    expect(p!.values).toEqual([100])
  })
})

