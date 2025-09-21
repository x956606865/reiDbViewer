import { describe, expect, it } from 'vitest'
import { decodeSqliteText, parseJsonColumn } from './sqlite-text'

const encoder = new TextEncoder()

describe('decodeSqliteText', () => {
  it('returns strings unchanged', () => {
    expect(decodeSqliteText('hello')).toBe('hello')
  })

  it('decodes Uint8Array payloads', () => {
    const payload = encoder.encode('{"foo":1}')
    expect(decodeSqliteText(payload)).toBe('{"foo":1}')
  })

  it('decodes ArrayBuffer payloads', () => {
    const payload = encoder.encode('buffer').buffer
    expect(decodeSqliteText(payload)).toBe('buffer')
  })

  it('decodes numeric arrays', () => {
    const payload = Array.from(encoder.encode('list'))
    expect(decodeSqliteText(payload)).toBe('list')
  })

  it('falls back to String() for other types', () => {
    expect(decodeSqliteText(42)).toBe('42')
  })
})

describe('parseJsonColumn', () => {
  it('parses JSON strings', () => {
    const result = parseJsonColumn('{"ok":true}', null)
    expect(result).toEqual({ ok: true })
  })

  it('parses Uint8Array payloads', () => {
    const payload = encoder.encode('{"value":2}')
    const result = parseJsonColumn(payload, null)
    expect(result).toEqual({ value: 2 })
  })

  it('returns fallback on invalid JSON', () => {
    const result = parseJsonColumn('not-json', { fallback: true })
    expect(result).toEqual({ fallback: true })
  })
})
