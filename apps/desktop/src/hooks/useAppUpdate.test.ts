import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import type { DownloadEvent } from '@tauri-apps/plugin-updater'
import { createAppUpdateStore, DEFAULT_SNOOZE_MS, type AppUpdateDependencies } from './useAppUpdate'

type MockDownloadEvent = DownloadEvent

type MockUpdateHandle = {
  available: boolean
  currentVersion: string
  version: string
  date: string
  body: string
  rawJson: Record<string, unknown>
  downloadAndInstall: MockedFunction<UpdaterDownloadAndInstall>
  close: MockedFunction<() => Promise<void>>
}

type UpdaterDownloadAndInstall = (onEvent?: (event: MockDownloadEvent) => void) => Promise<void>

type CreateMockUpdateResult = MockUpdateHandle & { callbacks: MockDownloadEvent[] }

function createMockUpdate(overrides: Partial<MockUpdateHandle> = {}): CreateMockUpdateResult {
  const callbacks: MockDownloadEvent[] = []
  const downloadAndInstall = vi.fn(async (onEvent?: (event: MockDownloadEvent) => void) => {
    const events: MockDownloadEvent[] = [
      { event: 'Started', data: { contentLength: 120 } },
      { event: 'Progress', data: { chunkLength: 20 } },
      { event: 'Progress', data: { chunkLength: 100 } },
      { event: 'Finished' },
    ]
    for (const evt of events) {
      callbacks.push(evt)
      onEvent?.(evt)
      await Promise.resolve()
    }
  })
  const close = vi.fn(async () => {})
  return {
    available: true,
    currentVersion: '0.0.15',
    version: '0.0.16',
    date: '2025-09-18T08:00:00Z',
    body: '## Improvements',
    rawJson: { notes: 'Regression fixes' },
    downloadAndInstall,
    close,
    callbacks,
    ...overrides,
  }
}

describe('createAppUpdateStore', () => {
  let checkMock: MockedFunction<AppUpdateDependencies['check']>
  let relaunchMock: MockedFunction<AppUpdateDependencies['relaunch']>
  let getVersionMock: MockedFunction<AppUpdateDependencies['getAppVersion']>
  let nowValue: number
  const now = () => nowValue

  beforeEach(() => {
    nowValue = 1_000
    checkMock = vi.fn()
    relaunchMock = vi.fn().mockResolvedValue(undefined)
    getVersionMock = vi.fn().mockResolvedValue('0.0.15')
  })

  it('marks updater unavailable when environment is not tauri', async () => {
    const store = createAppUpdateStore({
      check: checkMock,
      relaunch: relaunchMock,
      getAppVersion: getVersionMock,
      now,
      isTauri: () => false,
    })

    await store.getState().checkForUpdates({ userInitiated: true })

    expect(store.getState().phase).toBe('unavailable')
    expect(checkMock).not.toHaveBeenCalled()
  })

  it('records last check when update is not available', async () => {
    checkMock = vi.fn().mockResolvedValue(null)
    const store = createAppUpdateStore({
      check: checkMock,
      relaunch: relaunchMock,
      getAppVersion: getVersionMock,
      now,
      isTauri: () => true,
    })

    await store.getState().checkForUpdates({ userInitiated: false })

    const state = store.getState()
    expect(checkMock).toHaveBeenCalledTimes(1)
    expect(state.phase).toBe('idle')
    expect(state.update).toBeNull()
    expect(state.lastCheckedAt).toBe(nowValue)
    expect(state.currentVersion).toBe('0.0.15')
  })

  it('stores update metadata when available', async () => {
    const update = createMockUpdate()
    checkMock = vi.fn().mockResolvedValue(update as any)
    const store = createAppUpdateStore({
      check: checkMock,
      relaunch: relaunchMock,
      getAppVersion: getVersionMock,
      now,
      isTauri: () => true,
    })

    await store.getState().checkForUpdates({ userInitiated: true })

    const state = store.getState()
    expect(state.phase).toBe('available')
    expect(state.update?.version).toBe('0.0.16')
    expect(state.update?.notes).toBe('## Improvements')
    expect(state.update?.releaseDate).toBe('2025-09-18T08:00:00Z')
    expect(state.lastCheckedAt).toBe(nowValue)
  })

  it('consumes updater events during download and triggers relaunch', async () => {
    const update = createMockUpdate()
    checkMock = vi.fn().mockResolvedValue(update as any)
    const store = createAppUpdateStore({
      check: checkMock,
      relaunch: relaunchMock,
      getAppVersion: getVersionMock,
      now,
      isTauri: () => true,
    })

    await store.getState().checkForUpdates({ userInitiated: true })
    await store.getState().downloadAndInstall()

    const state = store.getState()
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(relaunchMock).toHaveBeenCalledTimes(1)
    expect(state.phase).toBe('relaunching')
    expect(state.progress?.downloaded).toBe(120)
    expect(state.progress?.total).toBe(120)
  })

  it('captures download errors and keeps update available for retry', async () => {
    const error = new Error('network timeout')
    const update = createMockUpdate({
      downloadAndInstall: vi.fn(async () => {
        throw error
      }),
    })
    checkMock = vi.fn().mockResolvedValue(update as any)
    const store = createAppUpdateStore({
      check: checkMock,
      relaunch: relaunchMock,
      getAppVersion: getVersionMock,
      now,
      isTauri: () => true,
    })

    await store.getState().checkForUpdates({ userInitiated: true })
    await store.getState().downloadAndInstall()

    const state = store.getState()
    expect(state.phase).toBe('failed')
    expect(state.lastError).toContain('network timeout')
    expect(state.update?.version).toBe('0.0.16')
  })

  it('dismisses update and schedules snooze window', async () => {
    const update = createMockUpdate()
    checkMock = vi.fn().mockResolvedValue(update as any)
    const store = createAppUpdateStore({
      check: checkMock,
      relaunch: relaunchMock,
      getAppVersion: getVersionMock,
      now,
      isTauri: () => true,
    })

    await store.getState().checkForUpdates({ userInitiated: false })
    nowValue += 500
    await store.getState().dismissUpdate({ remindInMs: DEFAULT_SNOOZE_MS })

    const state = store.getState()
    expect(update.close).toHaveBeenCalledTimes(1)
    expect(state.phase).toBe('idle')
    expect(state.update).toBeNull()
    expect(state.snoozedUntil).toBe(nowValue + DEFAULT_SNOOZE_MS)
  })

  it('skips auto-check while snoozed but allows manual retry', async () => {
    const update = createMockUpdate()
    checkMock = vi.fn().mockResolvedValue(update as any)
    const store = createAppUpdateStore({
      check: checkMock,
      relaunch: relaunchMock,
      getAppVersion: getVersionMock,
      now,
      isTauri: () => true,
    })

    await store.getState().checkForUpdates({ userInitiated: true })
    await store.getState().dismissUpdate({ remindInMs: DEFAULT_SNOOZE_MS })

    checkMock.mockClear()
    await store.getState().checkForUpdates({ userInitiated: false })
    expect(checkMock).not.toHaveBeenCalled()

    nowValue += DEFAULT_SNOOZE_MS + 100
    await store.getState().checkForUpdates({ userInitiated: false })
    expect(checkMock).toHaveBeenCalledTimes(1)
  })
})
