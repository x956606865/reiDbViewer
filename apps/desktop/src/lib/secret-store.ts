// Per-device secret key storage (SQLite app_prefs) for local AES fallback.
// Avoids requiring the FS plugin; key is a random 32-byte base64 string stored in app_prefs.

import Database from '@tauri-apps/plugin-sql'
import { aesDecryptToString, aesEncryptString, type AesCipher, importAesKey } from '@/lib/aes'
import { decodeSqliteText } from '@/lib/sqlite-text'

const KEY_NAME = 'device_aes_key_base64'

type EncryptedPrefEnvelope = {
  version: 1
  alg: 'A256GCM'
  iv: string
  ct: string
  created_at: number
  updated_at: number
}

function b64(bytes: Uint8Array) {
  let bin = ''
  for (const byte of bytes) {
    bin += String.fromCharCode(byte)
  }
  return btoa(bin)
}

function getCrypto(): Crypto {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi) {
    throw new Error('Web Crypto API is not available')
  }
  return cryptoApi
}

async function openLocal() {
  return await Database.load('sqlite:rdv_local.db')
}

export async function getOrInitDeviceKeyBase64(): Promise<string> {
  const db = await openLocal()
  // @ts-ignore
  const rows = await db.select<any[]>(`SELECT v FROM app_prefs WHERE k = $1`, [KEY_NAME])
  if (Array.isArray(rows) && rows.length > 0) {
    const first = rows[0]
    const text = decodeSqliteText(first?.v)
    const trimmed = text?.trim() ?? ''
    if (trimmed.length >= 44) return trimmed
  }
  const cryptoApi = getCrypto()
  const raw = cryptoApi.getRandomValues(new Uint8Array(32))
  const base64 = b64(raw)
  // @ts-ignore
  await db.execute(
    `INSERT INTO app_prefs (k, v) VALUES ($1, $2)
     ON CONFLICT(k) DO UPDATE SET v = EXCLUDED.v`,
    [KEY_NAME, base64]
  )
  return base64
}

export async function getOrInitDeviceAesKey(): Promise<CryptoKey> {
  const base64 = await getOrInitDeviceKeyBase64()
  return await importAesKey(base64)
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

function parseEnvelope(raw: unknown): EncryptedPrefEnvelope | null {
  const text = decodeSqliteText(raw)
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as Partial<EncryptedPrefEnvelope>
    if (!parsed || parsed.version !== 1) return null
    if (parsed.alg !== 'A256GCM' || !parsed.iv || !parsed.ct) return null
    const created_at = typeof parsed.created_at === 'number' ? parsed.created_at : nowSeconds()
    const updated_at = typeof parsed.updated_at === 'number' ? parsed.updated_at : created_at
    return {
      version: 1,
      alg: 'A256GCM',
      iv: parsed.iv,
      ct: parsed.ct,
      created_at,
      updated_at,
    }
  } catch (error) {
    console.warn('Failed to parse encrypted preference payload', error)
    return null
  }
}

async function writeEnvelope(key: string, envelope: EncryptedPrefEnvelope) {
  const db = await openLocal()
  // @ts-ignore execute is provided by the plugin at runtime
  await db.execute(
    `INSERT INTO app_prefs (k, v) VALUES ($1, $2)
     ON CONFLICT(k) DO UPDATE SET v = EXCLUDED.v`,
    [key, JSON.stringify(envelope)],
  )
}

export async function setEncryptedPref(key: string, plaintext: string): Promise<void> {
  const existing = await getEncryptedEnvelope(key)
  const createdAt = existing?.created_at ?? nowSeconds()
  const aesKey = await getOrInitDeviceAesKey()
  const cipher = await aesEncryptString(aesKey, plaintext)
  const envelope: EncryptedPrefEnvelope = {
    version: 1,
    alg: cipher.alg,
    iv: cipher.iv,
    ct: cipher.ct,
    created_at: createdAt,
    updated_at: nowSeconds(),
  }
  await writeEnvelope(key, envelope)
}

async function getEncryptedEnvelope(key: string): Promise<EncryptedPrefEnvelope | null> {
  const db = await openLocal()
  // @ts-ignore select is provided by the plugin at runtime
  const rows = await db.select<any[]>(`SELECT v FROM app_prefs WHERE k = $1`, [key])
  if (!Array.isArray(rows) || rows.length === 0) return null
  return parseEnvelope(rows[0]?.v)
}

export async function getEncryptedPref(key: string): Promise<string | null> {
  const envelope = await getEncryptedEnvelope(key)
  if (!envelope) return null
  const aesKey = await getOrInitDeviceAesKey()
  try {
    const cipher: AesCipher = { alg: envelope.alg, iv: envelope.iv, ct: envelope.ct }
    return await aesDecryptToString(aesKey, cipher)
  } catch (error) {
    console.error('Failed to decrypt stored secret', error)
    throw new Error('secret_decrypt_failed')
  }
}

export async function deleteEncryptedPref(key: string): Promise<void> {
  const db = await openLocal()
  // @ts-ignore execute is provided by the plugin at runtime
  await db.execute('DELETE FROM app_prefs WHERE k = $1', [key])
}
