import Database from '@tauri-apps/plugin-sql'
import { parseJsonColumn } from '@/lib/sqlite-text'

export type AssistantProvider = 'openai' | 'lmstudio' | 'ollama' | 'custom'

export type AssistantReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

const REASONING_EFFORT_PROVIDERS: ReadonlyArray<AssistantProvider> = ['openai', 'custom', 'lmstudio', 'ollama']
const ALLOWED_REASONING_EFFORTS: ReadonlyArray<AssistantReasoningEffort> = ['minimal', 'low', 'medium', 'high']

const DEFAULT_REASONING_EFFORTS: Record<AssistantProvider, AssistantReasoningEffort | null> = {
  openai: 'medium',
  lmstudio: 'medium',
  ollama: 'medium',
  custom: 'medium',
}

export type AssistantProviderSettings = {
  provider: AssistantProvider
  model: string
  temperature: number
  maxTokens: number | null
  reasoningEffort: AssistantReasoningEffort | null
  baseUrl: string
}

export type AssistantProviderProfileModel = {
  id: string
  label: string
  value: string
}

export type AssistantProviderProfile = {
  id: string
  name: string
  provider: AssistantProvider
  baseUrl: string
  temperature: number
  maxTokens: number | null
  reasoningEffort: AssistantReasoningEffort | null
  models: AssistantProviderProfileModel[]
  defaultModelId: string
  createdAt: number
  updatedAt: number
}

export type AssistantProfileSelection = {
  profileId: string
  modelId: string
}

export type AssistantRuntimeResolution = {
  profile: AssistantProviderProfile
  model: AssistantProviderProfileModel
  selection: AssistantProfileSelection
  settings: AssistantProviderSettings
}

const SUPPORTED_PROVIDERS: AssistantProvider[] = ['openai', 'lmstudio', 'ollama', 'custom']

const DEFAULT_MODELS: Record<AssistantProvider, string> = {
  openai: 'gpt-4o-mini',
  lmstudio: 'lmstudio-community/qwen2.5-7b-instruct',
  ollama: 'llama3.1',
  custom: 'gpt-4o-mini',
}

const DEFAULT_BASE_URLS: Record<AssistantProvider, string> = {
  openai: 'https://api.openai.com/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
  ollama: 'http://127.0.0.1:11434/v1',
  custom: 'https://api.openai.com/v1',
}

const DEFAULT_TEMPERATURE = 0.2
const DEFAULT_MAX_TOKENS = 4096

const PROFILES_STORAGE_KEY = 'assistant.providerProfiles.v1'
const SELECTION_STORAGE_KEY = 'assistant.profileSelection.v1'
const LEGACY_STORAGE_KEY = 'assistant.settings.v1'

const PROFILE_VERSION = 1
const SELECTION_VERSION = 1

export const DEFAULT_ASSISTANT_SETTINGS: AssistantProviderSettings = {
  provider: 'openai',
  model: DEFAULT_MODELS.openai,
  temperature: DEFAULT_TEMPERATURE,
  maxTokens: DEFAULT_MAX_TOKENS,
  reasoningEffort: DEFAULT_REASONING_EFFORTS.openai,
  baseUrl: DEFAULT_BASE_URLS.openai,
}

type ProfilesPayload = {
  version: typeof PROFILE_VERSION
  profiles: AssistantProviderProfile[]
}

type SelectionPayload = {
  version: typeof SELECTION_VERSION
  selection: AssistantProfileSelection
}

function now(): number {
  return Date.now()
}

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
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
    return parsed.toString().replace(/\/$/, '')
  } catch (err) {
    console.warn('Invalid assistant baseUrl, falling back to default', err)
    return DEFAULT_BASE_URLS[provider]
  }
}

export function supportsReasoningEffort(provider: AssistantProvider): boolean {
  return REASONING_EFFORT_PROVIDERS.includes(provider)
}

export function getDefaultReasoningEffort(provider: AssistantProvider): AssistantReasoningEffort | null {
  return DEFAULT_REASONING_EFFORTS[provider]
}

function normalizeReasoningEffort(
  value: AssistantReasoningEffort | string | null | undefined,
  provider: AssistantProvider,
): AssistantReasoningEffort | null {
  if (!supportsReasoningEffort(provider)) return null
  if (typeof value !== 'string') return DEFAULT_REASONING_EFFORTS[provider]
  const normalized = value.trim().toLowerCase() as AssistantReasoningEffort
  return ALLOWED_REASONING_EFFORTS.includes(normalized)
    ? normalized
    : DEFAULT_REASONING_EFFORTS[provider]
}

function isSupportedProvider(provider: string | null | undefined): provider is AssistantProvider {
  return !!provider && SUPPORTED_PROVIDERS.includes(provider as AssistantProvider)
}

