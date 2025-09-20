import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Alert, Badge, Box, Button, Group, Modal, Paper, Select, Stack, Table, Text, Textarea, Title } from '@mantine/core'
import { useChat } from '@ai-sdk/react'
import type { UIMessage, ChatTransport } from 'ai'
import { Streamdown } from 'streamdown'
import { sanitizeMarkdownText } from '@/lib/assistant/markdown-sanitize'
import type { AssistantContextChunk } from '@/lib/assistant/context-chunks'
import { estimateTokenUsage, type AssistantMessageMetrics } from '@/lib/assistant/conversation-utils'
import { formatContextSummary } from '@/lib/assistant/context-summary'
import type { AssistantTransportMetadata, AssistantTransportUsage } from '@/lib/assistant/desktop-transport'
import type { SafetyEvaluation } from '@/lib/assistant/security-guard'
import type { SimulatedToolCall } from '@/lib/assistant/tooling'
import { IconGhost, IconX } from '@tabler/icons-react'
import { shouldSubmitOnShiftEnter } from './shortcut-utils'

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
  const { messages, sendMessage, status, stop, error, clearError } = useChat({
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
        setToolCalls(metadata.toolCalls)
        setSafetyInfo(metadata.safety)
        setUsage(metadata.usage ?? null)
      }
    },
    onError() {
      activeRequestRef.current = null
    },
  })
  const [input, setInput] = useState('')
  const [toolCalls, setToolCalls] = useState<SimulatedToolCall[]>([])
  const [safetyInfo, setSafetyInfo] = useState<SafetyEvaluation | null>(null)
  const [usage, setUsage] = useState<AssistantTransportUsage | null>(null)
  const [contextPreview, setContextPreview] = useState<{ messageId: string | null; summary: string }>({
    messageId: null,
    summary: '',
  })
  const [contextPreviewOpened, setContextPreviewOpened] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

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

  const toolCallCards = useMemo(() => {
    if (!toolCalls || toolCalls.length === 0) return null
    return toolCalls.map((call) => {
      const isSuccess = call.status === 'success'
      return (
        <Paper key={call.id} withBorder radius="md" p="sm">
          <Stack gap="xs">
            <Group justify="space-between" align="flex-start">
              <Stack gap={0}>
                <Text size="sm" fw={600}>
                  Tool: {call.name}
                </Text>
                <Text size="xs" c="dimmed">
                  Preview for SQL (read-only): {call.input.sql.slice(0, 120)}{call.input.sql.length > 120 ? '…' : ''}
                </Text>
              </Stack>
              <Badge color={isSuccess ? 'teal' : 'yellow'} variant={isSuccess ? 'light' : 'outline'}>
                {call.status === 'success' ? 'Simulated' : 'Needs attention'}
              </Badge>
            </Group>
            {isSuccess && call.result ? (
              <Table striped withColumnBorders>
                <Table.Thead>
                  <Table.Tr>
                    {call.result.columns.map((column) => (
                      <Table.Th key={column}>{column}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {call.result.rows.map((row, index) => (
                    <Table.Tr key={index}>
                      {call.result.columns.map((column) => (
                        <Table.Td key={column}>{String((row as Record<string, unknown>)[column] ?? '')}</Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            ) : null}
            {!isSuccess && call.message ? (
              <Alert color="yellow" variant="light" icon={<IconX size={16} />}> 
                {call.message}
              </Alert>
            ) : null}
            {isSuccess && call.result?.summary ? (
              <Text size="xs" c="dimmed">
                {call.result.summary}
              </Text>
            ) : null}
          </Stack>
        </Paper>
      )
    })
  }, [toolCalls])

  const lastAssistantMessageId = useMemo(() => {
    for (let index = enhancedMessages.length - 1; index >= 0; index -= 1) {
      const candidate = enhancedMessages[index]
      if (candidate.role === 'assistant') {
        return candidate.id
      }
    }
    return null
  }, [enhancedMessages])

  const handleSubmit = useCallback(
    (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault()
      const value = input.trim()
      if (!value) return
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
      setToolCalls([])
      setSafetyInfo(null)
      setUsage(null)
      void sendMessage({ text: value })
      setInput('')
    },
    [input, contextChunks, sendMessage],
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
              const isUser = message.role === 'user'
              const sanitized = sanitizeMarkdownText(message.text)
              const contextSummary = contextSummaries[message.id] ?? null
              const hasContextSummary = typeof contextSummary === 'string' && contextSummary.trim().length > 0
              const isLastAssistantMessage = !isUser && message.id === lastAssistantMessageId
              const shouldRenderToolCalls = isLastAssistantMessage && !!toolCallCards
              const hasContent = Boolean(sanitized) || shouldRenderToolCalls
              return (
                <Stack
                  key={message.id}
                  gap={4}
                  align={isUser ? 'flex-end' : 'flex-start'}
                  style={{ width: '100%' }}
                >
                  <Text size="xs" c="dimmed">
                    {isUser ? 'You' : 'Assistant'}
                  </Text>
                  <Paper
                    withBorder
                    radius="md"
                    p="sm"
                    bg={isUser ? 'var(--mantine-color-blue-0)' : 'var(--mantine-color-gray-0)'}
                    style={{ maxWidth: '720px', width: '100%' }}
                  >
                    {hasContent ? (
                      <Stack gap="sm">
                        {sanitized ? (
                          <div className="assistant-markdown">
                            <Streamdown>{sanitized}</Streamdown>
                          </div>
                        ) : null}
                        {shouldRenderToolCalls ? <Stack gap="sm">{toolCallCards}</Stack> : null}
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
              <Text size="xs" c="dimmed">
                {isStreaming ? 'Streaming response…' : 'Ready for your prompt.'}
              </Text>
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
