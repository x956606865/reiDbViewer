import { describe, expect, it } from 'vitest'
import { isTimestampWithOffset, normalizeTimestampWithOffset, parseTimestampWithOffset } from './timezone-detect'

describe('normalizeTimestampWithOffset', () => {
  it('normalizes ISO inputs unchanged', () => {
    const input = '2025-09-17T12:34:56+08:00'
    expect(normalizeTimestampWithOffset(input)).toBe(input)
  })

  it('converts space separated timestamp with offset', () => {
    expect(normalizeTimestampWithOffset('2025-09-17 12:34:56+0800')).toBe('2025-09-17T12:34:56+08:00')
  })

  it('fills seconds and minutes when missing', () => {
    expect(normalizeTimestampWithOffset('2025-09-17 12:34+08')).toBe('2025-09-17T12:34:00+08:00')
  })

  it('handles fractional seconds', () => {
    expect(normalizeTimestampWithOffset('2025-09-17T12:34:56.789123-05:30')).toBe('2025-09-17T12:34:56.789123-05:30')
  })

  it('accepts whitespace before offset', () => {
    expect(normalizeTimestampWithOffset('2025-09-17 12:34:56.789123 +05:30')).toBe('2025-09-17T12:34:56.789123+05:30')
  })

  it('normalizes offsets with seconds', () => {
    expect(normalizeTimestampWithOffset('2025-09-17 12:34:56 +00:00:00')).toBe('2025-09-17T12:34:56+00:00')
    expect(normalizeTimestampWithOffset('2025-09-17 12:34:56 -05:30:30')).toBe('2025-09-17T12:34:56-05:31')
  })

  it('pads single-digit hours', () => {
    expect(normalizeTimestampWithOffset('2025-09-17 6 +00:00')).toBe('2025-09-17T06:00:00+00:00')
    expect(normalizeTimestampWithOffset('2025-09-17 6:05 +00:00')).toBe('2025-09-17T06:05:00+00:00')
    expect(normalizeTimestampWithOffset('2025-09-17 6:05:04.123 +00:00')).toBe('2025-09-17T06:05:04.123+00:00')
  })

  it('returns null for values without offset', () => {
    expect(normalizeTimestampWithOffset('2025-09-17 12:34:56')).toBeNull()
  })
})

describe('isTimestampWithOffset', () => {
  it('accepts valid strings', () => {
    expect(isTimestampWithOffset('2025-09-17 12:34:56+08:00')).toBe(true)
  })

  it('rejects non-string values', () => {
    expect(isTimestampWithOffset(12345)).toBe(false)
  })

  it('rejects invalid strings', () => {
    expect(isTimestampWithOffset('hello world')).toBe(false)
  })
})

describe('parseTimestampWithOffset', () => {
  it('parses to Date instance', () => {
    const dt = parseTimestampWithOffset('2025-09-17T12:34:56Z')
    expect(dt).instanceOf(Date)
    expect(dt?.toISOString()).toBe('2025-09-17T12:34:56.000Z')
  })

  it('returns null for invalid input', () => {
    expect(parseTimestampWithOffset('2025-09-17 12:34:56')).toBeNull()
  })
})