export function getSupportedProviders(): AssistantProvider[] {
  return [...SUPPORTED_PROVIDERS]
}

export function getDefaultModel(provider: AssistantProvider): string {
  return DEFAULT_MODELS[provider]
}

export function getDefaultBaseUrl(provider: AssistantProvider): string {
  return DEFAULT_BASE_URLS[provider]
}

export function normalizeAssistantSettings(
  input: Partial<AssistantProviderSettings> | null | undefined,
): AssistantProviderSettings {
  if (!input || !isSupportedProvider((input as AssistantProviderSettings).provider)) {
    return { ...DEFAULT_ASSISTANT_SETTINGS }
  }
  const provider = (input as AssistantProviderSettings).provider
  const model = sanitizeModelName(input.model, provider)
  if (!model) return { ...DEFAULT_ASSISTANT_SETTINGS }
  const temperature = clampTemperature(input.temperature)
  const maxTokens =
    input.maxTokens === null || input.maxTokens === undefined || Number.isNaN(Number(input.maxTokens))
      ? DEFAULT_MAX_TOKENS
      : Number(input.maxTokens)
  const baseUrl = sanitizeBaseUrl((input as AssistantProviderSettings).baseUrl, provider)
  const reasoningEffort = normalizeReasoningEffort(
    (input as AssistantProviderSettings).reasoningEffort,
    provider,
  )
  return {
    provider,
    model,
    temperature,
    maxTokens,
    reasoningEffort,
    baseUrl,
  }
}

function normalizeModelEntry(
  input: AssistantProviderProfileModel | string | null | undefined,
  provider: AssistantProvider,
): AssistantProviderProfileModel | null {
  if (!input) return null
  if (typeof input === 'string') {
    const value = sanitizeModelName(input, provider)
    if (!value) return null
    return {
      id: generateId('model'),
      label: value,
      value,
    }
  }
  const value = sanitizeModelName(input.value, provider)
  if (!value) return null
  const label = (input.label ?? '').trim() || value
  const id = (input.id ?? '').trim() || generateId('model')
  return {
    id,
    label,
    value,
  }
}

function normalizeProfile(raw: any, fallbackName: string): AssistantProviderProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const provider = isSupportedProvider(raw.provider) ? raw.provider : DEFAULT_ASSISTANT_SETTINGS.provider
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : fallbackName
  const temperature = clampTemperature(raw.temperature)
  const maxTokens =
    raw.maxTokens === null || raw.maxTokens === undefined || Number.isNaN(Number(raw.maxTokens))
      ? DEFAULT_MAX_TOKENS
      : Number(raw.maxTokens)
  const baseUrl = sanitizeBaseUrl(raw.baseUrl, provider)
  const reasoningEffort = normalizeReasoningEffort(raw.reasoningEffort, provider)
  const createdAt = Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : now()
  const updatedAt = Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : createdAt
  const modelsInput: Array<AssistantProviderProfileModel | string> = Array.isArray(raw.models)
    ? raw.models
    : [raw.model ?? DEFAULT_MODELS[provider]]
  const normalizedModels: AssistantProviderProfileModel[] = []
  for (const entry of modelsInput) {
    const normalized = normalizeModelEntry(entry, provider)
    if (normalized && !normalizedModels.some((existing) => existing.value === normalized.value)) {
      normalizedModels.push(normalized)
    }
  }
  if (normalizedModels.length === 0) {
    normalizedModels.push(
      normalizeModelEntry(DEFAULT_MODELS[provider], provider) ?? {
        id: generateId('model'),
        label: DEFAULT_MODELS[provider],
        value: DEFAULT_MODELS[provider],
      },
    )
  }
  const defaultModelId = (() => {
    const requested = typeof raw.defaultModelId === 'string' ? raw.defaultModelId : null
    if (requested && normalizedModels.some((model) => model.id === requested)) return requested
    if (typeof raw.model === 'string') {
      const existing = normalizedModels.find((model) => model.value === sanitizeModelName(raw.model, provider))
      if (existing) return existing.id
    }
    return normalizedModels[0]!.id
  })()
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : generateId('profile')
  return {
    id,
    name,
    provider,
    baseUrl,
    temperature,
    maxTokens,
    reasoningEffort,
    models: normalizedModels,
    defaultModelId,
    createdAt,
    updatedAt,
  }
}

