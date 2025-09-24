import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export type PersistentSetInitializer<T> =
  | Iterable<T>
  | Set<T>
  | (() => Iterable<T> | Set<T>)

function toSet<T>(value: Iterable<T> | Set<T> | undefined | null): Set<T> {
  if (value instanceof Set) return new Set(value)
  if (!value) return new Set<T>()
  return new Set(value)
}

function safeGetLocalStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    const storage = window.localStorage
    if (!storage) return null
    return storage
  } catch {
    return null
  }
}

export function loadStoredSet<T>(
  storage: StorageLike | null,
  key: string,
): Set<T> | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return new Set(parsed as T[])
  } catch {
    return null
  }
}

export function persistStoredSet<T>(
  storage: StorageLike | null,
  key: string,
  value: Set<T>,
): void {
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify(Array.from(value)))
  } catch {
    // ignore quota or serialization failures to keep UI responsive
  }
}

export function resolvePersistentSetInitializer<T>(
  initial: PersistentSetInitializer<T>,
): Set<T> {
  const value = typeof initial === 'function' ? initial() : initial
  return toSet(value as Iterable<T> | Set<T> | undefined | null)
}

export function usePersistentSet<T>(
  key: string,
  initial: PersistentSetInitializer<T>,
): [Set<T>, Dispatch<SetStateAction<Set<T>>>] {
  const [value, setValue] = useState<Set<T>>(() => {
    const storage = safeGetLocalStorage()
    const stored = loadStoredSet<T>(storage, key)
    if (stored) return stored
    return resolvePersistentSetInitializer(initial)
  })

  const storageRef = useRef<StorageLike | null>(null)

  useEffect(() => {
    storageRef.current = safeGetLocalStorage()
  }, [])

  useEffect(() => {
    const storage = storageRef.current ?? safeGetLocalStorage()
    storageRef.current = storage
    persistStoredSet(storage, key, value)
  }, [key, value])

  const update = useCallback<Dispatch<SetStateAction<Set<T>>>>(
    (next) => {
      if (typeof next === 'function') {
        setValue((prev) => toSet((next as (prev: Set<T>) => Set<T>)(prev)))
      } else {
        setValue(toSet(next))
      }
    },
    [],
  )

  return [value, update]
}
