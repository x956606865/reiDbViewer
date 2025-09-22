import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { invoke } from '@tauri-apps/api/core'
import { IconBolt, IconCheck, IconKey, IconPlus, IconStar, IconTrash, IconX } from '@tabler/icons-react'
import {
  createAssistantProfile,
  getDefaultBaseUrl,
  getDefaultModel,
  getDefaultReasoningEffort,
  getSupportedProviders,
  resolveAssistantRuntimeSettings,
  supportsReasoningEffort,
  saveAssistantProviderProfiles,
  type AssistantProvider,
  type AssistantReasoningEffort,
  type AssistantProviderProfile,
  type AssistantProviderProfileModel,
  type AssistantProfileSelection,
} from '@/lib/assistant/provider-settings'
import {
  deleteAssistantApiKey,
  getAssistantApiKey,
  hasAssistantApiKey,
  setAssistantApiKey,
} from '@/lib/assistant/api-key-store'

export type AssistantSettingsModalProps = {
  opened: boolean
  profiles: AssistantProviderProfile[]
  selection: AssistantProfileSelection | null
  onClose: () => void
  onProfilesSaved?: (profiles: AssistantProviderProfile[], selection?: AssistantProfileSelection) => void
  onApiKeyChange?: (ready: boolean) => void
}

type StatusMessage = {
  color: 'green' | 'red' | 'yellow'
  text: string
}

type DraftProfile = AssistantProviderProfile

type DraftModel = AssistantProviderProfileModel

const PROVIDER_LABELS: Record<AssistantProvider, string> = {
  openai: 'OpenAI',
  lmstudio: 'LM Studio',
  ollama: 'Ollama',
  custom: '自定义（OpenAI 兼容）',
}

function cloneProfile(profile: AssistantProviderProfile): DraftProfile {
  return {
    ...profile,
    models: profile.models.map((model) => ({ ...model })),
  }
}

function ensureDisplayLabel(model: DraftModel): DraftModel {
  const value = model.value.trim()
  const label = model.label.trim() || value
  return { ...model, value, label }
}

function isReadyWithoutKey(provider: AssistantProvider): boolean {
  return provider === 'lmstudio' || provider === 'ollama'
}

function makeRandomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

function createEmptyModel(provider: AssistantProvider): DraftModel {
  const placeholder = getDefaultModel(provider)
  return {
    id: makeRandomId('model'),
    label: '',
    value: '',
  }
}

