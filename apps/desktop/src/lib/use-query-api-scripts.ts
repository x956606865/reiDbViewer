import { useCallback, useEffect, useState } from 'react'
import {
  createScript,
  deleteScript,
  getScriptById,
  listScriptsForQuery,
  updateScript,
  type QueryApiScriptInput,
  type QueryApiScriptSummary,
} from '../services/queryApiScripts'
import {
  cloneScriptForm,
  createEmptyScriptForm,
  scriptRecordToForm,
  type QueryApiScriptFormState,
} from './query-api-script-form'

export type ScriptEditorMode = 'create' | 'edit' | 'duplicate'

type EditorState = {
  mode: ScriptEditorMode
  form: QueryApiScriptFormState
}

export type UseQueryApiScriptsResult = {
  scripts: QueryApiScriptSummary[]
  loading: boolean
  loadError: string | null
  selectedId: string | null
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>
  refresh: () => Promise<void>
  openCreate: () => void
  openEdit: (id: string) => Promise<void>
  openDuplicate: (id: string) => Promise<void>
  editorOpen: boolean
  editorMode: ScriptEditorMode | null
  editorForm: QueryApiScriptFormState | null
  setEditorForm: React.Dispatch<React.SetStateAction<QueryApiScriptFormState>>
  closeEditor: () => void
  saveEditor: (input: QueryApiScriptInput) => Promise<boolean>
  deleteById: (id: string) => Promise<boolean>
  saving: boolean
  deleting: boolean
  submitError: string | null
  setSubmitError: React.Dispatch<React.SetStateAction<string | null>>
}

const normalizeErrorMessage = (err: unknown): string => {
  if (!err) return '操作失败'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message || '操作失败'
  const code = (err as any)?.code
  if (typeof code === 'string') return code
  return '操作失败'
}

export function useQueryApiScripts(queryId: string | null | undefined): UseQueryApiScriptsResult {
  const [scripts, setScripts] = useState<QueryApiScriptSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editorState, setEditorState] = useState<EditorState | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!queryId) {
      setScripts([])
      setSelectedId(null)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const list = await listScriptsForQuery(queryId)
      setScripts(list)
      setSelectedId((prev) => {
        if (!prev) return null
        return list.some((item) => item.id === prev) ? prev : null
      })
    } catch (err) {
      setLoadError(normalizeErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [queryId])

  useEffect(() => {
    setEditorState(null)
    setSubmitError(null)
    setSelectedId(null)
    if (!queryId) {
      setScripts([])
      return
    }
    void refresh()
  }, [queryId, refresh])

  const setEditorForm = useCallback(
    (updater: React.SetStateAction<QueryApiScriptFormState>) => {
      setEditorState((prev) => {
        if (!prev) return prev
        const nextForm =
          typeof updater === 'function'
            ? (updater as (form: QueryApiScriptFormState) => QueryApiScriptFormState)(prev.form)
            : updater
        return {
          ...prev,
          form: nextForm,
        }
      })
    },
    [],
  )

  const openCreate = useCallback(() => {
    if (!queryId) {
      setSubmitError('请先选择或保存查询，再配置脚本。')
      return
    }
    setSubmitError(null)
    setEditorState({
      mode: 'create',
      form: createEmptyScriptForm({ queryId }),
    })
  }, [queryId])

  const openEdit = useCallback(
    async (id: string) => {
      if (!id) return
      try {
        const record = await getScriptById(id)
        if (!record) {
          setSubmitError('未找到脚本记录')
          return
        }
        setSubmitError(null)
        setEditorState({ mode: 'edit', form: scriptRecordToForm(record) })
      } catch (err) {
        setSubmitError(normalizeErrorMessage(err))
      }
    },
    [],
  )

  const openDuplicate = useCallback(
    async (id: string) => {
      if (!id) return
      try {
        const record = await getScriptById(id)
        if (!record) {
          setSubmitError('未找到脚本记录')
          return
        }
        const base = scriptRecordToForm(record)
        const duplicated = cloneScriptForm(base, {
          id: undefined,
          name: `${base.name} 副本`,
          queryId: queryId ?? base.queryId,
        })
        setSubmitError(null)
        setEditorState({ mode: 'duplicate', form: duplicated })
      } catch (err) {
        setSubmitError(normalizeErrorMessage(err))
      }
    },
    [queryId],
  )

  const closeEditor = useCallback(() => {
    setEditorState(null)
    setSubmitError(null)
  }, [])

  const saveEditor = useCallback(
    async (input: QueryApiScriptInput): Promise<boolean> => {
      if (!editorState) return false
      const targetQueryId = queryId ?? input.queryId
      if (!targetQueryId) {
        setSubmitError('缺少查询上下文，无法保存脚本。')
        return false
      }
      setSaving(true)
      setSubmitError(null)
      try {
        if (editorState.mode === 'edit') {
          if (!input.id) {
            setSubmitError('缺少脚本 ID')
            return false
          }
          await updateScript(input.id, { ...input, queryId: targetQueryId })
          await refresh()
          setSelectedId(input.id)
        } else {
          const payload = { ...input, id: undefined, queryId: targetQueryId }
          const { id } = await createScript(payload)
          await refresh()
          setSelectedId(id)
        }
        setEditorState(null)
        return true
      } catch (err) {
        const code = (err as any)?.code
        if (code === 'script_name_exists') {
          setSubmitError('同一查询下已存在同名脚本，请调整名称。')
        } else {
          setSubmitError(normalizeErrorMessage(err))
        }
        return false
      } finally {
        setSaving(false)
      }
    },
    [editorState, queryId, refresh],
  )

  const deleteById = useCallback(
    async (id: string): Promise<boolean> => {
      if (!id) return false
      setDeleting(true)
      setSubmitError(null)
      try {
        await deleteScript(id)
        await refresh()
        setSelectedId((prev) => (prev === id ? null : prev))
        setEditorState((prev) => (prev && prev.form.id === id ? null : prev))
        return true
      } catch (err) {
        setSubmitError(normalizeErrorMessage(err))
        return false
      } finally {
        setDeleting(false)
      }
    },
    [refresh],
  )

  return {
    scripts,
    loading,
    loadError,
    selectedId,
    setSelectedId,
    refresh,
    openCreate,
    openEdit,
    openDuplicate,
    editorOpen: !!editorState,
    editorMode: editorState?.mode ?? null,
    editorForm: editorState?.form ?? null,
    setEditorForm,
    closeEditor,
    saveEditor,
    deleteById,
    saving,
    deleting,
    submitError,
    setSubmitError,
  }
}
