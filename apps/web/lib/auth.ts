import { betterAuth } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import { Pool } from 'pg'
import { env } from './env'

function parseSslFromUrl(cs: string | undefined): boolean | { rejectUnauthorized: boolean } | undefined {
  if (!cs) return undefined
  try {
    const u = new URL(cs)
    const mode = (u.searchParams.get('sslmode') || '').toLowerCase()
    if (!mode) return undefined
    if (mode === 'disable') return false
    if (mode === 'require') return true
    if (mode === 'no-verify' || mode === 'allow' || mode === 'prefer') return { rejectUnauthorized: false }
    if (mode === 'verify-ca' || mode === 'verify-full') return { rejectUnauthorized: true }
    return true
  } catch {
    return undefined
  }
}

const pool = process.env.APP_DB_URL
  ? new Pool({ connectionString: process.env.APP_DB_URL, ssl: parseSslFromUrl(process.env.APP_DB_URL) })
  : undefined

const prefix = env.APP_DB_TABLE_PREFIX || ''
const schema = env.APP_DB_SCHEMA || 'public'

// Ensure better-auth uses the configured schema when it generates unqualified table names
if (pool) {
  const quoted = '"' + schema.replace(/"/g, '""') + '"'
  pool.on('connect', (client: any) => {
    client.query(`SET search_path = pg_catalog, ${quoted}`).catch(() => {})
  })
}

export const auth = betterAuth({
  // Base URL and CORS/trust for Better Auth
  // Prefer explicit BETTER_AUTH_URL; fall back to common local dev origins
  baseURL: process.env.BETTER_AUTH_URL || undefined,
  trustedOrigins: [
    (process.env.BETTER_AUTH_URL || '').replace(/\/$/, ''),
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ].filter(Boolean) as string[],
  // 指向应用数据库（仅在配置时启用）
  // better-auth 将使用现有表；我们不在应用内执行迁移
  ...(pool
    ? {
        database: pool,
      }
    : {}),
  emailAndPassword: {
    enabled: true,
  },
  // 自定义表名与字段名（带前缀 + 下划线命名）
  user: {
    modelName: `${prefix}users`,
    fields: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      emailVerified: 'email_verified',
    },
    schema,
  },
  account: {
    modelName: `${prefix}accounts`,
    fields: {
      userId: 'user_id',
      accountId: 'account_id',
      providerId: 'provider_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      scope: 'scope',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    // keep default column name 'password' for hashed password
    schema,
  },
  session: {
    modelName: `${prefix}sessions`,
    fields: {
      userId: 'user_id',
      createdAt: 'created_at',
      expiresAt: 'expires_at',
      token: 'token',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      updatedAt: 'updated_at',
    },
    schema,
  },
  verification: {
    modelName: `${prefix}verification_codes`,
    fields: {
      userId: 'user_id',
      createdAt: 'created_at',
      expiresAt: 'expires_at',
    },
    schema,
  },
  plugins: [nextCookies()],
})
