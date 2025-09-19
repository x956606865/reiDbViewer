import { describe, expect, it, vi, beforeEach } from 'vitest'
import { deleteAssistantApiKey, getAssistantApiKey, hasAssistantApiKey, setAssistantApiKey } from './api-key-store'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const invokeMock = vi.mocked((await import('@tauri-apps/api/core')).invoke)

describe('assistant api key store', () => {
  const originalWindow = global.window

  beforeEach(() => {
    invokeMock.mockReset()
    // Provide minimal Tauri runtime markers
    global.window = {
      __TAURI__: {},
    } as unknown as Window & typeof globalThis
  })

  afterEach(() => {
    // @ts-ignore allow clean up for Node test env
    delete global.window
    if (originalWindow) {
      global.window = originalWindow
    }
  })

  it('sets api key using tauri secret storage', async () => {
    await setAssistantApiKey('openai', 'sk-test-123')
    expect(invokeMock).toHaveBeenCalledWith('set_secret', {
      account: 'assistant:openai',
      secret: 'sk-test-123',
    })
  })

  it('gets api key', async () => {
    invokeMock.mockResolvedValue('sk-secret')
    const result = await getAssistantApiKey('openai')
    expect(result).toBe('sk-secret')
    expect(invokeMock).toHaveBeenCalledWith('get_secret', {
      account: 'assistant:openai',
    })
  })

  it('deletes api key', async () => {
    await deleteAssistantApiKey('openai')
    expect(invokeMock).toHaveBeenCalledWith('delete_secret', {
      account: 'assistant:openai',
    })
  })

  it('checks api key existence without returning secret', async () => {
    invokeMock.mockResolvedValueOnce(true)
    const result = await hasAssistantApiKey('openai')
    expect(result).toBe(true)
    expect(invokeMock).toHaveBeenCalledWith('has_secret', {
      account: 'assistant:openai',
    })
  })

  it('throws when runtime not tauri', async () => {
    // Remove runtime markers to trigger guard
    // @ts-ignore intentionally override for test
    delete (global.window as any).__TAURI__
    await expect(setAssistantApiKey('openai', 'sk')).rejects.toThrow(/Tauri runtime/)
  })
})
