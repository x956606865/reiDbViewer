import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

export type LoadColumnWidths = (id: string) => Promise<Record<string, number>>

export const useSavedSqlColumnWidths = (
  currentId: string | null,
  loader: LoadColumnWidths,
): {
  widths: Record<string, number>
  setWidths: Dispatch<SetStateAction<Record<string, number>>>
} => {
  const [widths, setWidths] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!currentId) {
      setWidths({})
      return
    }
    let cancelled = false
    loader(currentId)
      .then((map) => {
        if (!cancelled) setWidths(map)
      })
      .catch(() => {
        if (!cancelled) setWidths({})
      })
    return () => {
      cancelled = true
    }
  }, [currentId, loader])

  return { widths, setWidths }
}

export type UseSavedSqlColumnWidthsReturn = ReturnType<typeof useSavedSqlColumnWidths>