function createDefaultProfile(): AssistantProviderProfile {
  const model = normalizeModelEntry(DEFAULT_ASSISTANT_SETTINGS.model, DEFAULT_ASSISTANT_SETTINGS.provider)!
  const timestamp = now()
  return {
    id: generateId('profile'),
    name: '默认配置',
    provider: DEFAULT_ASSISTANT_SETTINGS.provider,
    baseUrl: DEFAULT_ASSISTANT_SETTINGS.baseUrl,
    temperature: DEFAULT_ASSISTANT_SETTINGS.temperature,
    maxTokens: DEFAULT_ASSISTANT_SETTINGS.maxTokens,
    reasoningEffort: DEFAULT_ASSISTANT_SETTINGS.reasoningEffort,
    models: [model],
    defaultModelId: model.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createAssistantProfile(
  preset?: Partial<
    Pick<AssistantProviderProfile, 'name' | 'provider' | 'baseUrl' | 'temperature' | 'maxTokens' | 'reasoningEffort'>
  > & {
    modelValue?: string
  },
): AssistantProviderProfile {
  const provider = preset?.provider && isSupportedProvider(preset.provider) ? preset.provider : DEFAULT_ASSISTANT_SETTINGS.provider
  const baseUrl = sanitizeBaseUrl(preset?.baseUrl, provider)
  const modelValue = sanitizeModelName(preset?.modelValue ?? DEFAULT_MODELS[provider], provider)
  const reasoningEffort = normalizeReasoningEffort(preset?.reasoningEffort, provider)
  const model =
    normalizeModelEntry(
      {
        id: generateId('model'),
        label: modelValue,
        value: modelValue,
      },
      provider,
    ) ?? normalizeModelEntry(DEFAULT_MODELS[provider], provider)!
  const timestamp = now()
  return {
    id: generateId('profile'),
    name: preset?.name?.trim() || '新配置',
    provider,
    baseUrl,
    temperature: clampTemperature(preset?.temperature),
    maxTokens:
      preset?.maxTokens === null || preset?.maxTokens === undefined || Number.isNaN(Number(preset?.maxTokens))
        ? DEFAULT_MAX_TOKENS
        : Number(preset?.maxTokens),
    reasoningEffort,
    models: [model],
    defaultModelId: model.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

async function openLocalDatabase() {
  return await Database.load('sqlite:rdv_local.db')
}

async function loadProfilesPayload(): Promise<ProfilesPayload | null> {
  try {
    const db = await openLocalDatabase()
    // @ts-ignore select is provided at runtime
    const rows = await db.select<any[]>(`SELECT v FROM app_prefs WHERE k = $1`, [PROFILES_STORAGE_KEY])
    const raw = Array.isArray(rows) ? rows[0]?.v : undefined
    const parsed = parseJsonColumn<ProfilesPayload | null>(raw, null)
    if (!parsed || parsed.version !== PROFILE_VERSION || !Array.isArray(parsed.profiles)) return null
    return parsed
  } catch (error) {
    console.warn('Failed to load assistant provider profiles payload', error)
    return null
  }
}

async function loadLegacyProfile(): Promise<AssistantProviderProfile | null> {
  try {
    const db = await openLocalDatabase()
    // @ts-ignore select is provided at runtime
    const rows = await db.select<any[]>(`SELECT v FROM app_prefs WHERE k = $1`, [LEGACY_STORAGE_KEY])
    const raw = Array.isArray(rows) ? rows[0]?.v : undefined
    const parsed = parseJsonColumn<{ version: 1; settings: AssistantProviderSettings } | null>(raw, null)
    if (!parsed || parsed.version !== 1) return null
    const normalized = normalizeAssistantSettings(parsed.settings)
    const model = normalizeModelEntry(normalized.model, normalized.provider)!
    const timestamp = now()
    return {
      id: generateId('profile'),
      name: '默认配置',
      provider: normalized.provider,
      baseUrl: normalized.baseUrl,
      temperature: normalized.temperature,
      maxTokens: normalized.maxTokens,
      reasoningEffort: normalized.reasoningEffort,
      models: [model],
      defaultModelId: model.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  } catch (error) {
    console.warn('Failed to load legacy assistant settings', error)
    return null
  }
}

function ensureProfilesList(list: AssistantProviderProfile[] | null | undefined): AssistantProviderProfile[] {
  const fallback = createDefaultProfile()
  if (!list || list.length === 0) return [fallback]
  const seen = new Set<string>()
  const sanitized: AssistantProviderProfile[] = []
  for (const [index, raw] of list.entries()) {
    const normalized = normalizeProfile(raw, `配置 ${index + 1}`)
    if (!normalized) continue
    if (seen.has(normalized.id)) {
      normalized.id = generateId('profile')
    }
    seen.add(normalized.id)
    sanitized.push(normalized)
  }
  if (sanitized.length === 0) sanitized.push(fallback)
  return sanitized
}

function sanitizeSelection(
  selection: Partial<AssistantProfileSelection> | null | undefined,
  profiles: AssistantProviderProfile[],
): AssistantProfileSelection {
  const primary = profiles[0]
  if (!primary) {
    const fallbackProfile = createDefaultProfile()
    return {
      profileId: fallbackProfile.id,
      modelId: fallbackProfile.defaultModelId,
    }
  }
  const requestedProfile = selection?.profileId
    ? profiles.find((profile) => profile.id === selection.profileId)
    : null
  const profile = requestedProfile ?? primary
  const requestedModel = selection?.modelId
    ? profile.models.find((model) => model.id === selection.modelId)
    : null
  const model = requestedModel ?? profile.models.find((item) => item.id === profile.defaultModelId) ?? profile.models[0]
  return {
    profileId: profile.id,
    modelId: model?.id ?? profile.models[0].id,
  }
}

export async function loadAssistantProviderProfiles(): Promise<AssistantProviderProfile[]> {
  const payload = await loadProfilesPayload()
  if (payload) {
    return ensureProfilesList(payload.profiles)
  }
  const legacyProfile = await loadLegacyProfile()
  if (legacyProfile) {
    const profiles = ensureProfilesList([legacyProfile])
    await saveAssistantProviderProfiles(profiles)
    return profiles
  }
  const profiles = ensureProfilesList(null)
  await saveAssistantProviderProfiles(profiles)
  return profiles
}

export async function saveAssistantProviderProfiles(
  inputProfiles: AssistantProviderProfile[],
): Promise<AssistantProviderProfile[]> {
  const profiles = ensureProfilesList(inputProfiles)
  const payload: ProfilesPayload = {
    version: PROFILE_VERSION,
    profiles,
  }
  const db = await openLocalDatabase()
  // @ts-ignore execute exists at runtime
  await db.execute(
    `INSERT INTO app_prefs (k, v) VALUES ($1, $2)
     ON CONFLICT(k) DO UPDATE SET v = EXCLUDED.v`,
    [PROFILES_STORAGE_KEY, JSON.stringify(payload)],
  )
  return profiles
}

async function loadSelectionPayload(): Promise<SelectionPayload | null> {
  try {
    const db = await openLocalDatabase()
    // @ts-ignore select is provided at runtime
    const rows = await db.select<any[]>(`SELECT v FROM app_prefs WHERE k = $1`, [SELECTION_STORAGE_KEY])
    const raw = Array.isArray(rows) ? rows[0]?.v : undefined
    const parsed = parseJsonColumn<SelectionPayload | null>(raw, null)
    if (!parsed || parsed.version !== SELECTION_VERSION || !parsed.selection) return null
    return parsed
  } catch (error) {
    console.warn('Failed to load assistant profile selection', error)
    return null
  }
}

export async function loadAssistantProfileSelection(
  profiles: AssistantProviderProfile[],
): Promise<AssistantProfileSelection> {
  const payload = await loadSelectionPayload()
  if (!payload) return sanitizeSelection(null, profiles)
  return sanitizeSelection(payload.selection, profiles)
}

export async function saveAssistantProfileSelection(
  selection: AssistantProfileSelection,
): Promise<AssistantProfileSelection> {
  const payload: SelectionPayload = {
    version: SELECTION_VERSION,
    selection,
  }
  const db = await openLocalDatabase()
  // @ts-ignore execute exists at runtime
  await db.execute(
    `INSERT INTO app_prefs (k, v) VALUES ($1, $2)
     ON CONFLICT(k) DO UPDATE SET v = EXCLUDED.v`,
    [SELECTION_STORAGE_KEY, JSON.stringify(payload)],
  )
  return selection
}

export function resolveAssistantRuntimeSettings(
  profiles: AssistantProviderProfile[],
  selection: AssistantProfileSelection | null | undefined,
): AssistantRuntimeResolution {
  const sanitizedProfiles = ensureProfilesList(profiles)
  const sanitizedSelection = sanitizeSelection(selection, sanitizedProfiles)
  const profile =
    sanitizedProfiles.find((candidate) => candidate.id === sanitizedSelection.profileId) ?? sanitizedProfiles[0]
  const model =
    profile.models.find((candidate) => candidate.id === sanitizedSelection.modelId) ??
    profile.models.find((candidate) => candidate.id === profile.defaultModelId) ??
    profile.models[0]
  const settings: AssistantProviderSettings = {
    provider: profile.provider,
    model: model.value,
    baseUrl: profile.baseUrl,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    reasoningEffort: profile.reasoningEffort,
  }
  return {
    profile,
    model,
    selection: {
      profileId: profile.id,
      modelId: model.id,
    },
    settings,
  }
}

export const __test__ = {
  clampTemperature,
  sanitizeModelName,
  sanitizeBaseUrl,
  isSupportedProvider,
  normalizeModelEntry,
  normalizeProfile,
  sanitizeSelection,
  ensureProfilesList,
  generateId,
}
