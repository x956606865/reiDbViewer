import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'

export type PaginationState = {
  enabled: boolean
  page: number
  pageSize: number
  totalRows: number | null
  totalPages: number | null
  countLoaded: boolean
}

type UsePaginationStateOptions = {
  storageKey: string
  defaultPageSize: number
}

export const coercePositiveInteger = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback

export const readStoredPageSize = (key: string, fallback: number): number => {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = Number(raw)
    return coercePositiveInteger(parsed, fallback)
  } catch {
    return fallback
  }
}

export const persistPageSize = (key: string, value: number) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // ignore persistence errors (quota / denied)
  }
}

type PaginationControls = PaginationState & {
  setEnabled: Dispatch<SetStateAction<boolean>>
  setPage: Dispatch<SetStateAction<number>>
  setPageSize: Dispatch<SetStateAction<number>>
  setTotalRows: Dispatch<SetStateAction<number | null>>
  setTotalPages: Dispatch<SetStateAction<number | null>>
  setCountLoaded: Dispatch<SetStateAction<boolean>>
  reset: () => void
}

export const usePaginationState = ({
  storageKey,
  defaultPageSize,
}: UsePaginationStateOptions): PaginationControls => {
  const [enabled, setEnabled] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSizeState] = useState<number>(() =>
    readStoredPageSize(storageKey, defaultPageSize),
  )
  const [totalRows, setTotalRows] = useState<number | null>(null)
  const [totalPages, setTotalPages] = useState<number | null>(null)
  const [countLoaded, setCountLoaded] = useState(false)

  const setPageSize = useCallback<Dispatch<SetStateAction<number>>>(
    (update) => {
      setPageSizeState((prev) => {
        const next =
          typeof update === 'function'
            ? (update as (prev: number) => number)(prev)
            : update
        const normalized = coercePositiveInteger(next, defaultPageSize)
        persistPageSize(storageKey, normalized)
        return normalized
      })
    },
    [defaultPageSize, storageKey],
  )

  const reset = useCallback(() => {
    setPage(1)
    setTotalRows(null)
    setTotalPages(null)
    setCountLoaded(false)
  }, [])

  return useMemo(
    () => ({
      enabled,
      setEnabled,
      page,
      setPage,
      pageSize,
      setPageSize,
      totalRows,
      setTotalRows,
      totalPages,
      setTotalPages,
      countLoaded,
      setCountLoaded,
      reset,
    }),
    [
      enabled,
      page,
      pageSize,
      totalRows,
      totalPages,
      countLoaded,
      setEnabled,
      setPage,
      setPageSize,
      setTotalRows,
      setTotalPages,
      setCountLoaded,
      reset,
    ],
  )
}

export type UsePaginationStateReturn = ReturnType<typeof usePaginationState>
