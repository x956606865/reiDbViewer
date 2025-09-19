import { describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'

vi.mock('./conversation-storage', () => ({
  loadConversationPayload: vi.fn().mockResolvedValue({ version: 1, activeId: null, conversations: [] }),
  saveConversationPayload: vi.fn().mockResolvedValue(undefined),
}))

import { __test__ } from './session-store'

const { extractMessageText, toConversationMessages } = __test__

describe('toConversationMessages', () => {
  it('falls back to content when parts are empty', () => {
    const messages: UIMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        // @ts-expect-error minimal mock
        parts: [],
        content: 'Answer from assistant',
        createdAt: new Date(),
      },
    ]
    const converted = toConversationMessages(messages)
    expect(converted).toHaveLength(1)
    expect(converted[0]?.text).toBe('Answer from assistant')
  })

  it('extracts text from content array items', () => {
    const message = {
      id: 'assistant-2',
      role: 'assistant',
      parts: [],
      content: [
        {
          // @ts-expect-error minimal mock
          type: 'text',
          text: 'Chunk A',
        },
        {
          // @ts-expect-error minimal mock
          type: 'text',
          text: ' & Chunk B',
        },
      ],
      createdAt: new Date(),
    } as unknown as UIMessage

    expect(extractMessageText(message)).toBe('Chunk A & Chunk B')
  })
})
