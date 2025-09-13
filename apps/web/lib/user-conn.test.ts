import { describe, it, expect, beforeEach, vi } from 'vitest'
import { __test__ } from './user-conn'

describe('user-conn utils', () => {
  beforeEach(() => {
    process.env.APP_DB_TABLE_PREFIX = 'rdv_'
  })

  it('tableName respects prefix', () => {
    expect(__test__.tableName()).toBe('rdv_user_connections')
    process.env.APP_DB_TABLE_PREFIX = 'app_'
    expect(__test__.tableName()).toBe('app_user_connections')
  })

  it('parseSslFromUrl handles sslmode', () => {
    const p = __test__.parseSslFromUrl
    expect(p('postgres://u:p@h/db?sslmode=require')).toBe(true)
    expect(p('postgres://u:p@h/db?sslmode=disable')).toBe(false)
    expect(p('postgres://u:p@h/db?sslmode=no-verify')).toEqual({ rejectUnauthorized: false })
    expect(p('postgres://u:p@h/db?sslmode=verify-full')).toEqual({ rejectUnauthorized: true })
    expect(p('postgres://u:p@h/db')).toBeUndefined()
  })
})

