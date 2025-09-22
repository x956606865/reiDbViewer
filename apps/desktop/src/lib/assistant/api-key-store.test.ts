import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteAssistantApiKey,
  getAssistantApiKey,
  hasAssistantApiKey,
  setAssistantApiKey,
} from './api-key-store'

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

  it('stores and retrieves API key scoped to profile', async () => {
    await setAssistantApiKey('openai', 'profile_1', 'sk-test-123 ')
    expect(await hasAssistantApiKey('openai', 'profile_1')).toBe(true)
    await expect(getAssistantApiKey('openai', 'profile_1')).resolves.toBe('sk-test-123')
  })

  it('indicates absence when key not stored', async () => {
    expect(await hasAssistantApiKey('lmstudio', 'profile_2')).toBe(false)
    await expect(getAssistantApiKey('lmstudio', 'profile_2')).rejects.toThrow(/assistant_api_key_missing/)
  })

  it('removes stored key', async () => {
    await setAssistantApiKey('custom', 'profile_x', 'ck-123')
    await deleteAssistantApiKey('custom', 'profile_x')
    expect(await hasAssistantApiKey('custom', 'profile_x')).toBe(false)
    await expect(getAssistantApiKey('custom', 'profile_x')).rejects.toThrow(/assistant_api_key_missing/)
  })

  it('treats blank input as delete', async () => {
    await setAssistantApiKey('ollama', 'profile_z', 'token')
    await setAssistantApiKey('ollama', 'profile_z', '   ')
    expect(await hasAssistantApiKey('ollama', 'profile_z')).toBe(false)
  })

  it('falls back to provider key when profile-scoped key missing', async () => {
    await setAssistantApiKey('openai', null, 'legacy-key')
    expect(await hasAssistantApiKey('openai', 'profile_legacy')).toBe(true)
    await expect(getAssistantApiKey('openai', 'profile_legacy')).resolves.toBe('legacy-key')
  })

  it('overwrites legacy provider key when profile key saved', async () => {
    await setAssistantApiKey('openai', null, 'legacy-key')
    await setAssistantApiKey('openai', 'profile_new', 'new-key')
    await expect(getAssistantApiKey('openai', 'profile_new')).resolves.toBe('new-key')
    expect(await hasAssistantApiKey('openai', null)).toBe(false)
  })
})
