import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  coercePositiveInteger,
  readStoredPageSize,
  persistPageSize,
} from './usePaginationState'

describe('usePaginationState helpers', () => {
  const originalWindow = globalThis.window

  beforeEach(() => {
    const store = new Map<string, string>()
    globalThis.window = {
      localStorage: {
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          store.set(key, value)
        }),
      },
    } as unknown as Window & typeof globalThis
  })

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as any).window
    } else {
      globalThis.window = originalWindow
    }
  })

  it('coerces positive integers and falls back otherwise', () => {
    expect(coercePositiveInteger(25, 10)).toBe(25)
    expect(coercePositiveInteger(-1, 10)).toBe(10)
    expect(coercePositiveInteger(Number.NaN, 8)).toBe(8)
  })

  it('reads stored page size when available and valid', () => {
    window.localStorage.setItem('pg', '64')
    expect(readStoredPageSize('pg', 20)).toBe(64)
  })

  it('returns fallback when storage missing or invalid', () => {
    expect(readStoredPageSize('missing', 30)).toBe(30)
    window.localStorage.setItem('bad', 'oops')
    expect(readStoredPageSize('bad', 30)).toBe(30)
  })

  it('persists page size safely and ignores storage failures', () => {
    const spy = vi.spyOn(window.localStorage, 'setItem')
    persistPageSize('keep', 45)
    expect(spy).toHaveBeenCalledWith('keep', '45')

    spy.mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => persistPageSize('keep', 90)).not.toThrow()
  })
})
