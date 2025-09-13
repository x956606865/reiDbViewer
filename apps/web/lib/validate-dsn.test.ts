import { describe, it, expect } from 'vitest'
import { validatePostgresDsn } from './validate-dsn'

describe('validatePostgresDsn', () => {
  it('accepts valid postgres URL with sslmode=require', () => {
    const dsn = 'postgres://user:pass@example.com:5432/db?sslmode=require'
    const ck = validatePostgresDsn(dsn)
    expect(ck.ok).toBe(true)
  })

  it('rejects invalid protocol', () => {
    const ck = validatePostgresDsn('mysql://user:pass@host/db')
    expect(ck.ok).toBe(false)
  })

  it('allows private/local hosts', () => {
    const ck = validatePostgresDsn('postgres://user:pass@127.0.0.1:5432/db?sslmode=require')
    expect(ck.ok).toBe(true)
    const ck2 = validatePostgresDsn('postgres://user:pass@192.168.1.2:5432/db?sslmode=require')
    expect(ck2.ok).toBe(true)
  })

  it('allows sslmode=disable (not recommended for prod)', () => {
    const ck = validatePostgresDsn('postgres://user:pass@db.example.com:5432/db?sslmode=disable')
    expect(ck.ok).toBe(true)
  })
})
