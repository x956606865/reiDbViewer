import { create } from 'zustand'
import type { UIMessage } from 'ai'
import { calculateAggregatedMetrics, deriveConversationTitle, estimateTokenUsage, snapshotContextChunks, type AssistantConversationMessage, type AssistantMessageMetrics, type ConversationMetricsSummary } from './conversation-utils'
import type { AssistantContextChunk } from './context-chunks'
import { loadConversationPayload, saveConversationPayload, type StoredAssistantConversation } from './conversation-storage'

export type AssistantConversationRecord = StoredAssistantConversation & {
  metrics: ConversationMetricsSummary
}

type State = {
  ready: boolean
  loading: boolean
  activeId: string | null
  conversations: AssistantConversationRecord[]
  archivedConversations: AssistantConversationRecord[]
}

type Actions = {
  initialize: () => Promise<void>
  createConversation: (opts?: { connectionId?: string | null; title?: string }) => Promise<AssistantConversationRecord>
  ensureConversation: (opts?: { connectionId?: string | null }) => Promise<AssistantConversationRecord>
  selectConversation: (id: string | null) => void
  persistMessages: (params: {
    conversationId: string
    messages: UIMessage[]
    contextChunks?: AssistantContextChunk[]
    connectionId?: string | null
    updatedAt?: number
    contextSummaries?: Record<string, string | null | undefined>
  }) => Promise<void>
  renameConversation: (conversationId: string, title: string) => Promise<void>
  archiveConversation: (conversationId: string) => Promise<void>
  restoreConversation: (conversationId: string) => Promise<void>
  deleteConversation: (conversationId: string) => Promise<void>
  recordAssistantMetrics: (conversationId: string, messageId: string, metrics: AssistantMessageMetrics) => Promise<void>
}

type AssistantSessionStore = State & Actions

const now = () => Date.now()

function normalizeTitle(input: string): string {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return 'New conversation'
  if (trimmed.length <= 120) return trimmed
  return trimmed.slice(0, 119).trimEnd() + '…'
}

function mergeMessageMetrics(
  base: AssistantMessageMetrics | undefined,
  patch: AssistantMessageMetrics,
): AssistantMessageMetrics {
  return {
    latencyMs: patch.latencyMs ?? base?.latencyMs,
    inputTokens: patch.inputTokens ?? base?.inputTokens,
    outputTokens: patch.outputTokens ?? base?.outputTokens,
    contextTokens: patch.contextTokens ?? base?.contextTokens,
    contextBytes: patch.contextBytes ?? base?.contextBytes,
  }
}

type MessagePart = UIMessage['parts'][number]

function isTextPart(part: MessagePart | null | undefined): part is Extract<MessagePart, { type: 'text'; text: string }> {
  return Boolean(part && typeof part === 'object' && 'type' in part && part.type === 'text' && typeof part.text === 'string')
}

function extractMessageText(message: UIMessage): string {
  if (!message) return ''
  const parts = Array.isArray(message.parts) ? message.parts : []
  const textFromParts = parts.map((part) => (isTextPart(part) ? part.text : '')).join('')
  if (textFromParts) return textFromParts

  const content = (message as any).content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const textFromContent = content
      .map((item) => {
        const candidate = item as MessagePart | undefined
        return isTextPart(candidate) ? candidate.text : ''
      })
      .join('')
    if (textFromContent) return textFromContent
  }

  const fallback = (message as any).text
  if (typeof fallback === 'string') return fallback
  return ''
}

function toConversationMessages(messages: UIMessage[]): AssistantConversationMessage[] {
  const result: AssistantConversationMessage[] = []
  for (const message of messages) {
    if (!message) continue
    const text = extractMessageText(message)
    result.push({
      id: message.id,
      role: message.role,
      text,
      createdAt: message.createdAt ? Number(new Date(message.createdAt)) : now(),
      error: message.role === 'assistant' && message.content === undefined ? 'response_incomplete' : null,
      metrics: undefined,
      metadata: message.metadata ? { ...message.metadata } : null,
    })
  }
  return result
}

function attachMetrics(messages: AssistantConversationMessage[], metricsMap: Map<string, AssistantMessageMetrics>) {
  for (const message of messages) {
    const metrics = metricsMap.get(message.id)
    if (metrics) {
      message.metrics = mergeMessageMetrics(message.metrics, metrics)
    }
  }
}

