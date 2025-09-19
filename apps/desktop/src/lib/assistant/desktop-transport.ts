import { invoke } from '@tauri-apps/api/core'
import {
  ChatTransport,
  generateId,
  simulateReadableStream,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import type { AssistantContextChunk } from '@/lib/assistant/context-chunks'
import { MockChatTransport } from '@/lib/assistant/mock-transport'

const STREAM_DELAY_MS = 45

type DesktopChatRequest = {
  messages: Array<{ role: string; text: string }>
  context_chunks: Array<{
    id: string
    title: string
    kind: string
    summary: string
    content: unknown
  }>
}

type DesktopChatResponse = {
  message: string
}

type MessagePart = UIMessage['parts'][number]

type TextPart = Extract<MessagePart, { type: 'text'; text: string }>

function isTextPart(part: MessagePart): part is TextPart {
  return part.type === 'text'
}

function extractText(message: UIMessage): string {
  return message.parts.filter(isTextPart).map((part) => part.text).join('')
}

function toChunks(messageId: string, content: string): UIMessageChunk[] {
  const words = content.match(/[^\s]+\s*|\s+/g) ?? [content]
  const base: UIMessageChunk[] = [
    { type: 'start', messageId },
    { type: 'text-start', id: messageId },
  ]
  const deltas: UIMessageChunk[] = words.map((delta) => ({
    type: 'text-delta',
    id: messageId,
    delta,
  }))
  const closing: UIMessageChunk[] = [
    { type: 'text-end', id: messageId },
    { type: 'finish', messageMetadata: undefined },
  ]
  return [...base, ...deltas, ...closing]
}

export type DesktopChatTransportOptions = {
  fallback?: ChatTransport<UIMessage>
  onFallback?: (error: unknown) => void
  onSuccess?: () => void
}

export class DesktopChatTransport implements ChatTransport<UIMessage> {
  private contextChunks: AssistantContextChunk[] = []
  private readonly fallback: ChatTransport<UIMessage>
  private readonly onFallback?: (error: unknown) => void
  private readonly onSuccess?: () => void

  constructor(options: DesktopChatTransportOptions = {}) {
    this.fallback = options.fallback ?? new MockChatTransport()
    this.onFallback = options.onFallback
    this.onSuccess = options.onSuccess
  }

  setContextChunks(chunks: AssistantContextChunk[]) {
    this.contextChunks = chunks
  }

  private buildRequest(messages: UIMessage[]): DesktopChatRequest {
    return {
      messages: messages.map((message) => ({
        role: message.role,
        text: extractText(message),
      })),
      context_chunks: this.contextChunks.map((chunk) => ({
        id: chunk.id,
        title: chunk.title,
        kind: chunk.kind,
        summary: chunk.summary,
        content: chunk.content,
      })),
    }
  }

  async sendMessages({ messages }: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]) {
    try {
      const request = this.buildRequest(messages)
      console.info('[assistant] sending request payload', request)
      const response = await invoke<DesktopChatResponse>('assistant_chat', { payload: request })
      this.onSuccess?.()
      const messageId = generateId()
      const chunks = toChunks(messageId, response.message)
      return simulateReadableStream({
        chunks,
        initialDelayInMs: 60,
        chunkDelayInMs: STREAM_DELAY_MS,
      })
    } catch (err) {
      this.onFallback?.(err)
      console.warn('assistant_chat failed, falling back to mock transport', err)
      return this.fallback.sendMessages({ messages })
    }
  }

  async reconnectToStream() {
    return null
  }
}

export const __test__ = {
  extractText,
  toChunks,
}
