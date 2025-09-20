import type { AssistantContextChunk } from './context-chunks'

export type AssistantMessageMetrics = {
  latencyMs?: number
  inputTokens?: number
  outputTokens?: number
  contextTokens?: number
  contextBytes?: number
}

export type AssistantConversationMessage = {
  id: string
  role: 'system' | 'user' | 'assistant' | 'data'
  text: string
  createdAt: number
  error?: string | null
  metrics?: AssistantMessageMetrics
  contextSummary?: string | null
  metadata?: Record<string, unknown> | null
}

export type ConversationMetricsSummary = {
  totalInputTokens: number
  totalOutputTokens: number
  totalContextTokens: number
  messageCount: number
  averageLatencyMs: number
  lastLatencyMs: number | null
}

const TITLE_MAX_LENGTH = 80
const SUMMARY_MAX_LENGTH = 240

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function trimSummary(summary: string): string {
  if (!summary) return ''
  if (summary.length <= SUMMARY_MAX_LENGTH) return summary
  return summary.slice(0, SUMMARY_MAX_LENGTH - 1).trimEnd() + '…'
}

function cloneContent(content: unknown): Record<string, unknown> {
  if (content == null) return {}
  try {
    const serialized = JSON.stringify(content)
    if (!serialized) return {}
    return JSON.parse(serialized) as Record<string, unknown>
  } catch (err) {
    console.warn('snapshotContextChunks: failed to clone context content', err)
    return {}
  }
}

export function deriveConversationTitle(
  messages: AssistantConversationMessage[],
  fallbackTitle: string,
): string {
  const fallback = fallbackTitle?.trim() || 'New conversation'
  for (const message of messages) {
    if (message.role !== 'user') continue
    const normalized = normalizeWhitespace(message.text ?? '')
    if (!normalized) continue
    if (normalized.length <= TITLE_MAX_LENGTH) return normalized
    return normalized.slice(0, TITLE_MAX_LENGTH - 1).trimEnd() + '…'
  }
  return fallback
}

export function estimateTokenUsage(text: string): number {
  if (!text) return 0
  const normalized = normalizeWhitespace(text)
  if (!normalized) return 0
  const estimated = Math.ceil(normalized.length / 4)
  return estimated > 0 ? estimated : 0
}

export function calculateAggregatedMetrics(
  messages: AssistantConversationMessage[],
): ConversationMetricsSummary {
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalContextTokens = 0
  let latencySum = 0
  let latencyCount = 0
  let lastLatency: number | null = null

  for (const message of messages) {
    const metrics = message.metrics
    if (!metrics) continue
    if (typeof metrics.inputTokens === 'number' && Number.isFinite(metrics.inputTokens)) {
      totalInputTokens += Math.max(0, Math.floor(metrics.inputTokens))
    }
    if (typeof metrics.outputTokens === 'number' && Number.isFinite(metrics.outputTokens)) {
      totalOutputTokens += Math.max(0, Math.floor(metrics.outputTokens))
    }
    if (typeof metrics.contextTokens === 'number' && Number.isFinite(metrics.contextTokens)) {
      totalContextTokens += Math.max(0, Math.floor(metrics.contextTokens))
    }
    if (typeof metrics.latencyMs === 'number' && Number.isFinite(metrics.latencyMs)) {
      latencySum += metrics.latencyMs
      latencyCount += 1
      lastLatency = metrics.latencyMs
    }
  }

  const averageLatencyMs = latencyCount > 0 ? latencySum / latencyCount : 0

  return {
    totalInputTokens,
    totalOutputTokens,
    totalContextTokens,
    messageCount: messages.length,
    averageLatencyMs,
    lastLatencyMs: lastLatency,
  }
}

export function snapshotContextChunks(
  chunks: AssistantContextChunk[],
  limit = 12,
): AssistantContextChunk[] {
  if (!Array.isArray(chunks) || chunks.length === 0) return []
  const capped = Math.max(0, Math.floor(limit)) || 0
  const slice = capped > 0 ? chunks.slice(0, capped) : chunks.slice()
  return slice.map((chunk) => ({
    id: chunk.id,
    kind: chunk.kind,
    title: chunk.title,
    summary: trimSummary(chunk.summary ?? ''),
    content: cloneContent(chunk.content ?? {}),
  }))
}

export const __test__ = {
  normalizeWhitespace,
  trimSummary,
  cloneContent,
}
