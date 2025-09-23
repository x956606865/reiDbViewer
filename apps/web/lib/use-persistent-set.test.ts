import { describe, it, expect } from 'vitest'
import {
  loadStoredSet,
  persistStoredSet,
  resolvePersistentSetInitializer,
  type StorageLike,
} from './use-persistent-set'

class MemoryStorage implements StorageLike {
  private store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

describe('loadStoredSet', () => {
  it('returns stored values as a Set when JSON array is present', () => {
    const storage = new MemoryStorage()
    storage.setItem('rdv.savedSql.expanded', JSON.stringify(['/', 'reports']))
    const loaded = loadStoredSet<string>(storage, 'rdv.savedSql.expanded')
    expect(loaded).not.toBeNull()
    expect(Array.from(loaded!)).toEqual(['/', 'reports'])
  })

  it('returns null when storage is missing or payload invalid', () => {
    const storage = new MemoryStorage()
    storage.setItem('rdv.savedSql.expanded', '{ not: "json" }')
    const invalidPayload = loadStoredSet<string>(storage, 'rdv.savedSql.expanded')
    expect(invalidPayload).toBeNull()
    const missingStorage = loadStoredSet<string>(null, 'rdv.savedSql.expanded')
    expect(missingStorage).toBeNull()
  })
})

describe('persistStoredSet', () => {
  it('writes the current set contents as a JSON array', () => {
    const storage = new MemoryStorage()
    const value = new Set(['/', 'reports'])
    persistStoredSet(storage, 'rdv.savedSql.expanded', value)
    expect(storage.getItem('rdv.savedSql.expanded')).toBe('["/","reports"]')
  })

  it('silently ignores errors when storage is unavailable', () => {
    const flakyStorage: StorageLike = {
      getItem() {
        return null
      },
      setItem() {
        throw new Error('quota exceeded')
      },
    }
    expect(() => {
      persistStoredSet(flakyStorage, 'rdv.savedSql.expanded', new Set(['/']))
    }).not.toThrow()
  })
})

describe('resolvePersistentSetInitializer', () => {
  it('normalizes iterables and initializer functions into a Set', () => {
    const fromIterable = resolvePersistentSetInitializer(['/'])
    expect(Array.from(fromIterable)).toEqual(['/'])
    const fromFn = resolvePersistentSetInitializer(() => ['reports', 'daily'])
    expect(Array.from(fromFn)).toEqual(['reports', 'daily'])
    const fromSet = resolvePersistentSetInitializer(new Set(['custom']))
    expect(Array.from(fromSet)).toEqual(['custom'])
  })
})
