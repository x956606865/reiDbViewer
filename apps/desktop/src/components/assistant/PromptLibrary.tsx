import { useEffect, useMemo, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core'
import { IconPlus, IconTrash, IconArrowBarToDown } from '@tabler/icons-react'
import {
  createCustomPrompt,
  deleteCustomPrompt,
  getBuiltinPrompts,
  listCustomPrompts,
  type PromptTemplate,
} from '@/lib/assistant/prompt-library-store'

export type PromptLibraryProps = {
  onInsert: (body: string) => void
}

type FormState = {
  title: string
  category: string
  body: string
}

const initialForm: FormState = {
  title: '',
  category: '',
  body: '',
}

function PromptCard({ prompt, onInsert, onDelete }: {
  prompt: PromptTemplate
  onInsert: (prompt: PromptTemplate) => void
  onDelete?: (prompt: PromptTemplate) => void
}) {
  const badge = prompt.category ? <Badge variant="light">{prompt.category}</Badge> : null
  return (
    <Paper withBorder p="sm" radius="md">
      <Stack gap="xs">
        <Group justify="space-between" gap="xs">
          <Stack gap={2} style={{ flex: 1 }}>
            <Group gap="xs">
              <Text fw={600}>{prompt.title}</Text>
              {badge}
            </Group>
            <Text size="sm" c="dimmed" lineClamp={2}>
              {prompt.body}
            </Text>
          </Stack>
          <Group gap="xs">
            <ActionIcon variant="light" onClick={() => onInsert(prompt)} aria-label="Insert prompt">
              <IconArrowBarToDown size={16} />
            </ActionIcon>
            {prompt.isCustom && onDelete ? (
              <ActionIcon variant="subtle" color="red" onClick={() => onDelete(prompt)} aria-label="Delete prompt">
                <IconTrash size={16} />
              </ActionIcon>
            ) : null}
          </Group>
        </Group>
      </Stack>
    </Paper>
  )
}

export function PromptLibrary({ onInsert }: PromptLibraryProps) {
  const [customPrompts, setCustomPrompts] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [formOpened, setFormOpened] = useState(false)
  const [formState, setFormState] = useState<FormState>(initialForm)
  const [formError, setFormError] = useState<string | null>(null)

  const builtinPrompts = useMemo(() => getBuiltinPrompts(), [])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const list = await listCustomPrompts()
        setCustomPrompts(list)
      } catch (err) {
        console.warn('failed to load custom prompts', err)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  const handleInsert = (prompt: PromptTemplate) => {
    onInsert(prompt.body)
  }

  const handleDelete = async (prompt: PromptTemplate) => {
    try {
      await deleteCustomPrompt(prompt.id)
      setCustomPrompts((prev) => prev.filter((item) => item.id !== prompt.id))
    } catch (err) {
      console.warn('failed to delete prompt', err)
    }
  }

  const handleFormSubmit = async () => {
    try {
      setFormError(null)
      const created = await createCustomPrompt({
        title: formState.title,
        category: formState.category,
        body: formState.body,
      })
      setCustomPrompts((prev) => [created, ...prev])
      setFormState(initialForm)
      setFormOpened(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setFormError(message || 'Failed to create prompt')
    }
  }

  const isFormValid = formState.body.trim().length > 0

  return (
    <Stack gap="md" h="100%">
      <Group justify="space-between">
        <Title order={4}>Prompt Library</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setFormOpened(true)}>
          New prompt
        </Button>
      </Group>
      <ScrollArea style={{ flex: 1 }} scrollbarSize={6} offsetScrollbars>
        <Stack gap="sm">
          <Stack gap="xs">
            <Text size="sm" fw={600} c="dimmed">
              Built-in templates
            </Text>
            {builtinPrompts.map((prompt) => (
              <PromptCard key={prompt.id} prompt={prompt} onInsert={handleInsert} />
            ))}
          </Stack>
          <Divider label="Custom" labelPosition="center" />
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="sm" fw={600} c="dimmed">
                Custom templates
              </Text>
              {loading ? <Text size="xs" c="dimmed">Loading…</Text> : null}
            </Group>
            {customPrompts.length === 0 && !loading ? (
              <Text size="xs" c="dimmed">
                Create templates for frequently used tasks and insert them with one click.
              </Text>
            ) : null}
            {customPrompts.map((prompt) => (
              <PromptCard key={prompt.id} prompt={prompt} onInsert={handleInsert} onDelete={handleDelete} />
            ))}
          </Stack>
        </Stack>
      </ScrollArea>
      <Modal opened={formOpened} onClose={() => setFormOpened(false)} title="New prompt" centered>
        <Stack gap="sm">
          <TextInput
            label="Title"
            placeholder="Summarize a dataset"
            value={formState.title}
            onChange={(event) => setFormState((prev) => ({ ...prev, title: event.currentTarget.value }))}
          />
          <TextInput
            label="Category"
            placeholder="Optional"
            value={formState.category}
            onChange={(event) => setFormState((prev) => ({ ...prev, category: event.currentTarget.value }))}
          />
          <Textarea
            label="Prompt"
            minRows={4}
            autosize
            placeholder="Provide guidance for the assistant"
            value={formState.body}
            onChange={(event) => setFormState((prev) => ({ ...prev, body: event.currentTarget.value }))}
          />
          {formError ? (
            <Text size="xs" c="red">
              {formError}
            </Text>
          ) : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setFormOpened(false)}>
              Cancel
            </Button>
            <Button onClick={handleFormSubmit} disabled={!isFormValid}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
