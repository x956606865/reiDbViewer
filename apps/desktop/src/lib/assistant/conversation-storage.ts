import Database from '@tauri-apps/plugin-sql'
import type { AssistantContextChunk } from './context-chunks'
import type { AssistantConversationMessage, AssistantMessageMetrics } from './conversation-utils'

const STORAGE_KEY = 'assistant.conversations.v1'
const MAX_CONVERSATIONS = 40
const MAX_MESSAGES_PER_CONVERSATION = 200

export type StoredAssistantMessage = AssistantConversationMessage

export type StoredAssistantConversation = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  archivedAt: number | null
  connectionId: string | null
  contextSnapshot: AssistantContextChunk[]
  messages: StoredAssistantMessage[]
}

export type ConversationStoragePayload = {
  version: 1
  activeId: string | null
  conversations: StoredAssistantConversation[]
}

const DEFAULT_PAYLOAD: ConversationStoragePayload = {
  version: 1,
  activeId: null,
  conversations: [],
}

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function sanitizeMetrics(metrics: AssistantMessageMetrics | null | undefined): AssistantMessageMetrics | undefined {
  if (!metrics || typeof metrics !== 'object') return undefined
  const sanitized: AssistantMessageMetrics = {}
  if (typeof metrics.latencyMs === 'number' && Number.isFinite(metrics.latencyMs)) {
    sanitized.latencyMs = Math.max(0, metrics.latencyMs)
  }
  if (typeof metrics.inputTokens === 'number' && Number.isFinite(metrics.inputTokens)) {
    sanitized.inputTokens = Math.max(0, Math.floor(metrics.inputTokens))
  }
  if (typeof metrics.outputTokens === 'number' && Number.isFinite(metrics.outputTokens)) {
    sanitized.outputTokens = Math.max(0, Math.floor(metrics.outputTokens))
  }
  if (typeof metrics.contextTokens === 'number' && Number.isFinite(metrics.contextTokens)) {
    sanitized.contextTokens = Math.max(0, Math.floor(metrics.contextTokens))
  }
  if (typeof metrics.contextBytes === 'number' && Number.isFinite(metrics.contextBytes)) {
    sanitized.contextBytes = Math.max(0, Math.floor(metrics.contextBytes))
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

function sanitizeMessage(raw: any): StoredAssistantMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const role = typeof raw.role === 'string' ? raw.role : 'assistant'
  if (!['system', 'user', 'assistant', 'data'].includes(role)) return null
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : generateId('msg')
  const text = typeof raw.text === 'string' ? raw.text : ''
  const createdAt = Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : Date.now()
  const error = typeof raw.error === 'string' ? raw.error : null
  const metrics = sanitizeMetrics(raw.metrics)
  return {
    id,
    role: role as StoredAssistantMessage['role'],
    text,
    createdAt,
    error,
    metrics,
  }
}

function sanitizeContextSnapshot(raw: any): AssistantContextChunk[] {
  if (!Array.isArray(raw)) return []
  const sanitized: AssistantContextChunk[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id : null
    const kind = typeof item.kind === 'string' ? item.kind : null
    const title = typeof item.title === 'string' ? item.title : ''
    const summary = typeof item.summary === 'string' ? item.summary : ''
    if (!id || !kind) continue
    let content: Record<string, unknown> = {}
    try {
      content = item.content && typeof item.content === 'object' ? JSON.parse(JSON.stringify(item.content)) : {}
    } catch {
      content = {}
    }
    sanitized.push({ id, kind, title, summary, content })
  }
  return sanitized
}

function sortMessages(messages: StoredAssistantMessage[]): StoredAssistantMessage[] {
  return [...messages].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}

function sanitizeConversation(raw: any): StoredAssistantConversation | null {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : generateId('conv')
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'New conversation'
  const createdAt = Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : Date.now()
  const updatedAt = Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : createdAt
  const archivedAt = Number.isFinite(raw.archivedAt) ? Number(raw.archivedAt) : null
  const connectionId = typeof raw.connectionId === 'string' ? raw.connectionId : null
  const messagesRaw: any[] = Array.isArray(raw.messages) ? raw.messages : []
  const sanitizedMessages: StoredAssistantMessage[] = []
  for (const msg of messagesRaw) {
    const sanitized = sanitizeMessage(msg)
    if (sanitized) sanitizedMessages.push(sanitized)
  }
  const limitedMessages = sortMessages(sanitizedMessages).slice(-MAX_MESSAGES_PER_CONVERSATION)
  const contextSnapshot = sanitizeContextSnapshot(raw.contextSnapshot)
  return {
    id,
    title,
    createdAt,
    updatedAt,
    archivedAt,
    connectionId,
    contextSnapshot,
    messages: limitedMessages,
  }
}

function ensureActiveId(payload: ConversationStoragePayload): ConversationStoragePayload {
  if (!payload.activeId) return payload
  const exists = payload.conversations.some((conv) => conv.id === payload.activeId)
  if (exists) return payload
  return { ...payload, activeId: payload.conversations[0]?.id ?? null }
}

function applyLimits(payload: ConversationStoragePayload): ConversationStoragePayload {
  const sorted = [...payload.conversations].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const limited: StoredAssistantConversation[] = []
  for (const conv of sorted) {
    if (limited.length >= MAX_CONVERSATIONS) break
    limited.push({ ...conv, messages: conv.messages.slice(-MAX_MESSAGES_PER_CONVERSATION) })
  }
  let activeId = payload.activeId
  if (activeId && !limited.some((conv) => conv.id === activeId)) {
    activeId = limited[0]?.id ?? null
  }
  return {
    version: 1,
    activeId,
    conversations: limited,
  }
}

async function openLocalDb() {
  return await Database.load('sqlite:rdv_local.db')
}

export async function loadConversationPayload(): Promise<ConversationStoragePayload> {
  try {
    const db = await openLocalDb()
    // @ts-ignore select exists at runtime
    const rows = await db.select<any[]>(`SELECT v FROM app_prefs WHERE k = $1`, [STORAGE_KEY])
    const raw = Array.isArray(rows) ? rows[0]?.v : undefined
    if (!raw) return DEFAULT_PAYLOAD
    const parsed = JSON.parse(String(raw)) as ConversationStoragePayload | null
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.conversations)) return DEFAULT_PAYLOAD
    const sanitizedConversations: StoredAssistantConversation[] = []
    for (const item of parsed.conversations) {
      const conv = sanitizeConversation(item)
      if (conv) sanitizedConversations.push(conv)
    }
    const payload: ConversationStoragePayload = {
      version: 1,
      activeId: parsed.activeId ?? null,
      conversations: sanitizedConversations,
    }
    return ensureActiveId(applyLimits(payload))
  } catch (err) {
    console.warn('loadConversationPayload failed', err)
    return DEFAULT_PAYLOAD
  }
}

export async function saveConversationPayload(payload: ConversationStoragePayload): Promise<void> {
  const sanitized = applyLimits(payload)
  const db = await openLocalDb()
  // @ts-ignore execute exists at runtime
  await db.execute(
    `INSERT INTO app_prefs (k, v) VALUES ($1, $2)
     ON CONFLICT(k) DO UPDATE SET v = EXCLUDED.v`,
    [STORAGE_KEY, JSON.stringify(sanitized)],
  )
}

export const __test__ = {
  sanitizeConversation,
  sanitizeMessage,
  sanitizeMetrics,
}
