import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type {
  SavedQueryVariableDef,
  DynamicColumnDef,
  CalcItemDef,
} from '@rei-db-view/types/appdb'

type SavedSqlMode = 'run' | 'edit' | 'temp'

export type SavedSqlSelectionState = {
  mode: SavedSqlMode
  currentId: string | null
  name: string
  description: string
  sql: string
  tempSql: string
  vars: SavedQueryVariableDef[]
  runValues: Record<string, any>
}

export type RunValueStore = Record<string, Record<string, any>>

export const RUN_KEY_DRAFT = '__draft__'
export const RUN_KEY_TEMP = '__temp__'

export const resolveRunKey = (mode: SavedSqlMode, id: string | null): string => {
  if (mode === 'temp') return RUN_KEY_TEMP
  if (!id) return RUN_KEY_DRAFT
  return id
}

const shallowEqualRecord = (
  a: Record<string, any>,
  b: Record<string, any>,
): boolean => {
  if (a === b) return true
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (a[key] !== b[key]) return false
  }
  return true
}

export const createInitialRunValueStore = (): RunValueStore => ({
  [RUN_KEY_DRAFT]: {},
  [RUN_KEY_TEMP]: {},
})

export const createInitialSelectionState = ({
  defaultSql,
  defaultTempSql,
}: {
  defaultSql: string
  defaultTempSql: string
}): SavedSqlSelectionState => ({
  mode: 'run',
  currentId: null,
  name: '',
  description: '',
  sql: defaultSql,
  tempSql: defaultTempSql,
  vars: [],
  runValues: {},
})

const mergeRunValuesWithDefaults = (
  defs: SavedQueryVariableDef[],
  existing?: Record<string, any>,
): Record<string, any> => {
  const merged: Record<string, any> = {}
  for (const def of defs) {
    const varName = def?.name
    if (!varName) continue
    if (existing && Object.prototype.hasOwnProperty.call(existing, varName)) {
      merged[varName] = existing[varName]
    } else if (def.default !== undefined) {
      merged[varName] = def.default
    } else {
      merged[varName] = ''
    }
  }
  return merged
}

export const syncRunValues = (
  store: RunValueStore,
  key: string,
  values: Record<string, any>,
): RunValueStore => {
  const prev = store[key]
  if (prev && shallowEqualRecord(prev, values)) return store
  return {
    ...store,
    [key]: { ...values },
  }
}

export const applyRunValuesFromDefs = (
  store: RunValueStore,
  key: string,
  defs: SavedQueryVariableDef[],
): { store: RunValueStore; values: Record<string, any> } => {
  const existing = store[key]
  const merged = mergeRunValuesWithDefaults(defs, existing)
  return {
    store: {
      ...store,
      [key]: { ...merged },
    },
    values: merged,
  }
}

export const startNewSelection = (
  state: SavedSqlSelectionState,
  store: RunValueStore,
): { state: SavedSqlSelectionState; store: RunValueStore } => {
  const activeKey = resolveRunKey(state.mode, state.currentId)
  let nextStore = syncRunValues(store, activeKey, state.runValues)
  nextStore = syncRunValues(nextStore, RUN_KEY_DRAFT, {})
  const nextState: SavedSqlSelectionState = {
    mode: 'edit',
    currentId: null,
    name: '',
    description: '',
    sql: '',
    tempSql: state.tempSql,
    vars: [],
    runValues: {},
  }
  return { state: nextState, store: nextStore }
}

export const switchToTempSelection = (
  state: SavedSqlSelectionState,
  store: RunValueStore,
  { defaultTempSql }: { defaultTempSql: string },
): { state: SavedSqlSelectionState; store: RunValueStore } => {
  const activeKey = resolveRunKey(state.mode, state.currentId)
  let nextStore = syncRunValues(store, activeKey, state.runValues)
  nextStore = syncRunValues(nextStore, RUN_KEY_TEMP, {})
  const storedTempValues = nextStore[RUN_KEY_TEMP] ?? {}
  const nextTempSql = state.tempSql.trim().length > 0 ? state.tempSql : defaultTempSql
  const nextState: SavedSqlSelectionState = {
    mode: 'temp',
    currentId: null,
    name: state.name,
    description: state.description,
    sql: state.sql,
    tempSql: nextTempSql,
    vars: state.vars,
    runValues: storedTempValues,
  }
  return { state: nextState, store: nextStore }
}

export const loadSavedSelection = (
  state: SavedSqlSelectionState,
  store: RunValueStore,
  record: {
    id: string
    name: string
    description: string | null
    sql: string
    variables: SavedQueryVariableDef[]
    dynamicColumns: DynamicColumnDef[]
    calcItems: CalcItemDef[]
  },
  { focusMode }: { focusMode: Exclude<SavedSqlMode, 'temp'> },
): {
  state: SavedSqlSelectionState
  store: RunValueStore
  extras: { dynamicColumns: DynamicColumnDef[]; calcItems: CalcItemDef[] }
} => {
  const activeKey = resolveRunKey(state.mode, state.currentId)
  const persistedStore = syncRunValues(store, activeKey, state.runValues)
  const applied = applyRunValuesFromDefs(persistedStore, record.id, record.variables)
  const nextState: SavedSqlSelectionState = {
    mode: focusMode,
    currentId: record.id,
    name: record.name,
    description: record.description ?? '',
    sql: record.sql,
    tempSql: state.tempSql,
    vars: record.variables,
    runValues: applied.values,
  }
  return {
    state: nextState,
    store: applied.store,
    extras: {
      dynamicColumns: record.dynamicColumns,
      calcItems: record.calcItems,
    },
  }
}

