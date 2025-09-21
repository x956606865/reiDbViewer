import type { UIMessage } from 'ai'

export const CONTEXT_DIVIDER_MARKER = '__context-divider__'
export const CONTEXT_DIVIDER_METADATA_TYPE = 'context-divider'

export type ContextDividerStatus = 'pending' | 'applied'

export type ContextDividerMetadata = {
  type: typeof CONTEXT_DIVIDER_METADATA_TYPE
  status: ContextDividerStatus
  createdAt?: number
}

export function isContextDividerText(text: string | null | undefined): boolean {
  return text === CONTEXT_DIVIDER_MARKER
}

export function readContextDividerMetadata(metadata: unknown): ContextDividerMetadata | null {
  if (!metadata || typeof metadata !== 'object') return null
  const record = metadata as Record<string, unknown>
  if (record.type !== CONTEXT_DIVIDER_METADATA_TYPE) return null
  const status = record.status
  if (status !== 'pending' && status !== 'applied') return null
  const createdAt =
    typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : undefined
  return { type: CONTEXT_DIVIDER_METADATA_TYPE, status, createdAt }
}

type MessageLike = Pick<UIMessage, 'parts' | 'metadata'> & Partial<UIMessage>

export function isContextDividerMessage(message: MessageLike | null | undefined): boolean {
  if (!message) return false
  if (readContextDividerMetadata(message.metadata)) return true
  const parts = Array.isArray(message.parts) ? message.parts : []
  return parts.some((part) => part && part.type === 'text' && isContextDividerText(part.text))
}

export function getContextDividerStatus(message: MessageLike): ContextDividerStatus | null {
  const meta = readContextDividerMetadata(message.metadata)
  if (meta) return meta.status
  return isContextDividerMessage(message) ? 'applied' : null
}

export function createContextDividerMetadata(
  status: ContextDividerStatus,
  existing?: ContextDividerMetadata | null,
): ContextDividerMetadata {
  const createdAt = existing?.createdAt ?? Date.now()
  return { type: CONTEXT_DIVIDER_METADATA_TYPE, status, createdAt }
}

export function createContextDividerMessage(id: string, status: ContextDividerStatus = 'pending'): UIMessage {
  const metadata = createContextDividerMetadata(status)
  const createdAt = new Date(metadata.createdAt ?? Date.now())
  return {
    id,
    role: 'system',
    metadata,
    parts: [
      {
        type: 'text',
        text: CONTEXT_DIVIDER_MARKER,
      },
    ],
    createdAt,
  }
}

export function normalizeContextDividerMessage(message: UIMessage): UIMessage {
  if (!isContextDividerMessage(message)) return message
  const metadata = readContextDividerMetadata(message.metadata)
  const nextMetadata = metadata ?? createContextDividerMetadata('applied')
  const parts =
    Array.isArray(message.parts) && message.parts.length > 0
      ? message.parts.map((part) =>
          part && part.type === 'text'
            ? {
                ...part,
                text: CONTEXT_DIVIDER_MARKER,
              }
            : part,
        )
      : [
          {
            type: 'text',
            text: CONTEXT_DIVIDER_MARKER,
          },
        ]
  return {
    ...message,
    metadata: nextMetadata,
    parts,
  }
}

export function prepareMessagesForRequest(messages: UIMessage[]): UIMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) return []
  let cutoffIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isContextDividerMessage(message)) continue
    if (getContextDividerStatus(message) === 'applied') {
      cutoffIndex = index
      break
    }
  }
  const sliced = cutoffIndex >= 0 ? messages.slice(cutoffIndex + 1) : [...messages]
  return sliced.filter((message) => !isContextDividerMessage(message))
}
