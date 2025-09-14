"use client"

import { useEffect, useState } from 'react'

export const CURRENT_CONN_KEY = 'rdv.currentUserConnId'
export const CHANGE_EVENT = 'rdv:current-conn-changed'

export function getCurrentConnId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(CURRENT_CONN_KEY)
  } catch {
    return null
  }
}

export function setCurrentConnId(id: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (id) localStorage.setItem(CURRENT_CONN_KEY, id)
    else localStorage.removeItem(CURRENT_CONN_KEY)
  } catch {}
  try {
    const evt = new CustomEvent(CHANGE_EVENT, { detail: id })
    window.dispatchEvent(evt)
  } catch {}
}

export function subscribeCurrentConnId(cb: (id: string | null) => void) {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key === CURRENT_CONN_KEY) cb(e.newValue)
  }
  const onCustom = (e: Event) => {
    const ce = e as CustomEvent<string | null>
    cb(ce.detail ?? getCurrentConnId())
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, onCustom as EventListener)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, onCustom as EventListener)
  }
}

export function useCurrentConnId(): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(() => getCurrentConnId())
  useEffect(() => {
    setId(getCurrentConnId())
    const unsub = subscribeCurrentConnId((next) => setId(next))
    return unsub
  }, [])
  const setter = (next: string | null) => {
    setId(next)
    setCurrentConnId(next)
  }
  return [id, setter]
}

