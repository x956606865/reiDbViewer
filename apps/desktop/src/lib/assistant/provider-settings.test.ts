import { describe, expect, it } from 'vitest'
import { normalizeAssistantSettings, DEFAULT_ASSISTANT_SETTINGS } from './provider-settings'

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
})
