import { describe, it, expect } from 'vitest'
import { buildOpsQuery } from '../src/queries'

describe('ops queries', () => {
  it('builds long_running_activity with defaults', () => {
    const { text, values } = buildOpsQuery('long_running_activity', undefined)
    expect(text).toMatch(/FROM pg_catalog\.pg_stat_activity/i)
    expect(text).toMatch(/interval '1 minute' \* \$1/)
    expect(Array.isArray(values)).toBe(true)
    expect(values[0]).toBe(5)
  })

  it('respects params and clamps types', () => {
    const { text, values } = buildOpsQuery('long_running_activity', { minMinutes: 10, limit: 50, notIdle: false })
    expect(text).toMatch(/WHERE TRUE\n\s+AND pid <> pg_backend_pid\(\)/)
    expect(values[0]).toBe(10)
    expect(values[1]).toBe(50)
  })

  it('builds blocking_activity', () => {
    const { text, values } = buildOpsQuery('blocking_activity', { minMinutes: 2, limit: 100 })
    expect(text).toMatch(/pg_blocking_pids\(a\.pid\)/)
    expect(text).toMatch(/JOIN\s+pg_catalog\.pg_stat_activity b ON b\.pid = bp\.blocking_pid/i)
    expect(values[0]).toBe(2)
    expect(values[1]).toBe(100)
  })

  it('builds waiting_locks', () => {
    const { text, values } = buildOpsQuery('waiting_locks', { limit: 20 })
    expect(text).toMatch(/FROM pg_catalog\.pg_locks l/i)
    expect(text).toMatch(/WHERE l\.granted = FALSE/i)
    expect(values[0]).toBe(20)
  })
})
