export type DsnCheck = { ok: boolean; reason?: string }

export function validatePostgresDsn(dsn: string): DsnCheck {
  try {
    const u = new URL(dsn)
    if (!/^postgres(ql)?:$/.test(u.protocol)) return { ok: false, reason: 'protocol_must_be_postgres' }
    const host = u.hostname
    if (!host) return { ok: false, reason: 'host_required' }
    const port = Number(u.port || 5432)
    if (!(port > 0 && port < 65536)) return { ok: false, reason: 'invalid_port' }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }
}
