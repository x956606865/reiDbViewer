import { Pool } from 'pg'
import { env } from './env'

export type InitStatus = {
  configured: boolean
  schema: string
  prefix: string
  schemaExists: boolean
  initialized: boolean
  existingTables: string[]
  expectedTables: string[]
  warnings: string[]
  suggestedSQL: string
}

function expectedTableNames(prefix: string) {
  // Email+Password: users(with password_hash), sessions, verification_codes
  return [
    `${prefix}users`,
    `${prefix}accounts`,
    `${prefix}sessions`,
    `${prefix}verification_codes`,
    `${prefix}user_connections`,
    `${prefix}schema_cache`,
  ]
}

export function renderInitSql(schema: string, prefix: string): string {
  const q = (s: string) => '"' + s.replace(/"/g, '""') + '"'
  const s = q(schema)
  const t = (name: string) => `${s}.${q(prefix + name)}`
  return [
    `-- Create schema if missing`,
    `CREATE SCHEMA IF NOT EXISTS ${s};`,
    `-- Core tables`,
    `CREATE TABLE IF NOT EXISTS ${t('users')} (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`,
    `-- Accounts (providers + password storage)
CREATE TABLE IF NOT EXISTS ${t('accounts')} (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES ${t('users')}(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  scope TEXT,
  password TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`,
    `CREATE TABLE IF NOT EXISTS ${t('user_connections')} (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES ${t('users')}(id) ON DELETE CASCADE,
  alias TEXT NOT NULL CHECK (length(alias) BETWEEN 1 AND 50),
  dsn_cipher TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  UNIQUE(user_id, alias)
);`,
    `-- Cached schema & DDLs per user-connection
CREATE TABLE IF NOT EXISTS ${t('schema_cache')} (
  user_id TEXT NOT NULL REFERENCES ${t('users')}(id) ON DELETE CASCADE,
  user_conn_id TEXT NOT NULL REFERENCES ${t('user_connections')}(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, user_conn_id)
);`,
    `-- Session storage (Better Auth: email/password)
CREATE TABLE IF NOT EXISTS ${t('sessions')} (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES ${t('users')}(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  UNIQUE(id)
);`,
    `-- Verification codes (email verification, password reset)
CREATE TABLE IF NOT EXISTS ${t('verification_codes')} (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES ${t('users')}(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);`,
  ].join('\n')
}

export async function checkInitStatus(appPool: Pool, schema?: string, prefix?: string): Promise<InitStatus> {
  const sch = schema || env.APP_DB_SCHEMA || 'public'
  const pfx = prefix ?? env.APP_DB_TABLE_PREFIX ?? 'rdv_'
  const warnings: string[] = []
  const q = (s: string) => '"' + s.replace(/"/g, '""') + '"'
  const resSchema = await appPool.query('SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS exists', [sch])
  const schemaExists = Boolean(resSchema.rows[0]?.exists)
  let existingTables: string[] = []
  if (schemaExists) {
    const resTables = await appPool.query(
      'SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename',
      [sch]
    )
    existingTables = resTables.rows.map((r: any) => String(r.tablename))
  }
  const exp = expectedTableNames(pfx)
  const hasAllExpected = exp.every((t) => existingTables.includes(t))
  const nonAppTables = existingTables.filter((t) => !exp.includes(t))
  if (nonAppTables.length > 0) warnings.push(`Schema ${sch} 非空，其他表：` + nonAppTables.slice(0, 10).join(', '))

  return {
    configured: true,
    schema: sch,
    prefix: pfx,
    schemaExists,
    initialized: schemaExists && hasAllExpected,
    existingTables,
    expectedTables: exp,
    warnings,
    suggestedSQL: renderInitSql(sch, pfx),
  }
}
