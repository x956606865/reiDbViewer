const toInt = (v: string | undefined, def: number) => {
  const n = v ? Number.parseInt(v, 10) : NaN
  return Number.isFinite(n) ? n : def
}

export const env = {
  QUERY_TIMEOUT_DEFAULT_MS: toInt(process.env.QUERY_TIMEOUT_DEFAULT_MS, 5000),
  QUERY_TIMEOUT_MAX_MS: toInt(process.env.QUERY_TIMEOUT_MAX_MS, 10000),
  MAX_ROW_LIMIT: toInt(process.env.MAX_ROW_LIMIT, 1000),
  APP_DB_SCHEMA: process.env.APP_DB_SCHEMA || 'public',
  APP_DB_TABLE_PREFIX: process.env.APP_DB_TABLE_PREFIX || 'rdv_',
}
