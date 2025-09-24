import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  loadStoredSet,
  persistStoredSet,
  resolvePersistentSetInitializer,
  type StorageLike,
} from './use-persistent-set'

describe('use-persistent-set helpers', () => {
  let storage: { map: Map<string, string>; getItem: StorageLike['getItem']; setItem: StorageLike['setItem'] }

  beforeEach(() => {
    storage = {
      map: new Map<string, string>(),
      getItem: vi.fn((key: string) => storage.map.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.map.set(key, value)
      }),
    }
  })

  it('resolves initializer from iterable or factory', () => {
    const direct = resolvePersistentSetInitializer(['a', 'b'])
    expect(direct).toBeInstanceOf(Set)
    expect(Array.from(direct)).toEqual(['a', 'b'])

    const fromFactory = resolvePersistentSetInitializer(() => new Set(['x']))
    expect(Array.from(fromFactory)).toEqual(['x'])
  })

  it('loads stored set from JSON array', () => {
    storage.map.set('k1', JSON.stringify(['alpha', 'beta']))
    const loaded = loadStoredSet<string>(storage, 'k1')
    expect(Array.from(loaded ?? [])).toEqual(['alpha', 'beta'])
  })

  it('returns null when stored payload is missing or invalid', () => {
    expect(loadStoredSet<string>(storage, 'missing')).toBeNull()
    storage.map.set('k2', 'not-json')
    expect(loadStoredSet<string>(storage, 'k2')).toBeNull()
    storage.map.set('k3', JSON.stringify({ foo: 'bar' }))
    expect(loadStoredSet<string>(storage, 'k3')).toBeNull()
  })

  it('persists set values as JSON array', () => {
    const value = new Set(['foo', 'bar'])
    persistStoredSet(storage, 'k4', value)
    expect(storage.setItem).toHaveBeenCalledWith('k4', JSON.stringify(['foo', 'bar']))
    expect(storage.map.get('k4')).toEqual('["foo","bar"]')
  })

  it('ignores persistence failures', () => {
    const failing = {
      getItem: storage.getItem,
      setItem: vi.fn(() => {
        throw new Error('quota')
      }),
    }
    expect(() => persistStoredSet(failing, 'k5', new Set(['x']))).not.toThrow()
  })
})
