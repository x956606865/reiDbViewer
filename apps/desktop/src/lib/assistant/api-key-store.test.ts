import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { deleteAssistantApiKey, getAssistantApiKey, hasAssistantApiKey, setAssistantApiKey } from './api-key-store'

const store = new Map<string, string>()

vi.mock('@tauri-apps/plugin-sql', () => {
  class MockDatabase {
    static async load(): Promise<MockDatabase> {
      return new MockDatabase()
    }

    async select(query: string, params?: unknown[]): Promise<any[]> {
      if (query.includes('FROM app_prefs')) {
        const key = Array.isArray(params) ? (params[0] as string) : undefined
        if (!key || !store.has(key)) return []
        return [{ v: store.get(key) }]
      }
      throw new Error(`Unexpected select query: ${query}`)
    }

    async execute(query: string, params?: unknown[]): Promise<void> {
      if (query.includes('INSERT INTO app_prefs')) {
        const key = Array.isArray(params) ? (params[0] as string) : undefined
        const value = Array.isArray(params) ? (params[1] as string) : undefined
        if (!key) throw new Error('Missing key parameter')
        store.set(key, value ?? '')
        return
      }
      throw new Error(`Unexpected execute query: ${query}`)
    }
  }

  return {
    default: MockDatabase,
  }
})

vi.mock('@/lib/secret-store', () => {
  let cachedKey: CryptoKey | null = null
  return {
    getOrInitDeviceAesKey: vi.fn(async () => {
      if (!cachedKey) {
        cachedKey = await webcrypto.subtle.generateKey(
          {
            name: 'AES-GCM',
            length: 256,
          },
          true,
          ['encrypt', 'decrypt'],
        )
      }
      return cachedKey
    }),
  }
})

vi.mock('@/lib/sqlite-text', async () => {
  const mod = await import('../sqlite-text')
  return mod
})

vi.mock('@/lib/aes', async () => {
  const mod = await import('../aes')
  return mod
})

describe('assistant api key store (sqlite)', () => {
  const originalWindow = global.window
  const originalCrypto = global.crypto

  beforeAll(() => {
    Object.defineProperty(global, 'crypto', {
      configurable: true,
      value: webcrypto,
    })
  })

  beforeEach(() => {
    store.clear()
    global.window = {
      __TAURI__: {},
    } as unknown as Window & typeof globalThis
  })

  afterAll(() => {
    Object.defineProperty(global, 'crypto', {
      configurable: true,
      value: originalCrypto,
    })
    if (originalWindow) {
      global.window = originalWindow
    } else {
      // @ts-ignore allow cleanup
      delete global.window
    }
  })

  it('stores and retrieves API key for a provider', async () => {
    await setAssistantApiKey('openai', 'sk-test-123')
    expect(await hasAssistantApiKey('openai')).toBe(true)
    await expect(getAssistantApiKey('openai')).resolves.toBe('sk-test-123')
  })

  it('indicates absence when key not stored', async () => {
    expect(await hasAssistantApiKey('lmstudio')).toBe(false)
    await expect(getAssistantApiKey('lmstudio')).rejects.toThrow(/assistant_api_key_missing/)
  })

  it('removes stored key', async () => {
    await setAssistantApiKey('openai', 'sk-test-456')
    await deleteAssistantApiKey('openai')
    expect(await hasAssistantApiKey('openai')).toBe(false)
  })

  it('requires tauri runtime markers', async () => {
    // @ts-ignore intentionally remove marker
    delete global.window.__TAURI__
    await expect(setAssistantApiKey('openai', 'sk')).rejects.toThrow(/Tauri runtime not detected/)
  })
})
