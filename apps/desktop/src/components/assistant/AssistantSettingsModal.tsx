import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { IconCheck, IconKey, IconRefresh, IconTrash, IconX } from '@tabler/icons-react'
import {
  DEFAULT_ASSISTANT_SETTINGS,
  getSupportedProviders,
  getDefaultBaseUrl,
  getDefaultModel,
  loadAssistantSettings,
  normalizeAssistantSettings,
  saveAssistantSettings,
  type AssistantProvider,
  type AssistantProviderSettings,
} from '@/lib/assistant/provider-settings'
import {
  deleteAssistantApiKey,
  hasAssistantApiKey,
  setAssistantApiKey,
} from '@/lib/assistant/api-key-store'

export type AssistantSettingsModalProps = {
  opened: boolean
  onClose: () => void
  onSettingsSaved?: (settings: AssistantProviderSettings) => void
  onApiKeyChange?: (hasKey: boolean) => void
}

type StatusMessage = {
  color: 'green' | 'red' | 'yellow'
  text: string
}

export function AssistantSettingsModal({ opened, onClose, onSettingsSaved, onApiKeyChange }: AssistantSettingsModalProps) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<AssistantProviderSettings>(DEFAULT_ASSISTANT_SETTINGS)
  const [providerOptions] = useState(() =>
    getSupportedProviders().map((value) => ({
      value,
      label: value === 'lmstudio' ? 'LM Studio' : 'OpenAI',
    })),
  )
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [status, setStatus] = useState<StatusMessage | null>(null)

  useEffect(() => {
    if (!opened) return
    setStatus(null)
    setLoading(true)
    void (async () => {
      try {
        const loadedSettings = await loadAssistantSettings()
        const keyPresent = await hasAssistantApiKey(loadedSettings.provider)
        const ready = loadedSettings.provider === 'lmstudio' ? true : Boolean(keyPresent)
        setSettings(loadedSettings)
        const present = Boolean(keyPresent)
        setHasKey(present)
        onApiKeyChange?.(ready)
        setApiKeyInput('')
      } catch (error) {
        console.error('Failed to load assistant settings', error)
        setStatus({ color: 'red', text: 'Failed to load assistant settings. Try again.' })
      } finally {
        setLoading(false)
      }
    })()
  }, [opened])

  const providerValue = settings.provider

  const handleProviderChange = (value: string | null) => {
    if (!value) return
    const provider = value as AssistantProvider
    const normalized = normalizeAssistantSettings({ ...settings, provider })
    setSettings(normalized)
    setApiKeyInput('')
    setStatus(null)
    void (async () => {
      try {
        const keyPresent = await hasAssistantApiKey(provider)
        setHasKey(Boolean(keyPresent))
        const ready = provider === 'lmstudio' ? true : Boolean(keyPresent)
        onApiKeyChange?.(ready)
      } catch (error) {
        console.error('Failed to check provider API key presence', error)
        setStatus({ color: 'red', text: 'Failed to check provider API key status.' })
      }
    })()
  }

  const handleSave = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const sanitized = normalizeAssistantSettings(settings)
      const saved = await saveAssistantSettings(sanitized)
      if (apiKeyInput.trim()) {
        await setAssistantApiKey(providerValue, apiKeyInput.trim())
        setHasKey(true)
        setApiKeyInput('')
        onApiKeyChange?.(true)
      }
      if (providerValue === 'lmstudio') {
        onApiKeyChange?.(true)
      }
      setSettings(saved)
      setStatus({ color: 'green', text: 'Assistant settings saved.' })
      onSettingsSaved?.(saved)
    } catch (error) {
      console.error('Failed to save assistant settings', error)
      setStatus({ color: 'red', text: 'Failed to save settings. Check logs for details.' })
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveKey = async () => {
    setSaving(true)
    setStatus(null)
    try {
      await deleteAssistantApiKey(providerValue)
      setHasKey(false)
      onApiKeyChange?.(providerValue === 'lmstudio')
      setStatus({
        color: 'yellow',
        text:
          providerValue === 'lmstudio'
            ? 'Custom token removed. LM Studio requests will use the default "lm-studio" token.'
            : 'API key removed. Requests will fall back to mock responses.',
      })
    } catch (error) {
      console.error('Failed to delete API key', error)
      setStatus({ color: 'red', text: 'Failed to delete API key.' })
    } finally {
      setSaving(false)
    }
  }

  const helperText = useMemo(() => {
    if (providerValue === 'lmstudio') {
      return hasKey
        ? 'Using stored LM Studio token from the OS keyring.'
        : 'No token stored. Requests will send the default "lm-studio" bearer token.'
    }
    if (hasKey) return 'API key stored securely via OS keyring.'
    return 'API key not configured. Assistant will fall back to mock responses.'
  }, [hasKey, providerValue])

  return (
    <Modal opened={opened} onClose={onClose} title="Assistant settings" centered size="lg">
      {loading ? (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      ) : (
        <Stack gap="md">
          {status ? (
            <Alert color={status.color} icon={status.color === 'red' ? <IconX size={18} /> : <IconCheck size={18} />}>
              {status.text}
            </Alert>
          ) : null}
          <Select
            label="Provider"
            data={providerOptions}
            value={providerValue}
            onChange={handleProviderChange}
          />
          <TextInput
            label="Model"
            value={settings.model}
            onChange={(event) => {
              const { value } = event.currentTarget
              setSettings((prev) => ({ ...prev, model: value }))
            }}
            description={`Default: ${getDefaultModel(providerValue)}`}
            required
          />
          {providerValue === 'lmstudio' ? (
            <TextInput
              label="LM Studio base URL"
              value={settings.baseUrl}
              onChange={(event) => {
                const { value } = event.currentTarget
                setSettings((prev) => ({ ...prev, baseUrl: value }))
              }}
              description={`Default: ${getDefaultBaseUrl('lmstudio')}`}
              required
            />
          ) : null}
          <Group grow>
            <NumberInput
              label="Temperature"
              value={settings.temperature}
              onChange={(value) => setSettings((prev) => ({ ...prev, temperature: Number(value ?? 0) }))}
              min={0}
              max={2}
              step={0.1}
              clampBehavior="strict"
            />
            <NumberInput
              label="Max tokens"
              value={settings.maxTokens ?? DEFAULT_ASSISTANT_SETTINGS.maxTokens}
              onChange={(value) =>
                setSettings((prev) => ({ ...prev, maxTokens: value === undefined || value === null ? null : Number(value) }))
              }
              min={256}
              max={16000}
              step={256}
            />
          </Group>
          <Stack gap="xs">
            <PasswordInput
              label={providerValue === 'lmstudio' ? 'API token (optional)' : 'OpenAI API key'}
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.currentTarget.value)}
              placeholder={
                hasKey ? '●●●●●●●●' : providerValue === 'lmstudio' ? 'lm-studio' : 'sk-...'
              }
              leftSection={<IconKey size={16} />}
            />
            <Text size="xs" c="dimmed">
              {helperText}
            </Text>
          </Stack>
          <Group justify="space-between">
            <Button
              variant="light"
              color="red"
              leftSection={<IconTrash size={16} />}
              onClick={handleRemoveKey}
              disabled={!hasKey || saving}
            >
              Remove key
            </Button>
            <Group>
              <Button variant="default" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button leftSection={<IconRefresh size={16} />} onClick={handleSave} loading={saving}>
                Save changes
              </Button>
            </Group>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}
