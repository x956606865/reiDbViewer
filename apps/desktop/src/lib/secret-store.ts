// Per-device secret key storage (SQLite app_prefs) for local AES fallback.
// Avoids requiring the FS plugin; key is a random 32-byte base64 string stored in app_prefs.

import Database from '@tauri-apps/plugin-sql'
import { importAesKey } from '@/lib/aes'

const KEY_NAME = 'device_aes_key_base64'

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
    const v = String(first?.v || '').trim()
    if (v.length >= 44) return v
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
