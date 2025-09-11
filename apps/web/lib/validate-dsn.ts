import { URL } from 'url'

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^::1$/,
]

export type DsnCheck = { ok: boolean; reason?: string }

export function validatePostgresDsn(dsn: string): DsnCheck {
  try {
    const u = new URL(dsn)
    if (!/^postgres(ql)?:$/.test(u.protocol)) return { ok: false, reason: 'protocol_must_be_postgres' }
    const host = u.hostname
    if (!host) return { ok: false, reason: 'host_required' }
    if (PRIVATE_IP_PATTERNS.some((re) => re.test(host))) return { ok: false, reason: 'host_not_allowed_private' }
    const port = Number(u.port || 5432)
    if (!(port > 0 && port < 65536)) return { ok: false, reason: 'invalid_port' }
    // 默认要求 TLS；若显式声明 sslmode=disable 则拒绝（可根据需要放宽）
    const params = u.searchParams
    const sslmode = params.get('sslmode') || 'require'
    if (sslmode === 'disable') return { ok: false, reason: 'tls_required' }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }
}

