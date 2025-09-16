import { invoke } from '@tauri-apps/api/core'

function ensureTauriRuntime() {
  if (typeof window === 'undefined') throw new Error('Not in browser')
  const w = window as any
  const ok = !!(w.__TAURI__ || w.__TAURI_IPC__ || w.__TAURI_INTERNALS__)
  if (!ok) throw new Error('Tauri runtime not detected. Run via "tauri dev" or app build.')
}

const accountOf = (connId: string) => `conn:${connId}`

export async function setDsnSecret(connId: string, dsn: string) {
  ensureTauriRuntime()
  await invoke('set_secret', { account: accountOf(connId), secret: dsn })
}

export async function getDsnSecret(connId: string): Promise<string> {
  ensureTauriRuntime()
  return await invoke<string>('get_secret', { account: accountOf(connId) })
}

export async function deleteDsnSecret(connId: string) {
  ensureTauriRuntime()
  await invoke('delete_secret', { account: accountOf(connId) })
}
