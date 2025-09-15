// Plan A: Frontend read-only DB client over @tauri-apps/plugin-sql
// Only allows SELECT/WITH queries; enforces MAX_ROW_LIMIT.

import Database from '@tauri-apps/plugin-sql'
import { env } from '@/lib/env'

export type QueryResultRow = Record<string, unknown>

const READ_ONLY_PREFIXES = [/^\s*select\b/i, /^\s*with\b/i]

function isReadOnlySelect(sql: string) {
  return READ_ONLY_PREFIXES.some((r) => r.test(sql))
}

function enforceLimit(sql: string): string {
  // naive check; we will append a LIMIT if not present. Later: parse AST.
  const hasLimit = /\blimit\s+\d+/i.test(sql)
  if (hasLimit) return sql
  return `${sql.trim()}\nLIMIT ${env.MAX_ROW_LIMIT}`
}

export class ReadonlyDb {
  private constructor(private readonly db: any) {}

  static async openSqlite(path = 'rdv_local.db') {
    const db = await Database.load(`sqlite:${path}`)
    return new ReadonlyDb(db)
  }

  static async openPostgres(dsn: string) {
    const db = await Database.load(dsn)
    return new ReadonlyDb(db)
  }

  async select<T = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!isReadOnlySelect(sql)) throw new Error('Only SELECT/WITH statements are allowed')
    const limited = enforceLimit(sql)
    // We cannot guarantee SET LOCAL here; PG timeouts should be configured via DSN or server side.
    // For now we rely on LIMIT and read-only syntax guard.
    // @ts-ignore: plugin provides select method at runtime
    const rows = await this.db.select<T[]>(limited, params)
    return rows
  }
}

