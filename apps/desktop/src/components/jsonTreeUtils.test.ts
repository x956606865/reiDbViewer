import { describe, expect, it } from 'vitest'
import { collectExpandableKeys, getChildEntries, hasChildNodes, isJsonLike, pathToKey, pruneDescendants } from './jsonTreeUtils'

describe('jsonTreeUtils', () => {
  it('detects json-like values correctly', () => {
    expect(isJsonLike({ a: 1 })).toBe(true)
    expect(isJsonLike([1, 2, 3])).toBe(true)
    expect(isJsonLike(null)).toBe(false)
    expect(isJsonLike('test')).toBe(false)
    expect(isJsonLike(new Date())).toBe(false)
  })

  it('returns child entries for objects and arrays', () => {
    expect(getChildEntries({ a: 1, b: 2 })).toEqual([
      ['a', 1],
      ['b', 2],
    ])
    expect(getChildEntries(['x', 'y'])).toEqual([
      [0, 'x'],
      [1, 'y'],
    ])
    expect(getChildEntries('nope')).toEqual([])
  })

  it('collects expandable keys including descendants', () => {
    const sample = {
      profile: {
        name: 'alice',
        skills: ['sql', 'ts'],
      },
      settings: {
        theme: 'dark',
        flags: { beta: true },
      },
      tags: ['a'],
    }
    const rootPath = ['$root']
    const keys = collectExpandableKeys(sample, rootPath)
    const expected = [
      pathToKey(['$root']),
      pathToKey(['$root', 'profile']),
      pathToKey(['$root', 'profile', 'skills']),
      pathToKey(['$root', 'settings']),
      pathToKey(['$root', 'settings', 'flags']),
      pathToKey(['$root', 'tags']),
    ]
    expect(new Set(keys)).toEqual(new Set(expected))
  })

  it('prunes descendants correctly', () => {
    const sampleKeys = new Set([
      pathToKey(['$root']),
      pathToKey(['$root', 'profile']),
      pathToKey(['$root', 'profile', 'skills']),
      pathToKey(['$root', 'settings']),
      pathToKey(['$root', 'settings', 'flags']),
    ])
    const pruned = pruneDescendants(sampleKeys, ['$root', 'profile'])
    expect(pruned).toEqual(
      new Set([
        pathToKey(['$root']),
        pathToKey(['$root', 'settings']),
        pathToKey(['$root', 'settings', 'flags']),
      ])
    )
  })

  it('hasChildNodes matches collect behaviour', () => {
    expect(hasChildNodes({ a: 1 })).toBe(true)
    expect(hasChildNodes(['a'])).toBe(true)
    expect(hasChildNodes({})).toBe(false)
    expect(hasChildNodes([])).toBe(false)
    expect(hasChildNodes('x')).toBe(false)
  })
})
