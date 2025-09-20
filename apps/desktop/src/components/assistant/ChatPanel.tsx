import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core'
import { useChat } from '@ai-sdk/react'
import type { UIMessage, ChatTransport } from 'ai'
import { Streamdown } from 'streamdown'
import { sanitizeMarkdownText } from '@/lib/assistant/markdown-sanitize'
import type { AssistantContextChunk } from '@/lib/assistant/context-chunks'
import { estimateTokenUsage, type AssistantMessageMetrics } from '@/lib/assistant/conversation-utils'
import { formatContextSummary } from '@/lib/assistant/context-summary'
import type { AssistantTransportMetadata, AssistantTransportUsage } from '@/lib/assistant/desktop-transport'
import type { SafetyEvaluation } from '@/lib/assistant/security-guard'
import { IconGhost } from '@tabler/icons-react'
import { shouldSubmitOnShiftEnter } from './shortcut-utils'
import {
  createContextDividerMessage,
  createContextDividerMetadata,
  CONTEXT_DIVIDER_MARKER,
  getContextDividerStatus,
  isContextDividerMessage,
  normalizeContextDividerMessage,
  readContextDividerMetadata,
} from '@/lib/assistant/context-divider'

export const INITIAL_MESSAGES: UIMessage[] = [
  {
    id: 'assistant-welcome',
    role: 'assistant',
    parts: [
      {
        type: 'text',
        text: 'Assistant initialized. Select context on the left and ask a question to begin.',
      },
    ],
  },
]

type MessagePart = UIMessage['parts'][number]
type TextPart = Extract<MessagePart, { type: 'text'; text: string }>

type MessageWithText = UIMessage & { text: string }

function isTextPart(part: MessagePart): part is TextPart {
  return part.type === 'text'
}

function extractText(message: UIMessage): string {
  const parts = Array.isArray(message.parts) ? message.parts : []
  if (parts.length === 0) {
    const fallback = (message as any).content || (message as any).text
    return typeof fallback === 'string' ? fallback : ''
  }
  return parts.filter(isTextPart).map((part) => part.text).join('')
}

function withText(messages: UIMessage[]): MessageWithText[] {
  return messages.map((message) => ({
    ...message,
    text: extractText(message),
  }))
}

export type ChatPanelProps = {
  conversationId: string | null
  transport: ChatTransport<UIMessage>
  contextChunks: AssistantContextChunk[]
  contextSummaries: Record<string, string | null | undefined>
  pendingPrompt: string | null
  onPromptConsumed: () => void
  initialMessages: UIMessage[]
  onPersistMessages: (
    messages: UIMessage[],
    opts?: { updatedAt?: number },
    contextSummaries?: Record<string, string | null | undefined>,
  ) => void | Promise<void>
  onAssistantMetrics: (messageId: string, metrics: AssistantMessageMetrics) => void | Promise<void>
  transportNotice?: string | null
  onDismissTransportNotice?: () => void
  profileOptions: { value: string; label: string }[]
  modelOptions: { value: string; label: string }[]
  selectedProfileId: string
  selectedModelId: string
  onSelectProfile: (profileId: string) => void
  onSelectModel: (modelId: string) => void
  onOpenSettings: () => void
  apiKeyReady: boolean
}

