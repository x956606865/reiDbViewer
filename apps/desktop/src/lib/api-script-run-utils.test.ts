import { describe, expect, it } from 'vitest'
import type { QueryApiScriptRunRecord } from '../services/queryApiScripts'
import {
  ApiScriptRunEventPayload,
  applyPendingEventsToRuns,
  extractRunProgress,
  extractRunScriptInfo,
  mergeRunEvent,
  normalizeRunStatus,
} from './api-script-run-utils'

const baseRecord = (): QueryApiScriptRunRecord => ({
  id: 'run-1',
  scriptId: 'script-1',
  queryId: 'query-1',
  status: 'pending',
  scriptSnapshot: {},
  progressSnapshot: {},
  errorMessage: null,
  outputDir: null,
  manifestPath: null,
  zipPath: null,
  totalBatches: null,
  processedBatches: null,
  successRows: null,
  errorRows: null,
  startedAt: null,
  finishedAt: null,
  createdAt: '2025-09-20T00:00:00.000Z',
  updatedAt: '2025-09-20T00:00:00.000Z',
})

describe('normalizeRunStatus', () => {
  it('returns normalized status when known', () => {
    expect(normalizeRunStatus('RUNNING', 'pending')).toBe('running')
  })

  it('falls back when status unknown', () => {
    expect(normalizeRunStatus('processing', 'running')).toBe('running')
  })
})

describe('extractRunScriptInfo', () => {
  it('reads script metadata when present', () => {
    const record: QueryApiScriptRunRecord = {
      ...baseRecord(),
      scriptSnapshot: {
        script: {
          name: 'Sync Users',
          method: 'POST',
          endpoint: 'https://api.example.com/users',
        },
      },
    }
    const info = extractRunScriptInfo(record)
    expect(info.name).toBe('Sync Users')
    expect(info.method).toBe('POST')
    expect(info.endpoint).toBe('https://api.example.com/users')
  })

  it('returns nulls when snapshot missing', () => {
    const info = extractRunScriptInfo(baseRecord())
    expect(info.name).toBeNull()
    expect(info.method).toBeNull()
    expect(info.endpoint).toBeNull()
  })
})

describe('extractRunProgress', () => {
  it('prefers record numeric fields when available', () => {
    const record: QueryApiScriptRunRecord = {
      ...baseRecord(),
      totalBatches: 12,
      processedBatches: 5,
      successRows: 400,
      errorRows: 2,
      progressSnapshot: { currentBatch: 5, processedRows: 402 },
    }

    const progress = extractRunProgress(record)

    expect(progress.totalBatches).toBe(12)
    expect(progress.processedBatches).toBe(5)
    expect(progress.successRows).toBe(400)
    expect(progress.errorRows).toBe(2)
    expect(progress.currentBatch).toBe(5)
    expect(progress.processedRows).toBe(402)
  })

  it('falls back to snapshot values when record fields missing', () => {
    const record: QueryApiScriptRunRecord = {
      ...baseRecord(),
      totalBatches: null,
      processedBatches: null,
      successRows: null,
      errorRows: null,
      progressSnapshot: {
        totalBatches: '8',
        processedBatches: 3,
        successRows: '120',
        errorRows: '4',
        requestCount: 10,
        processedRows: 124,
        totalRows: 200,
        currentBatch: '3',
      },
    }

    const progress = extractRunProgress(record)

    expect(progress.totalBatches).toBe(8)
    expect(progress.processedBatches).toBe(3)
    expect(progress.successRows).toBe(120)
    expect(progress.errorRows).toBe(4)
    expect(progress.requestCount).toBe(10)
    expect(progress.processedRows).toBe(124)
    expect(progress.totalRows).toBe(200)
    expect(progress.currentBatch).toBe(3)
  })
})

describe('mergeRunEvent', () => {
  it('updates status, timestamps and progress for running event', () => {
    const record = baseRecord()
    const event: ApiScriptRunEventPayload = {
      run_id: record.id,
      status: 'running',
      progress: {
        totalBatches: 10,
        processedBatches: 3,
        successRows: 120,
        errorRows: 5,
        requestCount: 7,
        processedRows: 125,
        currentBatch: 4,
      },
    }

    const updated = mergeRunEvent(record, event, 1_000)

    expect(updated.status).toBe('running')
    expect(updated.startedAt).toBe(1_000)
    expect(updated.totalBatches).toBe(10)
    expect(updated.processedBatches).toBe(3)
    expect(updated.successRows).toBe(120)
    expect(updated.errorRows).toBe(5)
    expect(updated.progressSnapshot.currentBatch).toBe(4)
    expect(updated.updatedAt).toBe(new Date(1_000).toISOString())
  })

  it('applies terminal status and finishedAt when absent', () => {
    const record: QueryApiScriptRunRecord = {
      ...baseRecord(),
      status: 'running',
      startedAt: 500,
      progressSnapshot: { requestCount: 3 },
    }
    const event: ApiScriptRunEventPayload = {
      run_id: record.id,
      status: 'succeeded',
      message: null,
      progress: {
        totalBatches: 10,
        processedBatches: 10,
        successRows: 1000,
        errorRows: 0,
      },
    }

    const updated = mergeRunEvent(record, event, 2_000)

    expect(updated.status).toBe('succeeded')
    expect(updated.finishedAt).toBe(2_000)
    expect(updated.errorMessage).toBeNull()
    expect(updated.totalBatches).toBe(10)
    expect(updated.successRows).toBe(1000)
    expect(updated.progressSnapshot.requestCount).toBe(3)
  })

  it('keeps existing values when event lacks progress fields', () => {
    const record: QueryApiScriptRunRecord = {
      ...baseRecord(),
      status: 'running',
      totalBatches: 5,
      processedBatches: 2,
      progressSnapshot: { processedRows: 200 },
    }
    const event: ApiScriptRunEventPayload = {
      run_id: record.id,
      status: 'running',
    }

    const updated = mergeRunEvent(record, event, 3_000)

    expect(updated.totalBatches).toBe(5)
    expect(updated.processedBatches).toBe(2)
    expect(updated.progressSnapshot.processedRows).toBe(200)
  })

  it('updates error message when provided', () => {
    const record = baseRecord()
    const event: ApiScriptRunEventPayload = {
      run_id: record.id,
      status: 'failed',
      message: 'network error',
    }

    const updated = mergeRunEvent(record, event, 4_000)

    expect(updated.errorMessage).toBe('network error')
    expect(updated.status).toBe('failed')
    expect(updated.finishedAt).toBe(4_000)
  })
})

describe('applyPendingEventsToRuns', () => {
  it('applies matching events and returns resolved ids', () => {
    const records: QueryApiScriptRunRecord[] = [
      baseRecord(),
      { ...baseRecord(), id: 'run-2', scriptId: 'script-2' },
    ]
    const pending: Record<string, ApiScriptRunEventPayload> = {
      'run-2': {
        run_id: 'run-2',
        status: 'running',
        progress: { processedBatches: 1 },
      },
    }

    const { runs, resolved } = applyPendingEventsToRuns(records, pending, 5_000)

    expect(resolved).toEqual(['run-2'])
    const updated = runs.find((item) => item.id === 'run-2')!
    expect(updated.status).toBe('running')
    expect(updated.processedBatches).toBe(1)
    expect(updated.updatedAt).toBe(new Date(5_000).toISOString())
  })
})
