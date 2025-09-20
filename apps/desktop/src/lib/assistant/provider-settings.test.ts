import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ASSISTANT_SETTINGS,
  normalizeAssistantSettings,
  resolveAssistantRuntimeSettings,
  type AssistantProviderProfile,
  type AssistantProfileSelection,
} from './provider-settings'
import { __test__ } from './provider-settings'

describe('normalizeAssistantSettings', () => {
  it('fills defaults when fields missing', () => {
    const result = normalizeAssistantSettings({})
    expect(result).toEqual(DEFAULT_ASSISTANT_SETTINGS)
  })

  it('clamps temperature and trims model name', () => {
    const result = normalizeAssistantSettings({
      provider: 'openai',
      model: '  gpt-4o-mini  ',
      temperature: 9,
      maxTokens: 999999,
      baseUrl: 'https://api.openai.com/v1/',
    })
    expect(result.provider).toBe('openai')
    expect(result.model).toBe('gpt-4o-mini')
    expect(result.temperature).toBeLessThanOrEqual(2)
    expect(result.temperature).toBeGreaterThanOrEqual(0)
    expect(result.maxTokens).toBe(999999)
    expect(result.baseUrl).toBe('https://api.openai.com/v1')
  })

  it('falls back to defaults for unsupported provider or blank model', () => {
    const result = normalizeAssistantSettings({
      // @ts-expect-error runtime guard
      provider: 'unknown',
      model: '   ',
      temperature: -2,
    })
    expect(result).toEqual(DEFAULT_ASSISTANT_SETTINGS)
  })

  it('provides LM Studio defaults when selected', () => {
    const result = normalizeAssistantSettings({ provider: 'lmstudio', model: '', baseUrl: '' })
    expect(result.provider).toBe('lmstudio')
    expect(result.model).toBe('lmstudio-community/qwen2.5-7b-instruct')
    expect(result.baseUrl).toBe('http://127.0.0.1:1234/v1')
  })

  it('provides Ollama defaults when selected', () => {
    const result = normalizeAssistantSettings({ provider: 'ollama', model: '', baseUrl: '' })
    expect(result.provider).toBe('ollama')
    expect(result.model).toBe('llama3.1')
    expect(result.baseUrl).toBe('http://127.0.0.1:11434/v1')
  })

  it('falls back to custom defaults for OpenAI-compatible providers', () => {
    const result = normalizeAssistantSettings({ provider: 'custom', model: '  ', baseUrl: 'not a url' })
    expect(result.provider).toBe('custom')
    expect(result.model).toBe('gpt-4o-mini')
    expect(result.baseUrl).toBe('https://api.openai.com/v1')
  })
})

describe('resolveAssistantRuntimeSettings', () => {
  function buildProfiles(): AssistantProviderProfile[] {
    const raw: AssistantProviderProfile[] = [
      {
        id: 'profile_1',
        name: 'OpenAI Default',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        temperature: 0.4,
        maxTokens: 4096,
        models: [
          { id: 'model_a', label: 'GPT-4o mini', value: 'gpt-4o-mini' },
          { id: 'model_b', label: 'GPT-4o', value: 'gpt-4o' },
        ],
        defaultModelId: 'model_b',
        createdAt: 1,
        updatedAt: 2,
      },
      {
        id: 'profile_2',
        name: 'LM Studio',
        provider: 'lmstudio',
        baseUrl: 'http://127.0.0.1:1234/v1',
        temperature: 0.2,
        maxTokens: 2048,
        models: [
          { id: 'model_c', label: 'Qwen 7B', value: 'qwen-7b' },
        ],
        defaultModelId: 'model_c',
        createdAt: 3,
        updatedAt: 4,
      },
    ]
    return __test__.ensureProfilesList(raw)
  }

  it('falls back to default profile and model when selection missing', () => {
    const profiles = buildProfiles()
    const resolution = resolveAssistantRuntimeSettings(profiles, null)
    expect(resolution.selection.profileId).toBe(profiles[0].id)
    expect(resolution.model.value).toBe('gpt-4o')
    expect(resolution.settings.provider).toBe('openai')
  })

  it('returns requested profile/model when available', () => {
    const profiles = buildProfiles()
    const wanted: AssistantProfileSelection = {
      profileId: profiles[1].id,
      modelId: profiles[1].models[0].id,
    }
    const resolution = resolveAssistantRuntimeSettings(profiles, wanted)
    expect(resolution.selection).toEqual(wanted)
    expect(resolution.settings.provider).toBe('lmstudio')
    expect(resolution.settings.model).toBe('qwen-7b')
  })

  it('remaps model selection when requested model not in profile', () => {
    const profiles = buildProfiles()
    const wanted: AssistantProfileSelection = {
      profileId: profiles[0].id,
      modelId: 'does-not-exist',
    }
    const resolution = resolveAssistantRuntimeSettings(profiles, wanted)
    expect(resolution.selection.profileId).toBe(profiles[0].id)
    expect(resolution.selection.modelId).toBe(profiles[0].defaultModelId)
  })
})

describe('sanitizeSelection helper', () => {
  it('selects first profile and its default model when nothing provided', () => {
    const profile = __test__.ensureProfilesList([
      {
        id: 'profile_a',
        name: 'Custom',
        provider: 'custom',
        baseUrl: 'https://example.com/v1',
        temperature: 0.3,
        maxTokens: 1024,
        models: [{ id: 'model_x', label: 'X', value: 'x' }],
        defaultModelId: 'model_x',
        createdAt: 1,
        updatedAt: 1,
      },
    ])[0]
    const selection = __test__.sanitizeSelection(null, [profile])
    expect(selection.profileId).toBe(profile.id)
    expect(selection.modelId).toBe(profile.defaultModelId)
  })
})
