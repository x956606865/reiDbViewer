import { describe, expect, it } from 'vitest'
import { evaluateAssistantResponseSafety } from './security-guard'

describe('evaluateAssistantResponseSafety', () => {
  it('flags destructive SQL instructions as block', () => {
    const result = evaluateAssistantResponseSafety('You should DROP TABLE users; and then DELETE FROM logs;')
    expect(result.severity).toBe('block')
    expect(result.triggers.some((trigger) => trigger.kind === 'write_sql')).toBe(true)
  })

  it('warns when response leaks secrets', () => {
    const result = evaluateAssistantResponseSafety('Use APP_ENCRYPTION_KEY=abcd to connect.')
    expect(result.severity).toBe('warn')
    expect(result.triggers.some((trigger) => trigger.kind === 'secret')).toBe(true)
  })

  it('returns none for ordinary read-only guidance', () => {
    const result = evaluateAssistantResponseSafety('SELECT * FROM users LIMIT 10;')
    expect(result.severity).toBe('none')
    expect(result.triggers).toHaveLength(0)
  })
})