function applyHeuristicMetrics(messages: AssistantConversationMessage[]) {
  for (const message of messages) {
    const tokens = estimateTokenUsage(message.text ?? '')
    if (message.role === 'user' && tokens > 0) {
      message.metrics = mergeMessageMetrics(message.metrics, { inputTokens: tokens })
    } else if (message.role === 'assistant' && tokens > 0) {
      message.metrics = mergeMessageMetrics(message.metrics, { outputTokens: tokens })
    }
  }
}

function computeMetrics(messages: AssistantConversationMessage[]): ConversationMetricsSummary {
  if (!messages || messages.length === 0) {
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalContextTokens: 0,
      messageCount: 0,
      averageLatencyMs: 0,
      lastLatencyMs: null,
    }
  }
  return calculateAggregatedMetrics(messages)
}

function splitConversations(
  list: AssistantConversationRecord[],
): { active: AssistantConversationRecord[]; archived: AssistantConversationRecord[] } {
  const active: AssistantConversationRecord[] = []
  const archived: AssistantConversationRecord[] = []
  for (const conv of list) {
    if (conv.archivedAt) archived.push(conv)
    else active.push(conv)
  }
  return { active, archived }
}

function stateToPayload(state: State): { conversations: StoredAssistantConversation[]; activeId: string | null } {
  const combined = [...state.conversations, ...state.archivedConversations]
  const stored: StoredAssistantConversation[] = combined.map(({ metrics: _metrics, ...rest }) => ({
    ...rest,
    contextSnapshot: rest.contextSnapshot ?? [],
    messages: rest.messages ?? [],
  }))
  return { conversations: stored, activeId: state.activeId }
}

async function persist(getStore: () => AssistantSessionStore): Promise<void> {
  const store = getStore()
  const snapshot: State = {
    ready: store.ready,
    loading: store.loading,
    activeId: store.activeId,
    conversations: store.conversations,
    archivedConversations: store.archivedConversations,
  }
  const payload = stateToPayload(snapshot)
  await saveConversationPayload({ version: 1, activeId: payload.activeId ?? null, conversations: payload.conversations })
}

function hydrateFromStored(list: StoredAssistantConversation[]): AssistantConversationRecord[] {
  return list.map((conv) => ({
    ...conv,
    contextSnapshot: conv.contextSnapshot ?? [],
    messages: conv.messages ?? [],
    metrics: computeMetrics(conv.messages ?? []),
  }))
}

