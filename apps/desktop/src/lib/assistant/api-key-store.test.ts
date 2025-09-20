import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteAssistantApiKey, getAssistantApiKey, hasAssistantApiKey, setAssistantApiKey } from './api-key-store'

const appPrefs = new Map<string, string>()

const selectMock = vi.fn(async (sql: string, params?: unknown[]) => {
  if (/FROM\s+app_prefs/i.test(sql)) {
    const key = Array.isArray(params) ? (params[0] as string) : undefined
    if (!key) return []
    const value = appPrefs.get(key)
    return value !== undefined ? [{ v: value }] : []
  }
  throw new Error(`Unsupported SELECT: ${sql}`)
})

const executeMock = vi.fn(async (sql: string, params?: unknown[]) => {
  if (/INSERT\s+INTO\s+app_prefs/i.test(sql)) {
    const [key, value] = Array.isArray(params) ? params : []
    if (typeof key === 'string' && typeof value === 'string') {
      appPrefs.set(key, value)
      return
    }
  }
  if (/DELETE\s+FROM\s+app_prefs/i.test(sql)) {
    const key = Array.isArray(params) ? (params[0] as string) : undefined
    if (typeof key === 'string') {
      appPrefs.delete(key)
      return
    }
  }
  throw new Error(`Unsupported EXECUTE: ${sql}`)
})

const loadMock = vi.fn(async () => ({ select: selectMock, execute: executeMock }))

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: loadMock,
  },
}))

describe('assistant api key store (encrypted sqlite)', () => {
beforeEach(() => {
  appPrefs.clear()
  selectMock.mockClear()
  executeMock.mockClear()
  loadMock.mockClear()
})

  it('stores and retrieves API key for a provider', async () => {
    await setAssistantApiKey('openai', 'sk-test-123 ')
    expect(await hasAssistantApiKey('openai')).toBe(true)
    await expect(getAssistantApiKey('openai')).resolves.toBe('sk-test-123')
  })

  it('indicates absence when key not stored', async () => {
    expect(await hasAssistantApiKey('lmstudio')).toBe(false)
    await expect(getAssistantApiKey('lmstudio')).rejects.toThrow(/assistant_api_key_missing/)
  })

  it('removes stored key', async () => {
    await setAssistantApiKey('custom', 'ck-123')
    await deleteAssistantApiKey('custom')
    expect(await hasAssistantApiKey('custom')).toBe(false)
    await expect(getAssistantApiKey('custom')).rejects.toThrow(/assistant_api_key_missing/)
  })

  it('treats blank input as delete', async () => {
    await setAssistantApiKey('ollama', 'token')
    await setAssistantApiKey('ollama', '   ')
    expect(await hasAssistantApiKey('ollama')).toBe(false)
  })
})
