import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'

vi.mock('./conversation-storage', () => ({
  loadConversationPayload: vi.fn().mockResolvedValue({ version: 1, activeId: null, conversations: [] }),
  saveConversationPayload: vi.fn().mockResolvedValue(undefined),
}))

// eslint-disable-next-line import/first
import { useAssistantSessions } from './session-store'

const sampleUser: UIMessage = {
  id: 'user-1',
  role: 'user',
  parts: [
    {
      type: 'text',
      text: 'Hello there',
    },
  ],
  createdAt: new Date('2025-01-01T00:00:00Z'),
}

const sampleAssistant: UIMessage = {
  id: 'assistant-1',
  role: 'assistant',
  parts: [
    {
      type: 'text',
      text: 'Hi, how can I help?',
    },
  ],
  createdAt: new Date('2025-01-01T00:00:01Z'),
}

const sampleDivider: UIMessage = {
  id: 'divider-1',
  role: 'system',
  parts: [
    {
      type: 'text',
      text: '__context-divider__',
    },
  ],
  metadata: {
    type: 'context-divider',
    status: 'applied',
  },
  createdAt: new Date('2025-01-01T00:00:02Z'),
}

function resetStore() {
  useAssistantSessions.setState({
    ready: true,
    loading: false,
    activeId: null,
    conversations: [],
    archivedConversations: [],
  })
}

describe('assistant session store persistence', () => {
  beforeEach(() => {
    resetStore()
  })

  it('captures assistant messages when persisting', async () => {
    const { createConversation, persistMessages } = useAssistantSessions.getState()
    const conversation = await createConversation({ title: 'Test conversation' })
    await persistMessages({
      conversationId: conversation.id,
      messages: [sampleUser, sampleAssistant],
    })
    const stored = useAssistantSessions
      .getState()
      .conversations.find((conv) => conv.id === conversation.id)
    expect(stored).toBeTruthy()
    expect(stored?.messages.filter((msg) => msg.role === 'assistant')).toHaveLength(1)
    expect(stored?.messages.find((msg) => msg.role === 'assistant')?.text).toBe('Hi, how can I help?')
  })

  it('stores context summary for user messages when provided', async () => {
    const { createConversation, persistMessages } = useAssistantSessions.getState()
    const conversation = await createConversation({ title: 'Test conversation' })
    const contextSummary = 'Context summary:\n1. Table "public"."users" — 3 columns'
    await persistMessages({
      conversationId: conversation.id,
      messages: [sampleUser],
      contextSummaries: { [sampleUser.id]: contextSummary },
    })
    const stored = useAssistantSessions
      .getState()
      .conversations.find((conv) => conv.id === conversation.id)
    expect(stored?.messages.find((msg) => msg.id === sampleUser.id)?.contextSummary).toBe(contextSummary)
  })

  it('persists system message metadata', async () => {
    const { createConversation, persistMessages } = useAssistantSessions.getState()
    const conversation = await createConversation({ title: 'Divider conversation' })
    await persistMessages({ conversationId: conversation.id, messages: [sampleDivider] })
    const stored = useAssistantSessions
      .getState()
      .conversations.find((conv) => conv.id === conversation.id)
    expect(stored?.messages.find((msg) => msg.id === sampleDivider.id)?.metadata).toEqual({
      type: 'context-divider',
      status: 'applied',
    })
  })
})
