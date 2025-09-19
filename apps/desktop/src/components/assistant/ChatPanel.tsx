import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Alert, Box, Button, Group, Paper, Stack, Text, Textarea, Title } from '@mantine/core'
import { useChat } from '@ai-sdk/react'
import type { UIMessage, ChatTransport } from 'ai'
import { Streamdown } from 'streamdown'
import { sanitizeMarkdownText } from '@/lib/assistant/markdown-sanitize'
import type { AssistantContextChunk } from '@/lib/assistant/context-chunks'

const INITIAL_MESSAGES: UIMessage[] = [
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

function withText(messages: UIMessage[]): MessageWithText[] {
  return messages.map((message) => ({
    ...message,
    text: message.parts.filter(isTextPart).map((part) => part.text).join(''),
  }))
}

export type ChatPanelProps = {
  transport: ChatTransport<UIMessage>
  contextChunks: AssistantContextChunk[]
  pendingPrompt: string | null
  onPromptConsumed: () => void
}

export function ChatPanel({ transport, contextChunks, pendingPrompt, onPromptConsumed }: ChatPanelProps) {
  const { messages, sendMessage, status, stop, error, clearError } = useChat({
    transport,
    messages: INITIAL_MESSAGES,
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

  const enhancedMessages = useMemo(() => withText(messages), [messages])
  const isStreaming = status === 'submitted' || status === 'streaming'

  const handleSubmit = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    const value = input.trim()
    if (!value) return
    void sendMessage({ text: value })
    setInput('')
  }

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
