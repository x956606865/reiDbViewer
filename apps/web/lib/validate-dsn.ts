import { URL } from 'url'

// Private/local hosts are allowed now; keep list for potential future heuristics
const PRIVATE_IP_PATTERNS: RegExp[] = []

export type DsnCheck = { ok: boolean; reason?: string }

export function validatePostgresDsn(dsn: string): DsnCheck {
  try {
    const u = new URL(dsn)
    if (!/^postgres(ql)?:$/.test(u.protocol)) return { ok: false, reason: 'protocol_must_be_postgres' }
    const host = u.hostname
    if (!host) return { ok: false, reason: 'host_required' }
    const port = Number(u.port || 5432)
    if (!(port > 0 && port < 65536)) return { ok: false, reason: 'invalid_port' }
    // 默认要求 TLS；若显式声明 sslmode=disable 则拒绝（可根据需要放宽）
    // TLS 推荐但非强制；若 sslmode=disable 也允许。
    return { ok: true }
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }
}
