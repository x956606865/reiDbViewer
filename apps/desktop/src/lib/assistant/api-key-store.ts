import { invoke } from '@tauri-apps/api/core'
import type { AssistantProvider } from './provider-settings'

function ensureTauriRuntime() {
  if (typeof window === 'undefined') throw new Error('Tauri runtime not detected. Run via "tauri dev" or packaged build.')
  const marker = (window as any).__TAURI__ || (window as any).__TAURI_IPC__ || (window as any).__TAURI_INTERNALS__
  if (!marker) throw new Error('Tauri runtime not detected. Run via "tauri dev" or packaged build.')
}

function accountOf(provider: AssistantProvider): string {
  return `assistant:${provider}`
}

export async function setAssistantApiKey(provider: AssistantProvider, apiKey: string): Promise<void> {
  ensureTauriRuntime()
  await invoke('set_secret', { account: accountOf(provider), secret: apiKey })
}

export async function getAssistantApiKey(provider: AssistantProvider): Promise<string> {
  ensureTauriRuntime()
  return await invoke<string>('get_secret', { account: accountOf(provider) })
}

export async function deleteAssistantApiKey(provider: AssistantProvider): Promise<void> {
  ensureTauriRuntime()
  await invoke('delete_secret', { account: accountOf(provider) })
}

export async function hasAssistantApiKey(provider: AssistantProvider): Promise<boolean> {
  ensureTauriRuntime()
  return await invoke<boolean>('has_secret', { account: accountOf(provider) })
}

export const __test__ = {
  accountOf,
  ensureTauriRuntime,
}
