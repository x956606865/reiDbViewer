import { useEffect } from 'react'
import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import { check, type CheckOptions, type DownloadEvent, type Update as UpdaterUpdate } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'relaunching'
  | 'failed'
  | 'unavailable'

export type UpdateDetails = {
  version: string
  currentVersion: string | null
  releaseDate: string | null
  notes: string | null
  rawJson: Record<string, unknown>
}

export type UpdateProgress = {
  downloaded: number
  total: number | null
}

export type AppUpdateViewState = {
  phase: UpdatePhase
  update: UpdateDetails | null
  progress: UpdateProgress | null
  lastCheckedAt: number | null
  lastCompletedAt: number | null
  lastError: string | null
  currentVersion: string | null
  snoozedUntil: number | null
  isBusy: boolean
}

export type CheckForUpdatesOptions = {
  userInitiated?: boolean
  request?: CheckOptions
}

export type DismissOptions = {
  remindInMs?: number
}

export type AppUpdateActions = {
  checkForUpdates: (options?: CheckForUpdatesOptions) => Promise<void>
  downloadAndInstall: () => Promise<void>
  dismissUpdate: (options?: DismissOptions) => Promise<void>
  resetError: () => void
}

export type AppUpdateState = AppUpdateViewState &
  AppUpdateActions & {
    updateHandle: UpdaterUpdate | null
    checkingUserInitiated: boolean
  }

export type AppUpdateDependencies = {
  check: (options?: CheckOptions) => Promise<UpdaterUpdate | null>
  relaunch: () => Promise<void>
  getAppVersion: () => Promise<string>
  now: () => number
  isTauri: () => boolean
}

export const DEFAULT_SNOOZE_MS = 15 * 60 * 1000