export function ChatPanel({
  conversationId,
  transport,
  contextChunks,
  contextSummaries,
  pendingPrompt,
  onPromptConsumed,
  initialMessages,
  onPersistMessages,
  onAssistantMetrics,
  transportNotice,
  onDismissTransportNotice,
  profileOptions,
  modelOptions,
  selectedProfileId,
  selectedModelId,
  onSelectProfile,
  onSelectModel,
  onOpenSettings,
  apiKeyReady,
}: ChatPanelProps) {
  const chatId = conversationId ?? 'assistant-default'
  const activeRequestRef = useRef<{
    startedAt: number
    inputTokens?: number
    contextTokens?: number
    contextBytes?: number
    contextSummary?: string | null
  } | null>(null)
  const lastPersistRef = useRef<{ conversationId: string | null; userId?: string; assistantId?: string; signature?: string }>({
    conversationId: null,
  })

  const { messages, setMessages, sendMessage, status, stop, error, clearError } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
    onFinish(message, options) {
      const meta = activeRequestRef.current
      activeRequestRef.current = null
      const latencyMs = meta ? Math.max(0, performance.now() - meta.startedAt) : undefined
      const text = extractText(message)
      const usage = options?.usage
      const metrics: AssistantMessageMetrics = {
        latencyMs,
        inputTokens: usage?.promptTokens ?? meta?.inputTokens,
        outputTokens: usage?.completionTokens ?? estimateTokenUsage(text),
        contextTokens: meta?.contextTokens,
        contextBytes: meta?.contextBytes,
      }
      void onAssistantMetrics(message.id, metrics)
      if (typeof (transport as any)?.consumeLastMetadata === 'function') {
        const metadata = (transport as any).consumeLastMetadata() as AssistantTransportMetadata
        setSafetyInfo(metadata.safety)
        setUsage(metadata.usage ?? null)
      }
    },
    onError() {
      activeRequestRef.current = null
    },
  })
  const [pendingDividerId, setPendingDividerId] = useState<string | null>(null)
  const prevConversationIdRef = useRef<string | null>(null)
  const [input, setInput] = useState('')
  const [safetyInfo, setSafetyInfo] = useState<SafetyEvaluation | null>(null)
  const [usage, setUsage] = useState<AssistantTransportUsage | null>(null)
  const [contextPreview, setContextPreview] = useState<{ messageId: string | null; summary: string }>({
    messageId: null,
    summary: '',
  })
  const [contextPreviewOpened, setContextPreviewOpened] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (prevConversationIdRef.current === conversationId) return
    prevConversationIdRef.current = conversationId

    let pending: string | null = null
    for (const message of initialMessages) {
      if (!isContextDividerMessage(message)) continue
      const status = getContextDividerStatus(message)
      if (status === 'pending') {
        pending = message.id
      }
    }
    setPendingDividerId(pending)

    if (initialMessages.some((message) => isContextDividerMessage(message) && !readContextDividerMetadata(message.metadata))) {
      setMessages((prev) => {
        let modified = false
        const updated = prev.map((message) => {
          if (!isContextDividerMessage(message)) return message
          const metadata = readContextDividerMetadata(message.metadata)
          if (metadata) return message
          modified = true
          return normalizeContextDividerMessage(message)
        })
        return modified ? updated : prev
      })
    }
  }, [conversationId, initialMessages, setMessages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (pendingPrompt && pendingPrompt.trim().length > 0) {
      setInput((prev) => {
        if (!prev) return pendingPrompt
        if (prev.endsWith('\n')) return prev + pendingPrompt
        return `${prev}\n${pendingPrompt}`
      })
      onPromptConsumed()
    }
  }, [pendingPrompt, onPromptConsumed])

  useEffect(() => {
    if (lastPersistRef.current.conversationId !== conversationId) {
      lastPersistRef.current = { conversationId }
    }
  }, [conversationId])

  useEffect(() => {
    if (!conversationId) return
    const lastState = lastPersistRef.current
    if (lastState.conversationId !== conversationId) {
      lastPersistRef.current = { conversationId }
    }
    const persist = (
      opts?: { updatedAt?: number },
      overrides?: Record<string, string | null | undefined>,
    ) => {
      void onPersistMessages(messages, opts, overrides)
    }
    const latestUser = [...messages].filter((message) => message.role === 'user').at(-1)
    if (status === 'submitted' && latestUser && lastPersistRef.current.userId !== latestUser.id) {
      const pendingSummary = activeRequestRef.current?.contextSummary
      const overrides = pendingSummary !== undefined ? { [latestUser.id]: pendingSummary } : undefined
      persist(undefined, overrides)
      lastPersistRef.current.userId = latestUser.id
    }
    const isResponseSettled = status === 'idle' || status === 'ready' || status === 'error'
    if (isResponseSettled && messages.length > 0) {
      const latestAssistant = [...messages].filter((message) => message.role === 'assistant').at(-1)
      if (latestAssistant && lastPersistRef.current.assistantId !== latestAssistant.id) {
        persist({ updatedAt: Date.now() })
        lastPersistRef.current.assistantId = latestAssistant.id
        lastPersistRef.current.signature = messages.map((msg) => `${msg.id}:${extractText(msg)}`).join('|')
      } else {
        const signature = messages.map((msg) => `${msg.id}:${extractText(msg)}`).join('|')
        if (signature !== lastPersistRef.current.signature) {
          persist({ updatedAt: Date.now() })
          lastPersistRef.current.signature = signature
        }
      }
    }
  }, [messages, status, conversationId, onPersistMessages])

  const dismissNotice = useCallback(() => {
    onDismissTransportNotice?.()
  }, [onDismissTransportNotice])

  const handleProfileSelect = useCallback(
    (value: string | null) => {
      if (!value) return
      onSelectProfile(value)
    },
    [onSelectProfile],
  )

  const handleModelSelect = useCallback(
    (value: string | null) => {
      if (!value) return
      onSelectModel(value)
    },
    [onSelectModel],
  )

  const enhancedMessages = useMemo(() => withText(messages), [messages])
  const isStreaming = status === 'submitted' || status === 'streaming'
  const handleToggleClearContext = useCallback(() => {
    if (isStreaming) return
    if (pendingDividerId) {
      setMessages((prev) => prev.filter((message) => message.id !== pendingDividerId))
      setPendingDividerId(null)
      return
    }
    const id = `context-divider-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const dividerMessage = createContextDividerMessage(id, 'pending')
    setMessages((prev) => [...prev, dividerMessage])
    setPendingDividerId(id)
  }, [isStreaming, pendingDividerId, setMessages])
  const usageBadges = useMemo(() => {
    if (!usage) return []
    const items: string[] = []
    if (usage.promptTokens) items.push(`Prompt ${usage.promptTokens}`)
    if (usage.completionTokens) items.push(`Output ${usage.completionTokens}`)
    if (usage.totalTokens && usage.totalTokens !== usage.promptTokens && usage.totalTokens !== usage.completionTokens) {
      items.push(`Total ${usage.totalTokens}`)
    }
    return items
  }, [usage])

  const shouldShowSafetyAlert = useMemo(() => {
    if (!safetyInfo) return false
    if (safetyInfo.severity === 'none') return false
    return safetyInfo.triggers.length > 0
  }, [safetyInfo])

  const handleSubmit = useCallback(
    (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault()
      const value = input.trim()
      if (!value) return
      if (pendingDividerId) {
        const appliedId = pendingDividerId
        setMessages((prev) => {
          let modified = false
          const updated = prev.map((message) => {
            if (message.id !== appliedId) return message
            modified = true
            const metadata = readContextDividerMetadata(message.metadata)
            const nextMetadata = createContextDividerMetadata('applied', metadata)
            const nextParts =
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
              parts: nextParts,
            }
          })
          return modified ? updated : prev
        })
        setPendingDividerId(null)
      }
      const startedAt = performance.now()
      const contextPayload = contextChunks.length > 0 ? JSON.stringify(contextChunks) : ''
      const contextBytes = contextPayload.length
      const contextTokens = contextBytes > 0 ? Math.ceil(contextBytes / 4) : 0
      const contextSummary = formatContextSummary(contextChunks)
      activeRequestRef.current = {
        startedAt,
        inputTokens: estimateTokenUsage(value),
        contextTokens,
        contextBytes,
        contextSummary,
      }
      setSafetyInfo(null)
      setUsage(null)
      void sendMessage({ text: value })
      setInput('')
    },
    [input, contextChunks, sendMessage, pendingDividerId, setMessages, setPendingDividerId],
  )

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        !shouldSubmitOnShiftEnter(event, {
          hasInput: input.trim().length > 0,
          isStreaming,
          isError: status === 'error',
        })
      ) {
        return
      }
      event.preventDefault()
      handleSubmit()
    },
    [handleSubmit, input, isStreaming, status],
  )

  return (
    <Stack gap="md" h="100%" style={{ minHeight: 0 }}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <Stack gap={4}>
          <Title order={3}>Assistant</Title>
          {usageBadges.length > 0 ? (
            <Group gap="xs">
              {usageBadges.map((badge) => (
                <Badge key={badge} variant="light">
                  {badge}
                </Badge>
              ))}
            </Group>
          ) : (
            <Text size="sm" c="dimmed">
              发送请求后会显示 token 统计。
            </Text>
          )}
        </Stack>
        <Button
          variant={apiKeyReady ? 'light' : 'filled'}
          color={apiKeyReady ? 'teal' : 'yellow'}
          size="xs"
          onClick={onOpenSettings}
        >
          {apiKeyReady ? '更新 API key' : '配置 API key'}
        </Button>
      </Group>
      <Paper
        withBorder
        radius="md"
        shadow="xs"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <Box style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px' }}>
          <Stack gap="sm">
            {enhancedMessages.map((message) => {
              if (isContextDividerMessage(message)) {
                const status = getContextDividerStatus(message)
                const label = status === 'pending' ? '清除上下文（待生效）' : '清除上下文'
                const color = status === 'pending' ? 'orange' : 'gray'
                return (
                  <Divider
                    key={message.id}
                    label={label}
                    labelPosition="center"
                    variant="dashed"
                    color={color}
                    labelProps={{ style: { fontSize: 12, fontWeight: 500 } }}
                    style={{ marginBlock: '8px' }}
                  />
                )
              }
              const isUser = message.role === 'user'
              const sanitized = sanitizeMarkdownText(message.text)
              const contextSummary = contextSummaries[message.id] ?? null
              const hasContextSummary = typeof contextSummary === 'string' && contextSummary.trim().length > 0
              const hasContent = Boolean(sanitized)
              return (
                <Stack key={message.id} gap={4} align="flex-start" style={{ width: '100%' }}>
                  <Text size="xs" c="dimmed">
                    {isUser ? 'You' : 'Assistant'}
                  </Text>
                  <Paper
                    withBorder
                    radius="md"
                    p="sm"
                    bg={isUser ? 'var(--mantine-color-blue-0)' : 'var(--mantine-color-gray-0)'}
                    style={{ width: '100%' }}
                  >
                    {hasContent ? (
                      <Stack gap="sm">
                        {sanitized ? (
                          <div className="assistant-markdown">
                            <Streamdown>{sanitized}</Streamdown>
                          </div>
                        ) : null}
                      </Stack>
                    ) : null}
                  </Paper>
                  {isUser && hasContextSummary ? (
                    <Button
                      variant="subtle"
                      size="xs"
                      leftSection={<IconGhost size={14} />}
                      onClick={() => {
                        setContextPreview({ messageId: message.id, summary: contextSummary ?? '' })
                        setContextPreviewOpened(true)
                      }}
                    >
                      查看 Context summary
                    </Button>
                  ) : null}
                </Stack>
              )
            })}
            <div ref={messagesEndRef} />
          </Stack>
        </Box>
        {shouldShowSafetyAlert && safetyInfo ? (
          <Alert
            color={safetyInfo.severity === 'block' ? 'red' : 'yellow'}
            variant="light"
            mx="md"
            mb="sm"
            title={safetyInfo.severity === 'block' ? 'Response blocked for safety' : 'Sensitive content detected'}
          >
            <Stack gap={4}>
              <Text size="sm">
                The assistant detected the following patterns and adjusted the reply:
              </Text>
              {safetyInfo.triggers.slice(0, 5).map((trigger, index) => (
                <Text key={`${trigger.pattern}-${index}`} size="xs" c="dimmed">
                  • {trigger.kind}: {trigger.match}
                </Text>
              ))}
              {safetyInfo.triggers.length > 5 ? (
                <Text size="xs" c="dimmed">
                  + {safetyInfo.triggers.length - 5} more triggers
                </Text>
              ) : null}
            </Stack>
          </Alert>
        ) : null}
        {error ? (
          <Alert color="red" title="Assistant error" mx="md" mb="sm">
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm">{error.message}</Text>
              <Button size="xs" variant="light" onClick={clearError}>
                Dismiss
              </Button>
            </Group>
          </Alert>
        ) : null}
        <Modal
          opened={contextPreviewOpened}
          onClose={() => setContextPreviewOpened(false)}
          title="Context summary"
          size="lg"
        >
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              发送该条消息时附带的上下文概要如下：
            </Text>
            <div className="assistant-markdown">
              <Streamdown>{contextPreview.summary}</Streamdown>
            </div>
          </Stack>
        </Modal>
        <Box component="form" onSubmit={handleSubmit} style={{ padding: '12px 16px', borderTop: '1px solid var(--mantine-color-gray-3)' }}>
          <Stack gap="xs">
            <Textarea
              placeholder="Ask the assistant..."
              value={input}
              onChange={(event) => setInput(event.currentTarget.value)}
              onKeyDown={handleComposerKeyDown}
              autosize
              minRows={3}
              maxRows={6}
              disabled={status === 'error'}
            />
            <Group justify="space-between" align="flex-end" gap="sm" wrap="wrap">
              <Group gap="xs" align="center">
                <Text size="xs" c="dimmed">
                  {isStreaming ? 'Streaming response…' : 'Ready for your prompt.'}
                </Text>
                <Button
                  variant={pendingDividerId ? 'filled' : 'light'}
                  color={pendingDividerId ? 'orange' : 'gray'}
                  size="xs"
                  onClick={handleToggleClearContext}
                  disabled={isStreaming}
                >
                  {pendingDividerId ? '取消清除' : '清除上下文'}
                </Button>
              </Group>
              <Group gap="xs">
                <Select
                  data={profileOptions}
                  value={profileOptions.length > 0 ? selectedProfileId : null}
                  onChange={handleProfileSelect}
                  placeholder="选择配置"
                  size="xs"
                  maw={200}
                  comboboxProps={{ withinPortal: true }}
                  disabled={profileOptions.length === 0 || isStreaming}
                />
                <Select
                  data={modelOptions}
                  value={modelOptions.length > 0 ? selectedModelId : null}
                  onChange={handleModelSelect}
                  placeholder="选择模型"
                  size="xs"
                  maw={220}
                  comboboxProps={{ withinPortal: true }}
                  disabled={modelOptions.length === 0 || isStreaming}
                />
                {isStreaming ? (
                  <Button variant="light" onClick={() => stop()}>
                    Stop
                  </Button>
                ) : null}
                <Button type="submit" disabled={!input.trim() || isStreaming}>
                  Send
                </Button>
              </Group>
            </Group>
          </Stack>
        </Box>
      </Paper>
    </Stack>
  )
}
