import { describe, it, expect, vi } from 'vitest'
import type { CalcItemDef } from '@rei-db-view/types/appdb'
import { __test__ } from './useRuntimeCalc'

const {
  TOTAL_COUNT_ITEM_NAME,
  createRuntimeCalcItems,
  executeRuntimeCalc,
  updateTotals,
} = __test__

describe('createRuntimeCalcItems', () => {
  it('returns empty list outside run mode', () => {
    const items = createRuntimeCalcItems('edit', true, [])
    expect(items).toEqual([])
  })

  it('prepends total count item when pagination enabled', () => {
    const custom: CalcItemDef = {
      name: 'foo',
      type: 'js',
      code: '(vars) => vars.answer',
      runMode: 'manual',
      kind: 'single',
    }
    const items = createRuntimeCalcItems('run', true, [custom])
    expect(items[0]?.name).toBe(TOTAL_COUNT_ITEM_NAME)
    expect(items[1]).toEqual(expect.objectContaining({ name: 'foo' }))
  })
})

describe('executeRuntimeCalc', () => {
  it('computes SQL total count and produces totals update', async () => {
    const compute = vi.fn(async () => ({
      rows: [{ total: 42 }],
      columns: ['total'],
      timing: { connectMs: 3, queryMs: 7 },
    }))
    let now = 100
    const getNow = () => {
      now += 5
      return now
    }
    const item: CalcItemDef = {
      name: TOTAL_COUNT_ITEM_NAME,
      type: 'sql',
      code: 'select 1',
      runMode: 'manual',
      kind: 'single',
    }
    const outcome = await executeRuntimeCalc({
      item,
      currentId: 'saved-1',
      userConnId: 'conn-1',
      runValues: {},
      rows: [],
      pageSize: 10,
      getNow,
      computeCalc: compute,
    })
    expect(outcome.totalsUpdate).toEqual({ totalRows: 42, totalPages: 5, countLoaded: true })
    expect(outcome.nextState.value).toBe(42)
    expect(outcome.nextState.loading).toBe(false)
    expect(outcome.nextState.timing?.connectMs).toBe(3)
    expect(outcome.nextState.timing?.queryMs).toBe(7)
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('runs JS calc using helpers', async () => {
    const getNow = () => 100
    const item: CalcItemDef = {
      name: 'custom',
      type: 'js',
      code: '(vars, rows, helpers) => helpers.sumBy(rows, (r) => r.value) + vars.offset',
      runMode: 'manual',
      kind: 'single',
    }
    const outcome = await executeRuntimeCalc({
      item,
      currentId: 'saved',
      userConnId: 'conn',
      runValues: { offset: 5 },
      rows: [{ value: 10 }, { value: 2 }],
      pageSize: 10,
      getNow,
      computeCalc: vi.fn(),
    })
    expect(outcome.nextState.value).toBe(17)
    expect(outcome.nextState.error).toBeUndefined()
    expect(outcome.totalsUpdate).toBeUndefined()
  })

  it('returns error outcome when connection is missing', async () => {
    const item: CalcItemDef = {
      name: 'custom-sql',
      type: 'sql',
      code: 'select 1',
      runMode: 'manual',
      kind: 'single',
    }
    const previous = { value: 12 }
    const outcome = await executeRuntimeCalc({
      item,
      currentId: null,
      userConnId: null,
      runValues: {},
      rows: [],
      pageSize: 20,
      getNow: () => 200,
      previousState: previous,
      computeCalc: vi.fn(),
    })
    expect(outcome.nextState.error).toBe('请先保存/选择查询')
    expect(outcome.nextState.value).toBe(12)
    expect(outcome.totalsUpdate).toBeUndefined()
  })
})

describe('updateTotals', () => {
  it('updates controller and infers countLoaded when omitted', () => {
    const rows: Array<number | null> = []
    const pages: Array<number | null> = []
    const loaded: boolean[] = []
    updateTotals(
      {
        setTotalRows: (value) => rows.push(value),
        setTotalPages: (value) => pages.push(value),
        setCountLoaded: (value) => loaded.push(value),
      },
      { totalRows: 30, totalPages: 3 },
    )
    expect(rows).toEqual([30])
    expect(pages).toEqual([3])
    expect(loaded).toEqual([true])
  })
})
