import type { AssistantProvider } from './provider-settings'
import { deleteEncryptedPref, getEncryptedPref, setEncryptedPref } from '@/lib/secret-store'

const profilePrefKey = (profileId: string) => `assistant.apiKey.profile.${profileId}`
const providerPrefKey = (provider: AssistantProvider) => `assistant.apiKey.${provider}`

function normalizeProfileId(profileId: string | null | undefined): string | null {
  const trimmed = profileId?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

async function setPref(key: string, value: string) {
  await setEncryptedPref(key, value)
}

async function deletePref(key: string) {
  await deleteEncryptedPref(key)
}

async function readPref(key: string): Promise<string | null> {
  const value = await getEncryptedPref(key)
  return value && value.trim().length > 0 ? value : null
}

async function getProfileScopedKey(provider: AssistantProvider, profileId: string | null): Promise<string | null> {
  const normalized = normalizeProfileId(profileId)
  if (!normalized) return null
  const value = await readPref(profilePrefKey(normalized))
  if (value) return value
  return null
}

async function getProviderFallbackKey(provider: AssistantProvider): Promise<string | null> {
  return await readPref(providerPrefKey(provider))
}

export async function setAssistantApiKey(
  provider: AssistantProvider,
  profileId: string | null | undefined,
  apiKey: string,
): Promise<void> {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    await deleteAssistantApiKey(provider, profileId)
    return
  }
  const normalizedProfile = normalizeProfileId(profileId)
  if (normalizedProfile) {
    await setPref(profilePrefKey(normalizedProfile), trimmed)
    await deletePref(providerPrefKey(provider))
  } else {
    await setPref(providerPrefKey(provider), trimmed)
  }
}

export async function getAssistantApiKey(
  provider: AssistantProvider,
  profileId: string | null | undefined,
): Promise<string> {
  const normalizedProfile = normalizeProfileId(profileId)
  let fallback: string | null = null
  if (normalizedProfile) {
    const scoped = await getProfileScopedKey(provider, normalizedProfile)
    if (scoped) return scoped
    fallback = await getProviderFallbackKey(provider)
    if (fallback) {
      await setPref(profilePrefKey(normalizedProfile), fallback)
      await deletePref(providerPrefKey(provider))
      return fallback
    }
  }
  if (fallback === null) {
    fallback = await getProviderFallbackKey(provider)
  }
  if (fallback) return fallback
  throw new Error('assistant_api_key_missing')
}

export async function deleteAssistantApiKey(
  provider: AssistantProvider,
  profileId: string | null | undefined,
): Promise<void> {
  const normalizedProfile = normalizeProfileId(profileId)
  if (normalizedProfile) {
    await deletePref(profilePrefKey(normalizedProfile))
  }
  await deletePref(providerPrefKey(provider))
}

export async function hasAssistantApiKey(
  provider: AssistantProvider,
  profileId: string | null | undefined,
): Promise<boolean> {
  try {
    const normalizedProfile = normalizeProfileId(profileId)
    if (normalizedProfile) {
      const scoped = await getProfileScopedKey(provider, normalizedProfile)
      if (scoped) return true
    }
    const fallback = await getProviderFallbackKey(provider)
    return Boolean(fallback)
  } catch (error) {
    console.error('Failed to inspect assistant API key state', error)
    return false
  }
}

export const __test__ = {
  profilePrefKey,
  providerPrefKey,
  normalizeProfileId,
}