export const useAssistantSessions = create<AssistantSessionStore>((set, get) => ({
  ready: false,
  loading: false,
  activeId: null,
  conversations: [],
  archivedConversations: [],

  async initialize() {
    if (get().ready) return
    set({ loading: true })
    const payload = await loadConversationPayload()
    const hydrated = hydrateFromStored(payload.conversations)
    const { active, archived } = splitConversations(hydrated)
    const activeId = payload.activeId && active.some((conv) => conv.id === payload.activeId) ? payload.activeId : active[0]?.id ?? null
    set({
      ready: true,
      loading: false,
      activeId,
      conversations: active,
      archivedConversations: archived,
    })
  },

  async createConversation(opts) {
    const createdAt = now()
    const id = `conv_${createdAt.toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const conversation: AssistantConversationRecord = {
      id,
      title: normalizeTitle(opts?.title || 'New conversation'),
      createdAt,
      updatedAt: createdAt,
      archivedAt: null,
      connectionId: opts?.connectionId ?? null,
      contextSnapshot: [],
      messages: [],
      metrics: computeMetrics([]),
    }
    set((prev) => ({
      activeId: id,
      conversations: [conversation, ...prev.conversations],
    }))
    await persist(get)
    return conversation
  },

  async ensureConversation(opts) {
    const state = get()
    if (state.activeId) {
      const existing = state.conversations.find((conv) => conv.id === state.activeId)
      if (existing) return existing
    }
    return await get().createConversation(opts)
  },

  selectConversation(id) {
    const state = get()
    if (id && !state.conversations.some((conv) => conv.id === id)) return
    set({ activeId: id })
  },

  async persistMessages({ conversationId, messages, contextChunks, connectionId, updatedAt, contextSummaries }) {
    const existing = get().conversations.find((conv) => conv.id === conversationId)
    if (!existing) return
    const metricsMap = new Map<string, AssistantMessageMetrics>()
    for (const message of existing.messages) {
      if (message.metrics) metricsMap.set(message.id, message.metrics)
    }
    const summaryMap = new Map<string, string | null>()
    for (const message of existing.messages) {
      if (typeof message.contextSummary === 'string') {
        summaryMap.set(message.id, message.contextSummary)
      } else if (message.contextSummary === null) {
        summaryMap.set(message.id, null)
      }
    }
    const converted = toConversationMessages(messages)
    for (const message of converted) {
      if (contextSummaries && message.id in contextSummaries) {
        const override = contextSummaries[message.id]
        message.contextSummary = override ?? null
      } else if (summaryMap.has(message.id)) {
        const retained = summaryMap.get(message.id)
        message.contextSummary = retained ?? null
      }
    }
    attachMetrics(converted, metricsMap)
    applyHeuristicMetrics(converted)
    const metrics = computeMetrics(converted)
    const title = normalizeTitle(deriveConversationTitle(converted, existing.title))
    const snapshot = contextChunks ? snapshotContextChunks(contextChunks) : existing.contextSnapshot
    const nextUpdatedAt = updatedAt ?? now()
    set((prev) => {
      const updated = prev.conversations.map((conv) => {
        if (conv.id !== conversationId) return conv
        return {
          ...conv,
          title,
          messages: converted,
          contextSnapshot: snapshot,
          connectionId: connectionId ?? conv.connectionId,
          updatedAt: nextUpdatedAt,
          metrics,
        }
      })
      return { conversations: updated }
    })
    await persist(get)
  },

  async renameConversation(conversationId, title) {
    const normalized = normalizeTitle(title)
    set((prev) => {
      const activeUpdated = prev.conversations.map((conv) =>
        conv.id === conversationId
          ? {
              ...conv,
              title: normalized,
              updatedAt: now(),
            }
          : conv,
      )
      const archivedUpdated = prev.archivedConversations.map((conv) =>
        conv.id === conversationId
          ? {
              ...conv,
              title: normalized,
              updatedAt: now(),
            }
          : conv,
      )
      return {
        conversations: activeUpdated,
        archivedConversations: archivedUpdated,
      }
    })
    await persist(get)
  },

  async archiveConversation(conversationId) {
    const timestamp = now()
    set((prev) => {
      const remaining: AssistantConversationRecord[] = []
      const archived = [...prev.archivedConversations]
      for (const conv of prev.conversations) {
        if (conv.id === conversationId) {
          archived.unshift({ ...conv, archivedAt: timestamp, updatedAt: timestamp })
        } else {
          remaining.push(conv)
        }
      }
      const activeId = prev.activeId === conversationId ? remaining[0]?.id ?? null : prev.activeId
      return {
        activeId,
        conversations: remaining,
        archivedConversations: archived,
      }
    })
    await persist(get)
  },

  async restoreConversation(conversationId) {
    const timestamp = now()
    set((prev) => {
      const archived: AssistantConversationRecord[] = []
      let restored: AssistantConversationRecord | null = null
      for (const conv of prev.archivedConversations) {
        if (conv.id === conversationId) {
          restored = { ...conv, archivedAt: null, updatedAt: timestamp }
        } else {
          archived.push(conv)
        }
      }
      if (!restored) return prev
      return {
        activeId: restored.id,
        conversations: [restored, ...prev.conversations],
        archivedConversations: archived,
      }
    })
    await persist(get)
  },

  async deleteConversation(conversationId) {
    set((prev) => {
      const conversations = prev.conversations.filter((conv) => conv.id !== conversationId)
      const archivedConversations = prev.archivedConversations.filter((conv) => conv.id !== conversationId)
      const activeId = prev.activeId === conversationId ? conversations[0]?.id ?? null : prev.activeId
      return {
        conversations,
        archivedConversations,
        activeId,
      }
    })
    await persist(get)
  },

  async recordAssistantMetrics(conversationId, messageId, metrics) {
    if (!metrics) return
    set((prev) => {
      const updated = prev.conversations.map((conv) => {
        if (conv.id !== conversationId) return conv
        const messages = conv.messages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                metrics: mergeMessageMetrics(message.metrics, metrics),
              }
            : message,
        )
        return {
          ...conv,
          messages,
          metrics: computeMetrics(messages),
          updatedAt: now(),
        }
      })
      return { conversations: updated }
    })
    await persist(get)
  },
}))

if (typeof window !== 'undefined') {
  ;(window as any).__assistantSessions = useAssistantSessions
}

export const __test__ = {
  toConversationMessages,
  extractMessageText,
}
