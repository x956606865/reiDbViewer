import Database from '@tauri-apps/plugin-sql'
import { validatePostgresDsn } from '@/lib/validate-dsn'
import { setDsnSecret, getDsnSecret, deleteDsnSecret } from '@/lib/keyring'
import { getOrInitDeviceAesKey } from '@/lib/secret-store'
import { aesEncryptString, aesDecryptToString, type AesCipher } from '@/lib/aes'
import { getCurrentConnId, setCurrentConnId } from '@/lib/current-conn'

async function openLocal() {
  return await Database.load('sqlite:rdv_local.db')
}

const nowSec = () => Math.floor(Date.now() / 1000)

function genId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'conn_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export type UserConn = { id: string; alias: string; created_at?: number | null; updated_at?: number | null }

// Broadcast an event so other components (e.g., ConnectionSwitcher) can refresh
const CONNS_CHANGED_EVENT = 'rdv:user-connections-changed'
function broadcastConnectionsChanged() {
  try { window.dispatchEvent(new CustomEvent(CONNS_CHANGED_EVENT)) } catch {}
}

export async function listConnections(): Promise<UserConn[]> {
  const db = await openLocal()
  // @ts-ignore select is provided by the plugin
  const rows = await db.select<UserConn[]>(
    'SELECT id, alias, created_at, updated_at FROM user_connections ORDER BY updated_at DESC'
  )
  return rows
}

export async function createConnection(alias: string, dsn: string) {
  const chk = validatePostgresDsn(dsn)
  if (!chk.ok) throw new Error(`invalid_dsn:${chk.reason || 'unknown'}`)
  const id = genId()
  const t = nowSec()
  const db = await openLocal()
  // Always store an encrypted copy locally for portability
  const key = await getOrInitDeviceAesKey()
  const cipher = await aesEncryptString(key, dsn)
  const dsnCipher = JSON.stringify(cipher)
  let usedKeyring = false
  // Try to also persist to keyring (optional)
  try { await setDsnSecret(id, dsn); usedKeyring = true } catch {}
  // @ts-ignore
  await db.execute(
    `INSERT INTO user_connections (id, alias, driver, dsn_cipher, dsn_key_ref, created_at, updated_at)
     VALUES ($1, $2, 'postgres', $3, $4, $5, $5)`,
    [id, alias, dsnCipher, usedKeyring ? `conn:${id}` : null, t]
  )
  broadcastConnectionsChanged()
  return { id, storage: usedKeyring ? 'keyring' : 'sqlite-encrypted' as const }
}

export async function deleteConnectionById(id: string) {
  const db = await openLocal()
  // @ts-ignore execute is provided by the plugin
  await db.execute('DELETE FROM user_connections WHERE id = $1', [id])
  try { await deleteDsnSecret(id) } catch {}
  broadcastConnectionsChanged()
}

export async function testConnectionById(id: string) {
  const dsn = await getDsnForConn(id)
  return await testConnectionDsn(dsn)
}

export async function testConnectionDsn(dsn: string) {
  const chk = validatePostgresDsn(dsn)
  if (!chk.ok) throw new Error(`invalid_dsn:${chk.reason || 'unknown'}`)
  const db = await Database.load(dsn)
  // @ts-ignore select is provided by the plugin
  const rows = await db.select('SELECT 1 AS ok')
  return Array.isArray(rows) && rows.length > 0
}

export function getCurrent(): string | null {
  return getCurrentConnId()
}

export function setCurrent(id: string | null) {
  setCurrentConnId(id)
}

export { CONNS_CHANGED_EVENT }

// Unified resolver: try local encrypted DSN first, then keyring
export async function getDsnForConn(id: string): Promise<string> {
  const db = await openLocal()
  // @ts-ignore
  const rows = await db.select<any[]>('SELECT dsn_cipher, dsn_key_ref FROM user_connections WHERE id = $1', [id])
  if (Array.isArray(rows) && rows.length > 0) {
    const r = rows[0]
    if (r.dsn_cipher) {
      try {
        const key = await getOrInitDeviceAesKey()
        const cipher = JSON.parse(String(r.dsn_cipher)) as AesCipher
        return await aesDecryptToString(key, cipher)
      } catch (e: any) {
        throw new Error('local_cipher_decrypt_failed: ' + String(e?.message || e))
      }
    }
    // fallback to keyring if we have a reference
    if (r.dsn_key_ref) {
      return await getDsnSecret(id)
    }
  }
  // as a last resort try keyring by id
  return await getDsnSecret(id)
}

// Update existing record's DSN (write local cipher; try keyring best-effort)
export async function updateConnectionDsn(id: string, alias: string | null, dsn: string) {
  const chk = validatePostgresDsn(dsn)
  if (!chk.ok) throw new Error(`invalid_dsn:${chk.reason || 'unknown'}`)
  const db = await openLocal()
  const key = await getOrInitDeviceAesKey()
  const cipher = JSON.stringify(await aesEncryptString(key, dsn))
  try { await setDsnSecret(id, dsn) } catch {}
  const t = nowSec()
  // @ts-ignore
  await db.execute(
    `UPDATE user_connections SET dsn_cipher = $1, updated_at = $2${alias ? ', alias = $3' : ''} WHERE id = ${alias ? '$4' : '$3'}`,
    alias ? [cipher, t, alias, id] : [cipher, t, id]
  )
  broadcastConnectionsChanged()
}
