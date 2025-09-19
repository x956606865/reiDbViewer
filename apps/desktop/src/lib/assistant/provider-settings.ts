import Database from '@tauri-apps/plugin-sql'

export type AssistantProvider = 'openai' | 'lmstudio'

export type AssistantProviderSettings = {
  provider: AssistantProvider
  model: string
  temperature: number
  maxTokens: number | null
  baseUrl: string
}

const STORAGE_KEY = 'assistant.settings.v1'
const SUPPORTED_PROVIDERS: AssistantProvider[] = ['openai', 'lmstudio']

const DEFAULT_MODELS: Record<AssistantProvider, string> = {
  openai: 'gpt-4o-mini',
  lmstudio: 'lmstudio-community/qwen2.5-7b-instruct',
}

const DEFAULT_BASE_URLS: Record<AssistantProvider, string> = {
  openai: 'https://api.openai.com/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
}

const DEFAULT_TEMPERATURE = 0.2
const DEFAULT_MAX_TOKENS = 4096

export const DEFAULT_ASSISTANT_SETTINGS: AssistantProviderSettings = {
  provider: 'openai',
  model: DEFAULT_MODELS.openai,
  temperature: DEFAULT_TEMPERATURE,
  maxTokens: DEFAULT_MAX_TOKENS,
  baseUrl: DEFAULT_BASE_URLS.openai,
}

export function getDefaultModel(provider: AssistantProvider): string {
  return DEFAULT_MODELS[provider]
}

export function getDefaultBaseUrl(provider: AssistantProvider): string {
  return DEFAULT_BASE_URLS[provider]
}

type StoredPayload = {
  version: 1
  settings: AssistantProviderSettings
}

function clampTemperature(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_TEMPERATURE
  return Math.min(2, Math.max(0, Number(value)))
}

function sanitizeModelName(model: string | null | undefined, provider: AssistantProvider): string {
  const trimmed = (model ?? '').trim()
  if (!trimmed) return DEFAULT_MODELS[provider]
  return trimmed
}

function sanitizeBaseUrl(baseUrl: string | null | undefined, provider: AssistantProvider): string {
  const trimmed = (baseUrl ?? '').trim()
  if (!trimmed) return DEFAULT_BASE_URLS[provider]
  try {
    const parsed = new URL(trimmed)
    const normalized = parsed.toString().replace(/\/$/, '')
    return normalized
  } catch (err) {
    console.warn('Invalid assistant baseUrl, falling back to default', err)
    return DEFAULT_BASE_URLS[provider]
  }
}

function isSupportedProvider(provider: string | null | undefined): provider is AssistantProvider {
  return !!provider && SUPPORTED_PROVIDERS.includes(provider as AssistantProvider)
}

export function normalizeAssistantSettings(
  input: Partial<AssistantProviderSettings> | null | undefined,
): AssistantProviderSettings {
  if (!input) return DEFAULT_ASSISTANT_SETTINGS
  if (!isSupportedProvider(input.provider)) return DEFAULT_ASSISTANT_SETTINGS
  const provider = input.provider
  const model = sanitizeModelName(input.model, provider)
  if (!model) return DEFAULT_ASSISTANT_SETTINGS
  const temperature = clampTemperature(input.temperature)
  const maxTokens =
    input.maxTokens === null || input.maxTokens === undefined || Number.isNaN(Number(input.maxTokens))
      ? DEFAULT_MAX_TOKENS
      : Number(input.maxTokens)
  const baseUrl = sanitizeBaseUrl((input as AssistantProviderSettings).baseUrl, provider)
  return {
    provider,
    model,
    temperature,
    maxTokens,
    baseUrl,
  }
}

async function openLocalDatabase() {
  return await Database.load('sqlite:rdv_local.db')
}

export async function loadAssistantSettings(): Promise<AssistantProviderSettings> {
  try {
    const db = await openLocalDatabase()
    // @ts-ignore select is available at runtime
    const rows = await db.select<any[]>(`SELECT v FROM app_prefs WHERE k = $1`, [STORAGE_KEY])
    const raw = Array.isArray(rows) ? rows[0]?.v : undefined
    if (!raw) return DEFAULT_ASSISTANT_SETTINGS
    const parsed = JSON.parse(String(raw)) as StoredPayload | null
    if (!parsed || parsed.version !== 1 || !parsed.settings) return DEFAULT_ASSISTANT_SETTINGS
    return normalizeAssistantSettings(parsed.settings)
  } catch (err) {
    console.warn('failed to load assistant settings', err)
    return DEFAULT_ASSISTANT_SETTINGS
  }
}

export async function saveAssistantSettings(
  patch: Partial<AssistantProviderSettings>,
): Promise<AssistantProviderSettings> {
  const normalized = normalizeAssistantSettings({ ...DEFAULT_ASSISTANT_SETTINGS, ...patch })
  const payload: StoredPayload = {
    version: 1,
    settings: normalized,
  }
  const db = await openLocalDatabase()
  // @ts-ignore execute is available at runtime
  await db.execute(
    `INSERT INTO app_prefs (k, v) VALUES ($1, $2)
     ON CONFLICT(k) DO UPDATE SET v = EXCLUDED.v`,
    [STORAGE_KEY, JSON.stringify(payload)],
  )
  return normalized
}

export function getSupportedProviders(): AssistantProvider[] {
  return [...SUPPORTED_PROVIDERS]
}

export const __test__ = {
  clampTemperature,
  sanitizeModelName,
  isSupportedProvider,
}
