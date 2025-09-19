import Database from '@tauri-apps/plugin-sql'
import type { AssistantProvider } from './provider-settings'
import { getOrInitDeviceAesKey } from '@/lib/secret-store'
import { aesDecryptToString, aesEncryptString, type AesCipher } from '@/lib/aes'
import { parseJsonColumn } from '@/lib/sqlite-text'

const STORAGE_KEY = 'assistant.apiKeys.v1'

type StoredPayload = {
  version: 1
  entries: Partial<Record<AssistantProvider, AesCipher>>
}

const DEFAULT_PAYLOAD: StoredPayload = {
  version: 1,
  entries: {},
}

function ensureTauriRuntime() {
  if (typeof window === 'undefined') throw new Error('Tauri runtime not detected. Run via "tauri dev" or packaged build.')
  const marker = (window as any).__TAURI__ || (window as any).__TAURI_IPC__ || (window as any).__TAURI_INTERNALS__
  if (!marker) throw new Error('Tauri runtime not detected. Run via "tauri dev" or packaged build.')
}

async function openLocalDatabase() {
  return await Database.load('sqlite:rdv_local.db')
}

async function loadPayload(): Promise<StoredPayload> {
  const db = await openLocalDatabase()
  // @ts-ignore select is provided by the plugin at runtime
  const rows = await db.select<any[]>(`SELECT v FROM app_prefs WHERE k = $1`, [STORAGE_KEY])
  const raw = Array.isArray(rows) ? rows[0]?.v : undefined
  const parsed = parseJsonColumn<StoredPayload | null>(raw, null)
  if (!parsed || parsed.version !== 1 || typeof parsed.entries !== 'object' || parsed.entries === null) {
    return { ...DEFAULT_PAYLOAD }
  }
  return {
    version: 1,
    entries: { ...parsed.entries },
  }
}

async function savePayload(payload: StoredPayload): Promise<void> {
  const db = await openLocalDatabase()
  // @ts-ignore execute is provided by the plugin at runtime
  await db.execute(
    `INSERT INTO app_prefs (k, v) VALUES ($1, $2)
     ON CONFLICT(k) DO UPDATE SET v = EXCLUDED.v`,
    [STORAGE_KEY, JSON.stringify(payload)],
  )
}

export async function setAssistantApiKey(provider: AssistantProvider, apiKey: string): Promise<void> {
  ensureTauriRuntime()
  const key = await getOrInitDeviceAesKey()
  const cipher = await aesEncryptString(key, apiKey)
  const payload = await loadPayload()
  payload.entries = { ...payload.entries, [provider]: cipher }
  await savePayload(payload)
}

export async function getAssistantApiKey(provider: AssistantProvider): Promise<string> {
  ensureTauriRuntime()
  const payload = await loadPayload()
  const cipher = payload.entries?.[provider]
  if (!cipher) throw new Error('assistant_api_key_missing')
  const key = await getOrInitDeviceAesKey()
  return await aesDecryptToString(key, cipher)
}

export async function deleteAssistantApiKey(provider: AssistantProvider): Promise<void> {
  ensureTauriRuntime()
  const payload = await loadPayload()
  if (!payload.entries?.[provider]) return
  const { [provider]: _removed, ...rest } = payload.entries
  payload.entries = rest as StoredPayload['entries']
  await savePayload(payload)
}

export async function hasAssistantApiKey(provider: AssistantProvider): Promise<boolean> {
  ensureTauriRuntime()
  const payload = await loadPayload()
  return Boolean(payload.entries?.[provider])
}

export const __test__ = {
  ensureTauriRuntime,
  STORAGE_KEY,
}
