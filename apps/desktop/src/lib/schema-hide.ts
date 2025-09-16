// Desktop copy of web hook for managing schema/table hide rules per connection
import { useEffect, useMemo, useState } from 'react'

export type SchemaHideRules = { prefixes: string[]; tables: string[] }

const EVENT = 'rdv:schema-hide-changed'

function keyFor(userConnId: string | null) {
  return `rdv.schema.hide.${userConnId || 'default'}`
}

function normalizeRules(r: any | null | undefined): SchemaHideRules {
  const prefixes = Array.isArray(r?.prefixes) ? r.prefixes.filter((s: any) => typeof s === 'string' && s.trim()) : []
  const tables = Array.isArray(r?.tables) ? r.tables.filter((s: any) => typeof s === 'string' && s.includes('.')) : []
  return { prefixes, tables }
}

export function readRules(userConnId: string | null): SchemaHideRules {
  if (typeof window === 'undefined') return { prefixes: [], tables: [] }
  try {
    const raw = localStorage.getItem(keyFor(userConnId))
    return normalizeRules(raw ? JSON.parse(raw) : null)
  } catch {
    return { prefixes: [], tables: [] }
  }
}

export function writeRules(userConnId: string | null, rules: SchemaHideRules) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(keyFor(userConnId), JSON.stringify(rules)) } catch {}
  try {
    const evt = new CustomEvent(EVENT, { detail: { userConnId } })
    window.dispatchEvent(evt)
  } catch {}
}

export function useSchemaHide(userConnId: string | null) {
  const [rules, setRules] = useState<SchemaHideRules>(() => readRules(userConnId))

  useEffect(() => {
    setRules(readRules(userConnId))
  }, [userConnId])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === keyFor(userConnId)) setRules(readRules(userConnId))
    }
    const onEvt = (e: Event) => {
      const u = (e as CustomEvent).detail?.userConnId ?? null
      if (u === userConnId) setRules(readRules(userConnId))
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(EVENT, onEvt)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(EVENT, onEvt)
    }
  }, [userConnId])

  const api = useMemo(() => ({
    addPrefix: (p: string) => {
      const v = (p || '').trim()
      if (!v) return
      const next = { ...rules, prefixes: Array.from(new Set([...(rules.prefixes || []), v])) }
      setRules(next); writeRules(userConnId, next)
    },
    removePrefix: (p: string) => {
      const next = { ...rules, prefixes: (rules.prefixes || []).filter((x) => x !== p) }
      setRules(next); writeRules(userConnId, next)
    },
    addTable: (fq: string) => {
      if (!fq.includes('.')) return
      const next = { ...rules, tables: Array.from(new Set([...(rules.tables || []), fq])) }
      setRules(next); writeRules(userConnId, next)
    },
    removeTable: (fq: string) => {
      const next = { ...rules, tables: (rules.tables || []).filter((x) => x !== fq) }
      setRules(next); writeRules(userConnId, next)
    },
    clear: () => { const next = { prefixes: [], tables: [] }; setRules(next); writeRules(userConnId, next) },
  }), [rules, userConnId])

  return { rules, ...api }
}

