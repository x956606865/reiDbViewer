import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'

export type QueryResultState = {
  previewSQL: string
  rows: Array<Record<string, unknown>>
  gridCols: string[]
  textResult: string | null
  isPreviewing: boolean
}

type UseQueryResultStateReturn = QueryResultState & {
  setPreviewSQL: Dispatch<SetStateAction<string>>
  setRows: Dispatch<SetStateAction<Array<Record<string, unknown>>>>
  setGridCols: Dispatch<SetStateAction<string[]>>
  setTextResult: Dispatch<SetStateAction<string | null>>
  setIsPreviewing: Dispatch<SetStateAction<boolean>>
  reset: () => void
}

export const useQueryResultState = (): UseQueryResultStateReturn => {
  const [previewSQL, setPreviewSQL] = useState('')
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [gridCols, setGridCols] = useState<string[]>([])
  const [textResult, setTextResult] = useState<string | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)

  const reset = useCallback(() => {
    setPreviewSQL('')
    setRows([])
    setGridCols([])
    setTextResult(null)
    setIsPreviewing(false)
  }, [])

  return useMemo(
    () => ({
      previewSQL,
      setPreviewSQL,
      rows,
      setRows,
      gridCols,
      setGridCols,
      textResult,
      setTextResult,
      isPreviewing,
      setIsPreviewing,
      reset,
    }),
    [
      previewSQL,
      rows,
      gridCols,
      textResult,
      isPreviewing,
      setPreviewSQL,
      setRows,
      setGridCols,
      setTextResult,
      setIsPreviewing,
      reset,
    ],
  )
}

export type UseQueryResultStateReturn = ReturnType<typeof useQueryResultState>
