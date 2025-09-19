import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Alert, Box, Button, Group, Paper, Stack, Text, Textarea, Title } from '@mantine/core'
import { useChat } from '@ai-sdk/react'
import type { UIMessage, ChatTransport } from 'ai'
import { Streamdown } from 'streamdown'
import { sanitizeMarkdownText } from '@/lib/assistant/markdown-sanitize'
import type { AssistantContextChunk } from '@/lib/assistant/context-chunks'
import { estimateTokenUsage, type AssistantMessageMetrics } from '@/lib/assistant/conversation-utils'

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
  return message.parts.filter(isTextPart).map((part) => part.text).join('')
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
  pendingPrompt: string | null
  onPromptConsumed: () => void
  initialMessages: UIMessage[]
  onPersistMessages: (messages: UIMessage[], opts?: { updatedAt?: number }) => void | Promise<void>
  onAssistantMetrics: (messageId: string, metrics: AssistantMessageMetrics) => void | Promise<void>
  transportNotice?: string | null
  onDismissTransportNotice?: () => void
}

export function ChatPanel({
  conversationId,
  transport,
  contextChunks,
  pendingPrompt,
  onPromptConsumed,
  initialMessages,
  onPersistMessages,
  onAssistantMetrics,
  transportNotice,
  onDismissTransportNotice,
}: ChatPanelProps) {
  const chatId = conversationId ?? 'assistant-default'
  const activeRequestRef = useRef<{
    startedAt: number
    inputTokens?: number
    contextTokens?: number
    contextBytes?: number
  } | null>(null)
  const lastPersistRef = useRef<{ conversationId: string | null; userId?: string; assistantId?: string; signature?: string }>({
    conversationId: null,
  })
  const { messages, sendMessage, status, stop, error, clearError } = useChat({
    id: chatId,
    initialMessages,
    transport,
    onFinish(message, options) {
      const meta = activeRequestRef.current
      activeRequestRef.current = null
      const latencyMs = meta ? Math.max(0, performance.now() - meta.startedAt) : undefined
      const text = extractText(message)
      const metrics: AssistantMessageMetrics = {
        latencyMs,
        inputTokens: options.usage?.promptTokens ?? meta?.inputTokens,
        outputTokens: options.usage?.completionTokens ?? estimateTokenUsage(text),
        contextTokens: meta?.contextTokens,
        contextBytes: meta?.contextBytes,
      }
      void onAssistantMetrics(message.id, metrics)
    },
    onError() {
      activeRequestRef.current = null
    },
  })
  const [input, setInput] = useState('')
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
    const persist = (opts?: { updatedAt?: number }) => {
      void onPersistMessages(messages, opts)
    }
    const latestUser = [...messages].filter((message) => message.role === 'user').at(-1)
    if (status === 'submitted' && latestUser && lastPersistRef.current.userId !== latestUser.id) {
      persist()
      lastPersistRef.current.userId = latestUser.id
    }
    if ((status === 'idle' || status === 'error') && messages.length > 0) {
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

  const enhancedMessages = useMemo(() => withText(messages), [messages])
  const isStreaming = status === 'submitted' || status === 'streaming'

  const handleSubmit = useCallback(
    (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault()
      const value = input.trim()
      if (!value) return
      const startedAt = performance.now()
      const contextPayload = contextChunks.length > 0 ? JSON.stringify(contextChunks) : ''
      const contextBytes = contextPayload.length
      const contextTokens = contextBytes > 0 ? Math.ceil(contextBytes / 4) : 0
      activeRequestRef.current = {
        startedAt,
        inputTokens: estimateTokenUsage(value),
        contextTokens,
        contextBytes,
      }
      void sendMessage({ text: value })
      setInput('')
    },
    [input, contextChunks, sendMessage],
  )

  return (
    <Stack gap="md" h="100%">
      <Box>
        <Title order={3}>Assistant</Title>
        <Text size="sm" c="dimmed">
          Context chunks selected: {contextChunks.length}
        </Text>
      </Box>
      <Paper withBorder radius="md" shadow="xs" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Box style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          <Stack gap="sm">
            {enhancedMessages.map((message) => {
              const isUser = message.role === 'user'
              const sanitized = sanitizeMarkdownText(message.text)
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
                    {sanitized ? <Streamdown>{sanitized}</Streamdown> : null}
                  </Paper>
                </Stack>
              )
            })}
            <div ref={messagesEndRef} />
          </Stack>
        </Box>
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
        <Box component="form" onSubmit={handleSubmit} style={{ padding: '12px 16px', borderTop: '1px solid var(--mantine-color-gray-3)' }}>
          <Stack gap="xs">
            <Textarea
              placeholder="Ask the assistant..."
              value={input}
              onChange={(event) => setInput(event.currentTarget.value)}
              autosize
              minRows={3}
              maxRows={6}
              disabled={status === 'error'}
            />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {isStreaming ? 'Streaming response…' : 'Ready for your prompt.'}
              </Text>
              <Group gap="xs">
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
