import { invoke } from '@tauri-apps/api/core'
import {
  ChatTransport,
  generateId,
  simulateReadableStream,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import type { AssistantContextChunk } from '@/lib/assistant/context-chunks'
import { formatContextSummary } from '@/lib/assistant/context-summary'
import { MockChatTransport } from '@/lib/assistant/mock-transport'
import { DEFAULT_ASSISTANT_SETTINGS, type AssistantProvider, type AssistantProviderSettings } from '@/lib/assistant/provider-settings'
import type { SafetyEvaluation } from '@/lib/assistant/security-guard'
import type { SimulatedToolCall } from '@/lib/assistant/tooling'
import { getAssistantApiKey } from '@/lib/assistant/api-key-store'
import { prepareMessagesForRequest } from '@/lib/assistant/context-divider'

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
  provider: AssistantProviderSettings
  context_summary?: string | null
}

type DesktopChatPayload = DesktopChatRequest & { apiKey?: string }

type DesktopChatResponse = {
  message: string
  tool_calls?: SimulatedToolCall[]
  safety?: SafetyEvaluation
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export type AssistantTransportUsage = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export type AssistantTransportMetadata = {
  toolCalls: SimulatedToolCall[]
  safety: SafetyEvaluation | null
  usage: AssistantTransportUsage | null
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
  private contextSummary: string | null = null
  private readonly fallback: ChatTransport<UIMessage>
  private readonly onFallback?: (error: unknown) => void
  private readonly onSuccess?: () => void
  private providerSettings: AssistantProviderSettings = DEFAULT_ASSISTANT_SETTINGS
  private lastMetadata: AssistantTransportMetadata = {
    toolCalls: [],
    safety: null,
    usage: null,
  }

  constructor(options: DesktopChatTransportOptions = {}) {
    this.fallback = options.fallback ?? new MockChatTransport()
    this.onFallback = options.onFallback
    this.onSuccess = options.onSuccess
  }

  setContextChunks(chunks: AssistantContextChunk[]) {
    this.contextChunks = chunks
    this.contextSummary = formatContextSummary(chunks)
  }

  setProviderSettings(settings: AssistantProviderSettings) {
    this.providerSettings = settings
  }

  consumeLastMetadata(): AssistantTransportMetadata {
    const snapshot = { ...this.lastMetadata }
    this.lastMetadata = { toolCalls: [], safety: null, usage: null }
    return snapshot
  }

  private buildRequest(messages: UIMessage[]): DesktopChatRequest {
    const contextSummary = this.contextSummary
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
      provider: this.providerSettings,
      context_summary: contextSummary ?? undefined,
    }
  }

  private async resolveApiKey(provider: AssistantProvider): Promise<string | undefined> {
    try {
      const value = await getAssistantApiKey(provider)
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : undefined
    } catch (error) {
      const optionalProvider = provider === 'lmstudio' || provider === 'ollama'
      if (!optionalProvider) {
        console.warn('Failed to resolve assistant API key', error)
      }
      return undefined
    }
  }

  async sendMessages({ messages }: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]) {
    const preparedMessages = prepareMessagesForRequest(messages)
    try {
      const request = this.buildRequest(preparedMessages)
      console.info('[assistant] sending request payload', request)
      try {
        console.debug('[assistant] payload json', JSON.stringify(request, null, 2))
      } catch (stringifyError) {
        console.warn('[assistant] failed to stringify payload', stringifyError)
      }
      const provider = this.providerSettings.provider
      const apiKey = await this.resolveApiKey(provider)
      const payload: DesktopChatPayload = apiKey ? { ...request, apiKey } : { ...request }
      const response = await invoke<DesktopChatResponse>('assistant_chat', { payload })
      this.onSuccess?.()
      this.lastMetadata = {
        toolCalls: response.tool_calls ?? [],
        safety: response.safety ?? null,
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : null,
      }
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
      this.lastMetadata = { toolCalls: [], safety: null, usage: null }
      return this.fallback.sendMessages({ messages: preparedMessages })
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
