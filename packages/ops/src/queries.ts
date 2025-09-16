import { z } from 'zod'

export const OpsActionId = z.enum([
  'long_running_activity',
  'blocking_activity',
  'long_transactions',
  'waiting_locks',
  'connections_overview',
])

export type OpsActionId = z.infer<typeof OpsActionId>

export const LongRunningParams = z.object({
  minMinutes: z.number().int().min(1).max(7 * 24 * 60).default(5),
  limit: z.number().int().min(1).max(1000).default(200),
  notIdle: z.boolean().default(true),
})

export type LongRunningParams = z.infer<typeof LongRunningParams>

export function buildOpsQuery(actionId: OpsActionId, params?: unknown): { text: string; values: any[] } {
  switch (actionId) {
    case 'long_running_activity': {
      const p = LongRunningParams.parse(params ?? {})
      const values: any[] = [p.minMinutes, p.limit]
      const whereNotIdle = p.notIdle ? "state <> 'idle'" : 'TRUE'
      const text = `
SELECT
  pid,
  usename,
  application_name,
  client_addr,
  state,
  wait_event_type,
  wait_event,
  backend_type,
  (now() - query_start)::text AS run_for,
  LEFT(query, 2000) AS query
FROM pg_catalog.pg_stat_activity
WHERE ${whereNotIdle}
  AND pid <> pg_backend_pid()
  AND (now() - query_start) > (interval '1 minute' * $1)
ORDER BY run_for DESC
LIMIT $2`
      return { text, values }
    }
    case 'blocking_activity': {
      const p = LongRunningParams.parse(params ?? {})
      const values: any[] = [p.minMinutes, p.limit]
      const text = `
SELECT
  a.pid               AS blocked_pid,
  a.usename           AS blocked_user,
  a.application_name  AS blocked_app,
  a.client_addr       AS blocked_client,
  (now() - a.query_start)::text AS blocked_for,
  a.state             AS blocked_state,
  LEFT(a.query, 2000) AS blocked_query,
  b.pid               AS blocking_pid,
  b.usename           AS blocking_user,
  b.application_name  AS blocking_app,
  (now() - b.query_start)::text AS blocking_for,
  b.state             AS blocking_state,
  LEFT(b.query, 2000) AS blocking_query
FROM pg_catalog.pg_stat_activity a
JOIN LATERAL unnest(pg_catalog.pg_blocking_pids(a.pid)) AS bp(blocking_pid) ON TRUE
JOIN pg_catalog.pg_stat_activity b ON b.pid = bp.blocking_pid
WHERE a.pid <> pg_backend_pid()
  AND (now() - a.query_start) > (interval '1 minute' * $1)
ORDER BY blocked_for DESC
LIMIT $2`
      return { text, values }
    }
    case 'long_transactions': {
      const p = LongRunningParams.parse(params ?? {})
      const values: any[] = [p.minMinutes, p.limit]
      const text = `
SELECT
  pid,
  usename,
  application_name,
  client_addr,
  state,
  (now() - xact_start)::text AS xact_for,
  (now() - query_start)::text AS run_for,
  LEFT(query, 2000) AS query
FROM pg_catalog.pg_stat_activity
WHERE xact_start IS NOT NULL
  AND pid <> pg_backend_pid()
  AND (now() - xact_start) > (interval '1 minute' * $1)
ORDER BY xact_for DESC
LIMIT $2`
      return { text, values }
    }
    case 'waiting_locks': {
      const Schema = z.object({ limit: z.number().int().min(1).max(1000).default(200) })
      const p = Schema.parse(params ?? {})
      const values: any[] = [p.limit]
      const text = `
SELECT
  l.locktype,
  l.mode,
  l.pid,
  l.relation,
  n.nspname AS schema,
  c.relname AS relation_name,
  a.usename,
  a.application_name,
  a.state,
  (now() - a.query_start)::text AS run_for,
  LEFT(a.query, 2000) AS query
FROM pg_catalog.pg_locks l
LEFT JOIN pg_catalog.pg_stat_activity a ON a.pid = l.pid
LEFT JOIN pg_catalog.pg_class c ON c.oid = l.relation
LEFT JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE l.granted = FALSE
ORDER BY run_for DESC NULLS LAST
LIMIT $1`
      return { text, values }
    }
    case 'connections_overview': {
      const Schema = z.object({ limit: z.number().int().min(1).max(1000).default(200) })
      const p = Schema.parse(params ?? {})
      const values: any[] = [p.limit]
      const text = `
SELECT
  a.usename,
  a.application_name,
  COUNT(*) AS sessions,
  SUM(CASE WHEN a.state = 'active' THEN 1 ELSE 0 END) AS active,
  SUM(CASE WHEN a.state = 'idle' THEN 1 ELSE 0 END) AS idle,
  SUM(CASE WHEN a.state = 'idle in transaction' THEN 1 ELSE 0 END) AS idle_in_xact
FROM pg_catalog.pg_stat_activity a
GROUP BY a.usename, a.application_name
ORDER BY sessions DESC, active DESC
LIMIT $1`
      return { text, values }
    }
    default: {
      const _exhaustive: never = actionId
      throw new Error(`Unknown ops action: ${_exhaustive as any}`)
    }
  }
}
