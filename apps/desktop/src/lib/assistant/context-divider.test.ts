import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  CONTEXT_DIVIDER_MARKER,
  createContextDividerMessage,
  getContextDividerStatus,
  normalizeContextDividerMessage,
  prepareMessagesForRequest,
} from './context-divider'

describe('context divider helpers', () => {
  it('returns only messages after the last applied divider', () => {
    const userBefore: UIMessage = {
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'text', text: 'old question' }],
      createdAt: new Date(),
    }
    const divider = createContextDividerMessage('divider-1', 'applied')
    const userAfter: UIMessage = {
      id: 'user-2',
      role: 'user',
      parts: [{ type: 'text', text: 'new question' }],
      createdAt: new Date(),
    }

    const result = prepareMessagesForRequest([userBefore, divider, userAfter])
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('user-2')
  })

  it('drops pending divider without trimming earlier messages', () => {
    const userBefore: UIMessage = {
      id: 'user-1',
      role: 'user',
      parts: [{ type: 'text', text: 'old question' }],
      createdAt: new Date(),
    }
    const divider = createContextDividerMessage('divider-1', 'pending')
    const userAfter: UIMessage = {
      id: 'user-2',
      role: 'user',
      parts: [{ type: 'text', text: 'new question' }],
      createdAt: new Date(),
    }

    const result = prepareMessagesForRequest([userBefore, divider, userAfter])
    expect(result.map((message) => message.id)).toEqual(['user-1', 'user-2'])
  })

  it('normalizes divider metadata when absent', () => {
    const legacyDivider: UIMessage = {
      id: 'divider-legacy',
      role: 'system',
      parts: [{ type: 'text', text: CONTEXT_DIVIDER_MARKER }],
      createdAt: new Date(),
    }

    const normalized = normalizeContextDividerMessage(legacyDivider)
    expect(getContextDividerStatus(normalized)).toBe('applied')
  })
})
