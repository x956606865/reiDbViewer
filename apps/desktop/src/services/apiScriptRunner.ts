import { invoke } from '@tauri-apps/api/core'

export type ExecuteApiScriptArgs = {
  scriptId: string
  queryId: string
  runSignature: string
  executedSql: string
  params: any[]
  executedAt: number
  userConnId: string
  connectionDsn: string
  baseSql: string
  baseParams: any[]
}

export async function executeApiScript(args: ExecuteApiScriptArgs): Promise<void> {
  try {
    await invoke('execute_api_script', { args })
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    throw error
  }
}

export async function cancelApiScriptRun(runId: string): Promise<void> {
  try {
    await invoke('cancel_api_script_run', { runId })
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    throw error
  }
}

export type ApiScriptRequestLogEntry = {
  timestamp: number
  fetch_index: number
  request_index: number
  request_size: number
  start_row: number
  end_row: number
  status: number | null
  duration_ms: number
  error: string | null
  response_excerpt: string | null
}

export async function exportApiScriptRunZip(runId: string, destination: string): Promise<void> {
  try {
    await invoke('export_api_script_run_zip', { runId, destination })
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    throw error
  }
}

export async function ensureApiScriptRunZip(runId: string): Promise<string> {
  try {
    const zipPath = await invoke<string>('ensure_api_script_run_zip', { runId })
    return zipPath
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    throw error
  }
}

export async function readApiScriptRunLog(
  runId: string,
  limit?: number,
): Promise<ApiScriptRequestLogEntry[]> {
  try {
    const entries = await invoke<ApiScriptRequestLogEntry[]>('read_api_script_run_log', {
      runId,
      limit,
    })
    return entries
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    throw error
  }
}

export async function cleanupApiScriptCache(olderThanMs?: number): Promise<number> {
  try {
    const cleaned = await invoke<number>('cleanup_api_script_cache', {
      olderThanMs,
    })
    return cleaned
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    throw error
  }
}