export function AssistantSettingsModal({
  opened,
  profiles,
  selection,
  onClose,
  onProfilesSaved,
  onApiKeyChange,
}: AssistantSettingsModalProps) {
  const providerOptions = useMemo(
    () => getSupportedProviders().map((value) => ({ value, label: PROVIDER_LABELS[value] })),
    [],
  )
  const reasoningOptions = useMemo(
    () => [
      { value: 'minimal', label: 'Minimal · 最短推理' },
      { value: 'low', label: 'Low · 快速' },
      { value: 'medium', label: 'Medium · 标准' },
      { value: 'high', label: 'High · 深度' },
    ],
    [],
  )
  const [draftProfiles, setDraftProfiles] = useState<DraftProfile[]>([])
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [status, setStatus] = useState<StatusMessage | null>(null)
  const [saving, setSaving] = useState(false)
  const [checkingKey, setCheckingKey] = useState(false)
  const [quickAddOpened, setQuickAddOpened] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [selectedModelValues, setSelectedModelValues] = useState<string[]>([])
  const [modelsError, setModelsError] = useState<string | null>(null)

  const resetQuickAddState = useCallback(() => {
    setQuickAddOpened(false)
    setModelsLoading(false)
    setModelsError(null)
    setAvailableModels([])
    setSelectedModelValues([])
  }, [])

  const activeProfile = useMemo(() => {
    if (draftProfiles.length === 0) return null
    const found = activeProfileId ? draftProfiles.find((profile) => profile.id === activeProfileId) : null
    return found ?? draftProfiles[0]
  }, [draftProfiles, activeProfileId])

  const refreshApiKey = useCallback(
    async (provider: AssistantProvider) => {
      if (!opened) return
      setCheckingKey(true)
      try {
        const present = await hasAssistantApiKey(provider)
        const optionalProvider = isReadyWithoutKey(provider)
        setHasKey(Boolean(present))
        if (present) {
          try {
            const storedKey = await getAssistantApiKey(provider)
            setApiKeyInput(storedKey)
            onApiKeyChange?.(true)
          } catch (loadError) {
            console.error('Failed to load stored API key', loadError)
            setApiKeyInput('')
            onApiKeyChange?.(optionalProvider ? true : false)
            setStatus({ color: 'red', text: '无法读取已保存的 API Key，请重新填写后保存。' })
          }
        } else {
          setApiKeyInput('')
          onApiKeyChange?.(optionalProvider ? true : false)
          if (optionalProvider) {
            setStatus(null)
          }
        }
      } catch (error) {
        console.error('Failed to check provider API key presence', error)
        setHasKey(false)
        setApiKeyInput('')
        const optionalProvider = isReadyWithoutKey(provider)
        onApiKeyChange?.(optionalProvider ? true : false)
        if (!optionalProvider) {
          setStatus({ color: 'red', text: '无法检测 API Key 状态，请稍后再试。' })
        }
      } finally {
        setCheckingKey(false)
      }
    },
    [opened, onApiKeyChange],
  )

  useEffect(() => {
    if (!opened) return
    const clones = (profiles.length > 0 ? profiles : [createAssistantProfile()]).map(cloneProfile)
    const resolution = resolveAssistantRuntimeSettings(clones, selection ?? null)
    setDraftProfiles(clones)
    setActiveProfileId(resolution.selection.profileId)
    setApiKeyInput('')
    setStatus(null)
    void refreshApiKey(resolution.profile.provider)
  }, [opened, profiles, selection, refreshApiKey])

  useEffect(() => {
    if (!opened || !activeProfile) return
    void refreshApiKey(activeProfile.provider)
  }, [opened, activeProfile?.provider, refreshApiKey])

  useEffect(() => {
    if (!opened) {
      resetQuickAddState()
    }
  }, [opened, resetQuickAddState])

  const handleProfileNameChange = (value: string) => {
    setDraftProfiles((prev) =>
      prev.map((profile) => (profile.id === activeProfile?.id ? { ...profile, name: value } : profile)),
    )
  }

  const handleProviderChange = (value: string | null) => {
    if (!value || !activeProfile) return
    const provider = value as AssistantProvider
    const preset = createAssistantProfile({ provider, name: activeProfile.name })
    setDraftProfiles((prev) =>
      prev.map((profile) =>
        profile.id === activeProfile.id
          ? {
              ...profile,
              provider: preset.provider,
              baseUrl: preset.baseUrl,
              temperature: preset.temperature,
              maxTokens: preset.maxTokens,
              reasoningEffort: preset.reasoningEffort,
              models: preset.models.map((model) => ({ ...model })),
              defaultModelId: preset.defaultModelId,
              updatedAt: Date.now(),
            }
          : profile,
      ),
    )
    setApiKeyInput('')
  }

  const handleBaseUrlChange = (value: string) => {
    if (!activeProfile) return
    setDraftProfiles((prev) =>
      prev.map((profile) => (profile.id === activeProfile.id ? { ...profile, baseUrl: value } : profile)),
    )
  }

  const handleTemperatureChange = (value: number | '' | undefined) => {
    if (!activeProfile) return
    const numeric = typeof value === 'number' ? value : Number(value ?? 0)
    setDraftProfiles((prev) =>
      prev.map((profile) => (profile.id === activeProfile.id ? { ...profile, temperature: numeric } : profile)),
    )
  }

  const handleMaxTokensChange = (value: number | '' | undefined) => {
    if (!activeProfile) return
    const numeric = value === '' || value === undefined || value === null ? null : Number(value)
    setDraftProfiles((prev) =>
      prev.map((profile) => (profile.id === activeProfile.id ? { ...profile, maxTokens: numeric } : profile)),
    )
  }

  const handleReasoningEffortChange = (value: string | null) => {
    if (!activeProfile) return
    const supports = supportsReasoningEffort(activeProfile.provider)
    const fallback = getDefaultReasoningEffort(activeProfile.provider)
    const normalized = supports && value ? (value as AssistantReasoningEffort) : fallback
    setDraftProfiles((prev) =>
      prev.map((profile) =>
        profile.id === activeProfile.id
          ? {
              ...profile,
              reasoningEffort: supports ? normalized ?? fallback : null,
            }
          : profile,
      ),
    )
  }

  const handleModelFieldChange = (modelId: string, field: 'label' | 'value', value: string) => {
    if (!activeProfile) return
    setDraftProfiles((prev) =>
      prev.map((profile) =>
        profile.id === activeProfile.id
          ? {
              ...profile,
              models: profile.models.map((model) => (model.id === modelId ? { ...model, [field]: value } : model)),
            }
          : profile,
      ),
    )
  }

  const handleSetDefaultModel = (modelId: string) => {
    if (!activeProfile) return
    setDraftProfiles((prev) =>
      prev.map((profile) =>
        profile.id === activeProfile.id ? { ...profile, defaultModelId: modelId } : profile,
      ),
    )
  }

  const handleRemoveModel = (modelId: string) => {
    if (!activeProfile) return
    setDraftProfiles((prev) =>
      prev.map((profile) => {
        if (profile.id !== activeProfile.id) return profile
        const remaining = profile.models.filter((model) => model.id !== modelId)
        const nextModels = remaining.length > 0 ? remaining : [createEmptyModel(profile.provider)]
        const defaultModelId =
          nextModels.find((model) => model.id === profile.defaultModelId)?.id ?? nextModels[0].id
        return {
          ...profile,
          models: nextModels,
          defaultModelId,
        }
      }),
    )
  }

  const handleAddModel = () => {
    if (!activeProfile) return
    setDraftProfiles((prev) =>
      prev.map((profile) =>
        profile.id === activeProfile.id
          ? {
              ...profile,
              models: [...profile.models, createEmptyModel(profile.provider)],
            }
          : profile,
      ),
    )
  }

  const handleOpenQuickAdd = async () => {
    if (!activeProfile) return
    setQuickAddOpened(true)
    setModelsLoading(true)
    setModelsError(null)
    setSelectedModelValues([])
    setAvailableModels([])
    const existingValues = new Set(activeProfile.models.map((model) => model.value.trim()))
    const defaultModelValue =
      activeProfile.models.find((model) => model.id === activeProfile.defaultModelId)?.value ??
      activeProfile.models[0]?.value ??
      getDefaultModel(activeProfile.provider)
    const trimmedKey = apiKeyInput.trim()
    const payload = {
      provider: {
        provider: activeProfile.provider,
        model: defaultModelValue,
        temperature: activeProfile.temperature,
        maxTokens: activeProfile.maxTokens ?? null,
        reasoningEffort: supportsReasoningEffort(activeProfile.provider)
          ? activeProfile.reasoningEffort ?? getDefaultReasoningEffort(activeProfile.provider)
          : null,
        baseUrl: activeProfile.baseUrl,
      },
      apiKey: trimmedKey.length > 0 ? trimmedKey : undefined,
    }

    try {
      const response = await invoke<string[]>('assistant_list_models', { payload })
      const filtered = response
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .filter((value) => !existingValues.has(value))
      setAvailableModels(filtered)
      setModelsError(null)
    } catch (error) {
      console.error('Failed to list assistant models', error)
      const message = error instanceof Error ? error.message : String(error)
      setModelsError(message || '获取模型列表失败，请稍后再试。')
      setAvailableModels([])
    } finally {
      setModelsLoading(false)
    }
  }

  const handleCloseQuickAdd = useCallback(() => {
    resetQuickAddState()
  }, [resetQuickAddState])

  const handleConfirmQuickAdd = () => {
    if (!activeProfile) {
      handleCloseQuickAdd()
      return
    }
    const existingValues = new Set(activeProfile.models.map((model) => model.value.trim()))
    const additions = selectedModelValues
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && !existingValues.has(value))
      .map((value) => ({
        id: makeRandomId('model'),
        label: value,
        value,
      }))
    if (additions.length === 0) {
      if (selectedModelValues.length > 0) {
        setStatus({ color: 'yellow', text: '选中的模型已存在于当前配置。' })
      }
      handleCloseQuickAdd()
      return
    }
    setDraftProfiles((prev) =>
      prev.map((profile) =>
        profile.id === activeProfile.id ? { ...profile, models: [...profile.models, ...additions] } : profile,
      ),
    )
    setStatus({ color: 'green', text: `已添加 ${additions.length} 个模型至当前配置。` })
    handleCloseQuickAdd()
  }

  const handleAddProfile = () => {
    const next = createAssistantProfile({ name: `新配置 ${draftProfiles.length + 1}` })
    setDraftProfiles((prev) => [...prev, next])
    setActiveProfileId(next.id)
    setApiKeyInput('')
    setStatus(null)
    void refreshApiKey(next.provider)
  }

  const handleRemoveProfile = () => {
    if (!activeProfile) return
    if (draftProfiles.length <= 1) {
      setStatus({ color: 'yellow', text: '至少需要保留一个配置。' })
      return
    }
    const remaining = draftProfiles.filter((profile) => profile.id !== activeProfile.id)
    setDraftProfiles(remaining)
    const resolution = resolveAssistantRuntimeSettings(remaining, null)
    setActiveProfileId(resolution.selection.profileId)
    setApiKeyInput('')
    setStatus(null)
    void refreshApiKey(resolution.profile.provider)
  }

  const handleApiKeyChange = (value: string) => {
    setApiKeyInput(value)
  }

  const activeModels = activeProfile?.models ?? []
  const defaultModelId = activeProfile?.defaultModelId ?? null

  const helperText = useMemo(() => {
    if (!activeProfile) return ''
    const provider = activeProfile.provider
    if (isReadyWithoutKey(provider)) {
      return provider === 'lmstudio'
        ? '使用本地 LM Studio 服务；如填写 token 会保存在应用数据库。'
        : '使用本地 Ollama 服务；如填写 token 会保存在应用数据库。'
    }
    return hasKey ? 'API Key 已安全存储在应用数据库。' : '未配置 API Key，助手将使用本地模拟响应。'
  }, [activeProfile, hasKey])

  const profileOptions = useMemo(
    () => draftProfiles.map((profile) => ({ value: profile.id, label: profile.name || '未命名配置' })),
    [draftProfiles],
  )

  const validateProfiles = (): DraftProfile[] | null => {
    for (const profile of draftProfiles) {
      const sanitizedName = profile.name.trim() || '未命名配置'
      const sanitizedModels = profile.models
        .map((model) => ensureDisplayLabel(model))
        .filter((model) => model.value.trim().length > 0)
      if (sanitizedModels.length === 0) {
        setStatus({ color: 'red', text: `配置「${sanitizedName}」至少需要一个模型。` })
        return null
      }
      const uniqueValues = new Set<string>()
      for (const model of sanitizedModels) {
        if (uniqueValues.has(model.value)) {
          setStatus({ color: 'red', text: `配置「${sanitizedName}」存在重复的模型标识。` })
          return null
        }
        uniqueValues.add(model.value)
      }
    }
    return draftProfiles.map((profile) => {
      const sanitizedName = profile.name.trim() || '未命名配置'
      const sanitizedModels = profile.models
        .map((model) => ensureDisplayLabel(model))
        .filter((model) => model.value.trim().length > 0)
      const defaultModelExists = sanitizedModels.some((model) => model.id === profile.defaultModelId)
      const fallbackDefault = defaultModelExists ? profile.defaultModelId : sanitizedModels[0].id
      const reasoningEffort = supportsReasoningEffort(profile.provider)
        ? profile.reasoningEffort ?? getDefaultReasoningEffort(profile.provider)
        : null
      return {
        ...profile,
        name: sanitizedName,
        baseUrl: profile.baseUrl.trim() || getDefaultBaseUrl(profile.provider),
        reasoningEffort,
        models: sanitizedModels,
        defaultModelId: fallbackDefault,
        updatedAt: Date.now(),
      }
    })
  }

  const handleSave = async () => {
    if (!activeProfile) return
    const normalizedProfiles = validateProfiles()
    if (!normalizedProfiles) return
    setSaving(true)
    setStatus(null)
    try {
      const saved = await saveAssistantProviderProfiles(normalizedProfiles)
      const preferredSelection: AssistantProfileSelection = {
        profileId: activeProfile.id,
        modelId: defaultModelId ?? activeModels[0].id,
      }
      const resolution = resolveAssistantRuntimeSettings(saved, preferredSelection)
      const trimmedInput = apiKeyInput.trim()
      if (trimmedInput) {
        await setAssistantApiKey(activeProfile.provider, trimmedInput)
        setHasKey(true)
        setApiKeyInput(trimmedInput)
        onApiKeyChange?.(true)
      } else if (isReadyWithoutKey(activeProfile.provider)) {
        onApiKeyChange?.(true)
      }
      onProfilesSaved?.(saved, resolution.selection)
      setStatus({ color: 'green', text: '助手配置已保存。' })
    } catch (error) {
      console.error('Failed to save assistant provider profiles', error)
      setStatus({ color: 'red', text: '保存失败，请检查日志后重试。' })
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveKey = async () => {
    if (!activeProfile) return
    setSaving(true)
    setStatus(null)
    try {
      await deleteAssistantApiKey(activeProfile.provider)
      setHasKey(false)
      setApiKeyInput('')
      onApiKeyChange?.(isReadyWithoutKey(activeProfile.provider))
      setStatus({
        color: 'yellow',
        text:
          activeProfile.provider === 'lmstudio'
            ? '已移除 LM Studio token，后续请求将使用默认凭据。'
            : activeProfile.provider === 'ollama'
              ? '已移除 Ollama token，后续请求将以未授权方式发送。'
            : '已移除 API Key，助手将使用本地模拟响应。',
      })
    } catch (error) {
      console.error('Failed to delete API key', error)
      setStatus({ color: 'red', text: '删除 API Key 失败，请稍后重试。' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal opened={opened} onClose={onClose} title="助手配置" size="xl" centered>
        <Stack gap="md">
          <Group justify="space-between" align="flex-end">
          <Select
            label="选择配置"
            data={profileOptions}
            value={activeProfile?.id ?? null}
            onChange={(value) => setActiveProfileId(value)}
            placeholder="选择或新增配置"
            style={{ flex: 1 }}
          />
          <Group gap="xs">
            <Button leftSection={<IconPlus size={16} />} variant="light" onClick={handleAddProfile}>
              新增配置
            </Button>
            <Button
              leftSection={<IconTrash size={16} />}
              variant="light"
              color="red"
              onClick={handleRemoveProfile}
              disabled={!activeProfile || draftProfiles.length <= 1}
            >
              删除配置
            </Button>
          </Group>
        </Group>
        {status ? (
          <Alert
            color={status.color}
            icon={status.color === 'red' ? <IconX size={18} /> : status.color === 'green' ? <IconCheck size={18} /> : <IconX size={18} />}
          >
            {status.text}
          </Alert>
        ) : null}
        {!activeProfile ? (
          <Text size="sm" c="dimmed">
            暂无配置，请新增一个配置。
          </Text>
        ) : (
          <Stack gap="md">
            <TextInput
              label="配置名称"
              value={activeProfile.name}
              onChange={(event) => handleProfileNameChange(event.currentTarget.value)}
              placeholder="例如：生产环境 OpenAI"
              required
            />
            <Select
              label="服务提供商"
              data={providerOptions}
              value={activeProfile.provider}
              onChange={handleProviderChange}
            />
            <TextInput
              label="模型 API 基础地址"
              value={activeProfile.baseUrl}
              onChange={(event) => handleBaseUrlChange(event.currentTarget.value)}
              description={`默认值：${getDefaultBaseUrl(activeProfile.provider)}`}
            />
            <Group grow>
              <NumberInput
                label="Temperature"
                value={activeProfile.temperature}
                onChange={handleTemperatureChange}
                min={0}
                max={2}
                step={0.1}
                clampBehavior="strict"
              />
              <NumberInput
                label="Max tokens"
                value={activeProfile.maxTokens ?? undefined}
                onChange={handleMaxTokensChange}
                min={256}
                max={16000}
                step={256}
              />
              {supportsReasoningEffort(activeProfile.provider) ? (
                <Select
                  label="Reasoning effort"
                  data={reasoningOptions}
                  value={
                    activeProfile.reasoningEffort ??
                    getDefaultReasoningEffort(activeProfile.provider) ??
                    undefined
                  }
                  onChange={handleReasoningEffortChange}
                />
              ) : null}
            </Group>
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={600}>可用模型</Text>
                <Group gap="xs">
                  <Button
                    leftSection={<IconBolt size={16} />}
                    variant="light"
                    onClick={() => {
                      void handleOpenQuickAdd()
                    }}
                    disabled={modelsLoading}
                  >
                    快速添加模型
                  </Button>
                  <Button leftSection={<IconPlus size={16} />} variant="light" onClick={handleAddModel}>
                    新增模型
                  </Button>
                </Group>
              </Group>
              <Stack gap="sm">
                {activeModels.map((model) => {
                  const isDefault = model.id === defaultModelId
                  return (
                    <Stack key={model.id} gap="xs" style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 8, padding: '12px' }}>
                      <Group justify="space-between" align="center">
                        <Group gap="xs">
                          <Tooltip label={isDefault ? '默认模型' : '设为默认模型'}>
                            <ActionIcon
                              variant={isDefault ? 'filled' : 'light'}
                              color="yellow"
                              onClick={() => handleSetDefaultModel(model.id)}
                            >
                              <IconStar size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Text size="sm" fw={500}>
                            模型
                          </Text>
                        </Group>
                        <ActionIcon
                          variant="light"
                          color="red"
                          onClick={() => handleRemoveModel(model.id)}
                          disabled={activeModels.length <= 1}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                      <Group gap="md" grow>
                        <TextInput
                          label="显示名称"
                          value={model.label}
                          onChange={(event) => handleModelFieldChange(model.id, 'label', event.currentTarget.value)}
                          placeholder="例如：GPT-4o (快)"
                        />
                        <TextInput
                          label="模型 ID"
                          value={model.value}
                          onChange={(event) => handleModelFieldChange(model.id, 'value', event.currentTarget.value)}
                          placeholder={`例如：${getDefaultModel(activeProfile.provider)}`}
                          required
                        />
                      </Group>
                    </Stack>
                  )
                })}
              </Stack>
            </Stack>
            <Stack gap="xs">
              <PasswordInput
                label={isReadyWithoutKey(activeProfile.provider) ? 'API Token（可选）' : 'API Key'}
                value={apiKeyInput}
                onChange={(event) => handleApiKeyChange(event.currentTarget.value)}
                placeholder={hasKey ? '●●●●●●●●' : isReadyWithoutKey(activeProfile.provider) ? '可选 token' : 'sk-...'}
                leftSection={<IconKey size={16} />}
                description={checkingKey ? '正在检测凭证状态…' : helperText}
              />
              <Group justify="space-between">
                <Button
                  variant="light"
                  color="red"
                  leftSection={<IconTrash size={16} />}
                  onClick={handleRemoveKey}
                  disabled={!hasKey || saving}
                >
                  移除凭证
                </Button>
                <Group>
                  <Button variant="default" onClick={onClose} disabled={saving}>
                    取消
                  </Button>
                  <Button onClick={handleSave} loading={saving}>
                    保存配置
                  </Button>
                </Group>
              </Group>
            </Stack>
          </Stack>
        )}
      </Stack>
    </Modal>
    <Modal opened={quickAddOpened} onClose={handleCloseQuickAdd} title="快速添加模型" size="lg">
      <Stack gap="sm">
        {modelsLoading ? (
          <Text size="sm" c="dimmed">
            正在获取模型列表…
          </Text>
        ) : modelsError ? (
          <Alert color="red" icon={<IconX size={18} />}>
            {modelsError}
          </Alert>
        ) : availableModels.length === 0 ? (
          <Text size="sm" c="dimmed">
            未获取到新的模型，当前配置可能已包含全部可用模型。
          </Text>
        ) : (
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              已过滤掉当前配置中已存在的模型，可多选后添加。
            </Text>
            <Checkbox.Group value={selectedModelValues} onChange={setSelectedModelValues}>
              <ScrollArea h={240} offsetScrollbars scrollbarSize={6}>
                <Stack gap="xs">
                  {availableModels.map((model) => (
                    <Checkbox key={model} value={model} label={model} />
                  ))}
                </Stack>
              </ScrollArea>
            </Checkbox.Group>
          </Stack>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={handleCloseQuickAdd}>
            取消
          </Button>
          <Button onClick={handleConfirmQuickAdd} disabled={modelsLoading || selectedModelValues.length === 0}>
            添加所选模型
          </Button>
        </Group>
      </Stack>
    </Modal>
  </>
  )
}
