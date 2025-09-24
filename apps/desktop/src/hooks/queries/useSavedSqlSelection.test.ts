import { describe, it, expect } from 'vitest'
import type {
  SavedQueryVariableDef,
  DynamicColumnDef,
  CalcItemDef,
} from '@rei-db-view/types/appdb'
import {
  RUN_KEY_DRAFT,
  RUN_KEY_TEMP,
  createInitialSelectionState,
  createInitialRunValueStore,
  startNewSelection,
  switchToTempSelection,
  loadSavedSelection,
} from './useSavedSqlSelection'

describe('useSavedSqlSelection helpers', () => {
  const defaultSql = 'SELECT * FROM example'
  const defaultTempSql = 'SELECT 1'

  it('creates initial selection state with defaults', () => {
    const state = createInitialSelectionState({
      defaultSql,
      defaultTempSql,
    })
    expect(state).toEqual({
      mode: 'run',
      currentId: null,
      name: '',
      description: '',
      sql: defaultSql,
      tempSql: defaultTempSql,
      vars: [],
      runValues: {},
    })
  })

  it('startNewSelection resets fields and persists previous run values', () => {
    const state = {
      mode: 'run' as const,
      currentId: 'saved-1',
      name: 'Old report',
      description: 'desc',
      sql: 'SELECT * FROM t',
      tempSql: defaultTempSql,
      vars: [{ name: 'foo', type: 'text' } as SavedQueryVariableDef],
      runValues: { foo: 'bar' as const },
    }
    const store = {
      [RUN_KEY_DRAFT]: { draftOnly: 1 },
      [RUN_KEY_TEMP]: {},
      'saved-1': { foo: 'stale' },
    }

    const { state: nextState, store: nextStore } = startNewSelection(state, store)

    expect(nextState).toEqual({
      mode: 'edit',
      currentId: null,
      name: '',
      description: '',
      sql: '',
      tempSql: defaultTempSql,
      vars: [],
      runValues: {},
    })
    expect(nextStore['saved-1']).toEqual({ foo: 'bar' })
    expect(nextStore[RUN_KEY_DRAFT]).toEqual({})
    expect(nextStore[RUN_KEY_TEMP]).toEqual({})
  })

  it('switchToTempSelection loads stored temp values and falls back temp SQL', () => {
    const state = {
      mode: 'run' as const,
      currentId: 'saved-2',
      name: 'Another',
      description: '',
      sql: 'SELECT * FROM t2',
      tempSql: '   ',
      vars: [] as SavedQueryVariableDef[],
      runValues: { foo: 'baz' },
    }
    const store = {
      [RUN_KEY_DRAFT]: {},
      [RUN_KEY_TEMP]: { foo: 'temp-val' },
      'saved-2': { foo: 'old-baz' },
    }

    const { state: nextState, store: nextStore } = switchToTempSelection(state, store, {
      defaultTempSql,
    })

    expect(nextState.mode).toBe('temp')
    expect(nextState.currentId).toBeNull()
    expect(nextState.tempSql).toBe(defaultTempSql)
    expect(nextState.runValues).toEqual({})
    expect(nextStore['saved-2']).toEqual({ foo: 'baz' })
    expect(nextStore[RUN_KEY_TEMP]).toEqual({})
  })

  it('loadSavedSelection merges stored values with defaults and returns extras', () => {
    const state = {
      mode: 'temp' as const,
      currentId: null,
      name: '',
      description: '',
      sql: '',
      tempSql: defaultTempSql,
      vars: [],
      runValues: {},
    }
    const store = {
      [RUN_KEY_DRAFT]: {},
      [RUN_KEY_TEMP]: { temp: 1 },
      'saved-3': { foo: 'persisted', unused: 'ignore' },
    }

    const record = {
      id: 'saved-3',
      name: 'Report 3',
      description: 'hello',
      sql: 'SELECT id FROM demo',
      variables: [
        { name: 'foo', type: 'text', default: 'fallback' } as SavedQueryVariableDef,
        { name: 'bar', type: 'number', default: 42 } as SavedQueryVariableDef,
      ],
      dynamicColumns: [
        { key: 'col1', title: 'Col 1', path: ['a'] } as unknown as DynamicColumnDef,
      ],
      calcItems: [{ id: 'c1', type: 'count' } as CalcItemDef],
    }

    const {
      state: nextState,
      store: nextStore,
      extras,
    } = loadSavedSelection(state, store, record, { focusMode: 'run' })

    expect(nextState).toEqual({
      mode: 'run',
      currentId: 'saved-3',
      name: 'Report 3',
      description: 'hello',
      sql: 'SELECT id FROM demo',
      tempSql: defaultTempSql,
      vars: record.variables,
      runValues: { foo: 'persisted', bar: 42 },
    })
    expect(nextStore['saved-3']).toEqual({ foo: 'persisted', bar: 42 })
    expect(extras.dynamicColumns).toEqual(record.dynamicColumns)
    expect(extras.calcItems).toEqual(record.calcItems)
  })
})
