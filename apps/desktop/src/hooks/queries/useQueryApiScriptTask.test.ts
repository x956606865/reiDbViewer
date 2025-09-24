import { describe, it, expect, vi } from 'vitest'
import type { ExecuteResult } from '../../services/pgExec'
import { __test__ } from './useQueryApiScriptTask'

const { createRunScriptAction, createCancelRunAction } = __test__

describe('createRunScriptAction', () => {
  const baseDeps = () => {
    const runResult: ExecuteResult = {
      sql: 'SELECT * FROM demo',
      params: ['p1'],
      rows: [],
      columns: [],
      rowCount: 1,
    }
    return {
      mode: 'run' as const,
      queryId: 'query-1',
      selectedScriptId: 'script-1',
      hasFreshResultForScript: true,
      latestRunSignature: 'sig-123',
      lastResultAt: 1234567890,
      userConnId: 'conn-1',
      sql: 'SELECT * FROM demo',
      vars: [{ name: 'foo', type: 'text' }],
      runValues: { foo: 'bar' },
      lastRunResultRef: { current: runResult },
      compileSql: vi.fn(() => ({ text: 'compiled', values: ['bar'] })),
      getDsnForConn: vi.fn(async () => 'postgres://user@host/db'),
      executeApiScript: vi.fn(async () => {}),
      refreshHistory: vi.fn(async () => {}),
      notifyInfo: vi.fn(),
      notifyError: vi.fn(),
      notifySuccess: vi.fn(),
      notifyWarning: vi.fn(),
      setScriptRunning: vi.fn(),
      now: () => 999,
    }
  }

  it('executes script when prerequisites satisfied', async () => {
    const deps = baseDeps()
    const runScript = createRunScriptAction(deps)

    await runScript()

    expect(deps.setScriptRunning).toHaveBeenNthCalledWith(1, true)
    expect(deps.compileSql).toHaveBeenCalledWith(deps.sql, deps.vars, deps.runValues)
    expect(deps.getDsnForConn).toHaveBeenCalledWith('conn-1')
    expect(deps.executeApiScript).toHaveBeenCalledWith(
      expect.objectContaining({
        scriptId: 'script-1',
        queryId: 'query-1',
        runSignature: 'sig-123',
        executedSql: 'SELECT * FROM demo',
        params: ['p1'],
        executedAt: 1234567890,
        userConnId: 'conn-1',
        connectionDsn: 'postgres://user@host/db',
        baseSql: 'compiled',
        baseParams: ['bar'],
      }),
    )
    expect(deps.refreshHistory).toHaveBeenCalled()
    expect(deps.notifySuccess).toHaveBeenCalled()
    expect(deps.notifyError).not.toHaveBeenCalled()
    expect(deps.setScriptRunning).toHaveBeenLastCalledWith(false)
  })

  it('falls back to now when lastResultAt missing', async () => {
    const deps = baseDeps()
    deps.lastResultAt = null
    deps.now = () => 456
    const runScript = createRunScriptAction(deps)

    await runScript()

    expect(deps.executeApiScript).toHaveBeenCalledWith(
      expect.objectContaining({ executedAt: 456 }),
    )
  })

  it('prevents execution when mode is not run', async () => {
    const deps = baseDeps()
    deps.mode = 'temp'
    const runScript = createRunScriptAction(deps)

    await runScript()

    expect(deps.notifyInfo).toHaveBeenCalled()
    expect(deps.executeApiScript).not.toHaveBeenCalled()
  })

  it('emits error notification when execution fails', async () => {
    const deps = baseDeps()
    deps.executeApiScript.mockRejectedValueOnce(new Error('boom'))
    const runScript = createRunScriptAction(deps)

    await runScript()

    expect(deps.notifyError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom' }),
    )
    expect(deps.setScriptRunning).toHaveBeenLastCalledWith(false)
  })
})

describe('createCancelRunAction', () => {
  const baseDeps = () => {
    let canceling: string | null = null
    return {
      getCancelingRunId: () => canceling,
      setCancelingRunId: vi.fn((value: string | null) => {
        canceling = value
      }),
      cancelApiScriptRun: vi.fn(async () => {}),
      notifyWarning: vi.fn(),
      notifyError: vi.fn(),
    }
  }

  const run = {
    id: 'run-1',
    status: 'running',
  } as const

  it('cancels running task and warns user', async () => {
    const deps = baseDeps()
    const cancelRun = createCancelRunAction(deps)

    await cancelRun(run as any)

    expect(deps.setCancelingRunId).toHaveBeenNthCalledWith(1, 'run-1')
    expect(deps.cancelApiScriptRun).toHaveBeenCalledWith('run-1')
    expect(deps.notifyWarning).toHaveBeenCalled()
    expect(deps.setCancelingRunId).toHaveBeenLastCalledWith(null)
  })

  it('reports errors from cancel request', async () => {
    const deps = baseDeps()
    deps.cancelApiScriptRun.mockRejectedValueOnce(new Error('oops'))
    const cancelRun = createCancelRunAction(deps)

    await cancelRun(run as any)

    expect(deps.notifyError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'oops' }),
    )
  })

  it('skips cancel if already cancelling', async () => {
    const deps = baseDeps()
    deps.setCancelingRunId('run-2')
    const cancelRun = createCancelRunAction(deps)

    await cancelRun(run as any)

    expect(deps.cancelApiScriptRun).not.toHaveBeenCalled()
  })
})