function formatError(error: unknown): string {
  if (!error) return 'Unknown error'
  if (typeof error === 'string') return error
  if (error instanceof Error && typeof error.message === 'string') return error.message
  const message = (error as { message?: unknown }).message
  if (typeof message === 'string') return message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function isPluginUnavailableError(error: unknown): boolean {
  if (!error) return false
  const message = typeof error === 'string' ? error : (error as { message?: unknown }).message
  if (typeof message !== 'string') return false
  const normalized = message.toLowerCase()
  return (
    normalized.includes('plugin') &&
    (normalized.includes('updater') || normalized.includes('process')) &&
    (normalized.includes('not initialized') || normalized.includes('not available') || normalized.includes('not found'))
  )
}

function normalizeUpdate(update: UpdaterUpdate, currentVersion: string | null): UpdateDetails {
  return {
    version: update.version,
    currentVersion,
    releaseDate: update.date ?? null,
    notes: update.body ?? null,
    rawJson: update.rawJson ?? {},
  }
}

async function safeClose(update: UpdaterUpdate | null | undefined) {
  if (!update) return
  try {
    await update.close()
  } catch (error) {
    console.warn('Failed to close updater resource', error)
  }
}

function initialState(): AppUpdateState {
  return {
    phase: 'idle',
    update: null,
    updateHandle: null,
    progress: null,
    lastCheckedAt: null,
    lastCompletedAt: null,
    lastError: null,
    currentVersion: null,
    snoozedUntil: null,
    isBusy: false,
    checkingUserInitiated: false,
    checkForUpdates: async () => {},
    downloadAndInstall: async () => {},
    dismissUpdate: async () => {},
    resetError: () => {},
  }
}

export function createAppUpdateStore(deps: AppUpdateDependencies): UseBoundStore<StoreApi<AppUpdateState>> {
  const store = create<AppUpdateState>()((set, get) => {
    const ensureCurrentVersion = async () => {
      const current = get().currentVersion
      if (current) return current
      try {
        const version = await deps.getAppVersion()
        set((state) => ({ ...state, currentVersion: version }))
        return version
      } catch (error) {
        console.warn('Failed to resolve app version', error)
        return null
      }
    }

    const applyFailure = (error: unknown) => {
      set((state) => ({
        ...state,
        phase: isPluginUnavailableError(error) ? 'unavailable' : 'failed',
        lastError: formatError(error),
        isBusy: false,
      }))
    }

    const updateProgress = (updater: (prev: UpdateProgress | null) => UpdateProgress | null) => {
      set((state) => ({
        ...state,
        progress: updater(state.progress),
      }))
    }

    const handleDownloadEvent = () => {
      let downloaded = 0
      let total: number | null = null
      return (event: DownloadEvent) => {
        if (event.event === 'Started') {
          downloaded = 0
          total = event.data.contentLength ?? null
          updateProgress(() => ({ downloaded, total }))
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          updateProgress(() => ({ downloaded, total }))
        } else if (event.event === 'Finished') {
          updateProgress(() => ({ downloaded, total }))
        }
      }
    }

    return {
      ...initialState(),
      checkForUpdates: async (options?: CheckForUpdatesOptions) => {
        const userInitiated = options?.userInitiated ?? false
        const requestOptions = options?.request

        if (!deps.isTauri()) {
          set((state) => ({ ...state, phase: 'unavailable', lastError: state.lastError, isBusy: false }))
          return
        }

        const snoozedUntil = get().snoozedUntil
        if (!userInitiated && typeof snoozedUntil === 'number' && deps.now() < snoozedUntil) {
          return
        }

        const state = get()
        if (state.isBusy && state.phase !== 'failed') {
          return
        }

        set((prev) => ({
          ...prev,
          phase: 'checking',
          isBusy: true,
          lastError: userInitiated ? null : prev.lastError,
          checkingUserInitiated: userInitiated,
        }))

        try {
          await ensureCurrentVersion()
          const updateHandle = await deps.check(requestOptions)
          const timestamp = deps.now()

          if (!updateHandle) {
            const previous = get().updateHandle
            if (previous) {
              await safeClose(previous)
            }
            set((prev) => ({
              ...prev,
              phase: 'idle',
              update: null,
              updateHandle: null,
              progress: null,
              lastCheckedAt: timestamp,
              lastCompletedAt: timestamp,
              isBusy: false,
              snoozedUntil: null,
            }))
            return
          }

          const previous = get().updateHandle
          if (previous && previous !== updateHandle) {
            await safeClose(previous)
          }

          const currentVersion = get().currentVersion
          set((prev) => ({
            ...prev,
            phase: 'available',
            update: normalizeUpdate(updateHandle, currentVersion ?? null),
            updateHandle,
            progress: null,
            lastCheckedAt: timestamp,
            isBusy: false,
            lastError: null,
            snoozedUntil: null,
          }))
        } catch (error) {
          applyFailure(error)
        }
      },
      downloadAndInstall: async () => {
        const state = get()
        const handle = state.updateHandle
        if (!deps.isTauri() || !handle) {
          return
        }

        set((prev) => ({
          ...prev,
          phase: 'downloading',
          isBusy: true,
          lastError: null,
          progress: prev.progress ?? { downloaded: 0, total: null },
        }))

        const onProgress = handleDownloadEvent()

        try {
          await handle.downloadAndInstall(onProgress)
          set((prev) => ({
            ...prev,
            phase: 'installing',
            lastCompletedAt: deps.now(),
            isBusy: true,
          }))
          await deps.relaunch()
          set((prev) => ({
            ...prev,
            phase: 'relaunching',
            isBusy: true,
          }))
        } catch (error) {
          applyFailure(error)
        }
      },
      dismissUpdate: async (options?: DismissOptions) => {
        const snoozeMs = options?.remindInMs ?? DEFAULT_SNOOZE_MS
        const handle = get().updateHandle
        await safeClose(handle)
        const nowTs = deps.now()
        set((prev) => ({
          ...prev,
          phase: 'idle',
          update: null,
          updateHandle: null,
          progress: null,
          isBusy: false,
          lastError: null,
          snoozedUntil: nowTs + Math.max(0, snoozeMs),
        }))
      },
      resetError: () => {
        set((prev) => ({
          ...prev,
          lastError: null,
          phase: prev.phase === 'failed' ? 'idle' : prev.phase,
        }))
      },
    }
  })

  return store
}

const defaultDependencies: AppUpdateDependencies = {
  check,
  relaunch,
  getAppVersion: getVersion,
  now: () => Date.now(),
  isTauri: () => typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__),
}

export const useAppUpdateStore = createAppUpdateStore(defaultDependencies)

export function useAppUpdate(selector?: (state: AppUpdateState) => unknown) {
  const select = selector ?? ((state: AppUpdateState) => state)
  return useAppUpdateStore(select as any)
}

export function useAppUpdateAutoCheck(enabled: boolean = true) {
  const check = useAppUpdateStore((state) => state.checkForUpdates)
  useEffect(() => {
    if (!enabled) return
    check({ userInitiated: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}

export const __test__ = {
  formatError,
  normalizeUpdate,
  isPluginUnavailableError,
}
