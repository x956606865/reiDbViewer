import { describe, it, expect } from 'vitest'
import { validatePostgresDsn } from './validate-dsn'

describe('validatePostgresDsn', () => {
  it('accepts basic postgres urls', () => {
    expect(validatePostgresDsn('postgres://u:p@localhost:5432/db').ok).toBe(true)
    expect(validatePostgresDsn('postgresql://u@127.0.0.1/db').ok).toBe(true)
  })
  it('rejects non-postgres protocols', () => {
    expect(validatePostgresDsn('mysql://u:p@h/db').ok).toBe(false)
  })
  it('rejects invalid port', () => {
    expect(validatePostgresDsn('postgres://u:p@h:99999/db').ok).toBe(false)
  })
  it('rejects invalid url', () => {
    expect(validatePostgresDsn('not a url').ok).toBe(false)
  })
})

