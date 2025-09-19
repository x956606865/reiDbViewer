import { beforeEach, describe, expect, it, vi } from 'vitest'
import { simulateReadableStream, type UIMessage } from 'ai'
import { DesktopChatTransport } from './desktop-transport'
import type { AssistantContextChunk } from '@/lib/assistant/context-chunks'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const invokeMock = vi.mocked((await import('@tauri-apps/api/core')).invoke)

const sampleMessage: UIMessage = {
  id: 'msg_user',
  role: 'user',
  parts: [
    {
      type: 'text',
      text: 'Hello assistant',
    },
  ],
}

const chunk = (overrides: Partial<AssistantContextChunk> = {}): AssistantContextChunk => ({
  id: overrides.id ?? 'chunk_1',
  kind: overrides.kind ?? 'schema-table',
  title: overrides.title ?? 'public.users',
  summary: overrides.summary ?? '2 columns',
  content: overrides.content ?? { columns: 2 },
})

const providerSettings = {
  provider: 'openai' as const,
  model: 'gpt-4o-mini',
  temperature: 0.3,
  maxTokens: 2048,
  baseUrl: 'https://api.openai.com/v1',
}

beforeEach(() => {
  invokeMock.mockReset()
})

describe('DesktopChatTransport', () => {
  it('sends context chunks to the Tauri command', async () => {
    invokeMock.mockResolvedValue({ message: 'ok' })
    const fallback = {
      sendMessages: vi.fn().mockResolvedValue(simulateReadableStream({ chunks: [] })),
      reconnectToStream: vi.fn(),
    }
    const transport = new DesktopChatTransport({ fallback })
    transport.setProviderSettings(providerSettings)
    transport.setContextChunks([chunk({ id: 'ctx_1' })])
    await transport.sendMessages({ messages: [sampleMessage] })
    expect(invokeMock).toHaveBeenCalledTimes(1)
    const args = invokeMock.mock.calls[0]?.[1] as {
      payload: { context_chunks: Array<{ id: string }>; provider?: typeof providerSettings }
    }
    expect(args.payload.context_chunks[0]?.id).toBe('ctx_1')
    expect(args.payload.provider).toEqual(providerSettings)
  })

  it('falls back to mock transport when invoke fails', async () => {
    invokeMock.mockRejectedValueOnce(new Error('invoke failed'))
    const fallback = {
      sendMessages: vi.fn().mockResolvedValue(simulateReadableStream({ chunks: [] })),
      reconnectToStream: vi.fn(),
    }
    const transport = new DesktopChatTransport({ fallback })
    await transport.sendMessages({ messages: [sampleMessage] })
    expect(fallback.sendMessages).toHaveBeenCalled()
  })
})