type UseSavedSqlSelectionOptions = {
  defaultSql: string
  defaultTempSql: string
  loadSavedSql: (id: string) => Promise<{
    id: string
    name: string
    description: string | null
    sql: string
    variables: SavedQueryVariableDef[]
    dynamicColumns: DynamicColumnDef[]
    calcItems: CalcItemDef[]
  } | null>
}

type LoadSavedExtras = {
  dynamicColumns: DynamicColumnDef[]
  calcItems: CalcItemDef[]
}

type SavedSelectionResult = {
  mode: SavedSqlMode
  setMode: Dispatch<SetStateAction<SavedSqlMode>>
  currentId: string | null
  setCurrentId: Dispatch<SetStateAction<string | null>>
  name: string
  setName: Dispatch<SetStateAction<string>>
  description: string
  setDescription: Dispatch<SetStateAction<string>>
  sql: string
  setSql: Dispatch<SetStateAction<string>>
  tempSql: string
  setTempSql: Dispatch<SetStateAction<string>>
  vars: SavedQueryVariableDef[]
  setVars: Dispatch<SetStateAction<SavedQueryVariableDef[]>>
  runValues: Record<string, any>
  setRunValues: Dispatch<SetStateAction<Record<string, any>>>
  startNew: () => void
  switchToTemp: () => void
  loadSaved: (id: string, focusMode: Exclude<SavedSqlMode, 'temp'>) => Promise<LoadSavedExtras>
}

export const useSavedSqlSelection = ({
  defaultSql,
  defaultTempSql,
  loadSavedSql,
}: UseSavedSqlSelectionOptions): SavedSelectionResult => {
  const [mode, setMode] = useState<SavedSqlMode>('run')
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sql, setSql] = useState(defaultSql)
  const [tempSql, setTempSql] = useState(defaultTempSql)
  const [vars, setVars] = useState<SavedQueryVariableDef[]>([])
  const [runValues, setRunValuesState] = useState<Record<string, any>>({})

  const runStoreRef = useRef<RunValueStore>(createInitialRunValueStore())

  const buildSnapshot = useCallback((): SavedSqlSelectionState => ({
    mode,
    currentId,
    name,
    description,
    sql,
    tempSql,
    vars,
    runValues,
  }), [mode, currentId, name, description, sql, tempSql, vars, runValues])

  const applyState = useCallback((next: SavedSqlSelectionState) => {
    setMode(next.mode)
    setCurrentId(next.currentId)
    setName(next.name)
    setDescription(next.description)
    setSql(next.sql)
    setTempSql(next.tempSql)
    setVars(next.vars)
    setRunValuesState(next.runValues)
  }, [])

  const setRunValues = useCallback<React.Dispatch<React.SetStateAction<Record<string, any>>>>(
    (update) => {
      setRunValuesState((prev) => {
        const next =
          typeof update === 'function'
            ? (update as (prev: Record<string, any>) => Record<string, any>)(prev)
            : update
        const key = resolveRunKey(mode, currentId)
        runStoreRef.current = syncRunValues(runStoreRef.current, key, next)
        return next
      })
    },
    [mode, currentId],
  )

  const startNew = useCallback(() => {
    const snapshot = buildSnapshot()
    const result = startNewSelection(snapshot, runStoreRef.current)
    runStoreRef.current = result.store
    applyState(result.state)
  }, [applyState, buildSnapshot])

  const switchToTemp = useCallback(() => {
    const snapshot = buildSnapshot()
    const result = switchToTempSelection(snapshot, runStoreRef.current, {
      defaultTempSql,
    })
    runStoreRef.current = result.store
    applyState(result.state)
  }, [applyState, buildSnapshot, defaultTempSql])

  const loadSaved = useCallback(
    async (id: string, focusMode: Exclude<SavedSqlMode, 'temp'>) => {
      const record = await loadSavedSql(id)
      if (!record) throw new Error('Saved SQL not found')
      const snapshot = buildSnapshot()
      const result = loadSavedSelection(snapshot, runStoreRef.current, record, {
        focusMode,
      })
      runStoreRef.current = result.store
      applyState(result.state)
      return result.extras
    },
    [applyState, buildSnapshot, loadSavedSql],
  )

  return useMemo(
    () => ({
      mode,
      setMode,
      currentId,
      setCurrentId,
      name,
      setName,
      description,
      setDescription,
      sql,
      setSql,
      tempSql,
      setTempSql,
      vars,
      setVars,
      runValues,
      setRunValues,
      startNew,
      switchToTemp,
      loadSaved,
    }),
    [
      mode,
      setMode,
      currentId,
      setCurrentId,
      name,
      description,
      sql,
      tempSql,
      vars,
      runValues,
      setRunValues,
      startNew,
      switchToTemp,
      loadSaved,
    ],
  )
}

export type UseSavedSqlSelectionReturn = ReturnType<typeof useSavedSqlSelection>
