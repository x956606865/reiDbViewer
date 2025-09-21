import type { AssistantProvider } from './provider-settings'
import { deleteEncryptedPref, getEncryptedPref, setEncryptedPref } from '@/lib/secret-store'

const prefKeyOf = (provider: AssistantProvider) => `assistant.apiKey.${provider}`

export async function setAssistantApiKey(provider: AssistantProvider, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    await deleteAssistantApiKey(provider)
    return
  }
  await setEncryptedPref(prefKeyOf(provider), trimmed)
}

export async function getAssistantApiKey(provider: AssistantProvider): Promise<string> {
  const secret = await getEncryptedPref(prefKeyOf(provider))
  if (!secret) {
    throw new Error('assistant_api_key_missing')
  }
  return secret
}

export async function deleteAssistantApiKey(provider: AssistantProvider): Promise<void> {
  await deleteEncryptedPref(prefKeyOf(provider))
}

export async function hasAssistantApiKey(provider: AssistantProvider): Promise<boolean> {
  try {
    const secret = await getEncryptedPref(prefKeyOf(provider))
    return Boolean(secret && secret.trim().length > 0)
  } catch (error) {
    console.error('Failed to inspect assistant API key state', error)
    return false
  }
}

export const __test__ = {
  prefKeyOf,
}
