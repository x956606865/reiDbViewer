import { describe, expect, it } from 'vitest'
import { __test__ } from './prompt-library-store'

describe('sanitizePromptInput', () => {
  it('trims title and body, rejects empty body', () => {
    const sanitized = __test__.sanitizePromptInput({ title: '  My Prompt  ', body: '  Hello world  ' })
    expect(sanitized.title).toBe('My Prompt')
    expect(sanitized.body).toBe('Hello world')
  })

  it('throws when body missing', () => {
    expect(() => __test__.sanitizePromptInput({ title: 'x', body: '  ' })).toThrowError()
  })
})

describe('mergeCustomPrompts', () => {
  it('deduplicates by id and keeps latest updatedAt', () => {
    const older = { id: 'p1', title: 'One', body: 'A', category: null, createdAt: 1, updatedAt: 1 }
    const newer = { id: 'p1', title: 'One', body: 'B', category: null, createdAt: 1, updatedAt: 5 }
    const merged = __test__.mergeCustomPrompts([older], newer)
    expect(merged).toHaveLength(1)
    expect(merged[0]!.body).toBe('B')
  })
})
