const toInt = (v: string | undefined, def: number) => {
  const n = v ? Number.parseInt(v, 10) : NaN
  return Number.isFinite(n) ? n : def
}

export const env = {
  QUERY_TIMEOUT_DEFAULT_MS: toInt(import.meta.env?.VITE_QUERY_TIMEOUT_DEFAULT_MS, 5000),
  QUERY_TIMEOUT_MAX_MS: toInt(import.meta.env?.VITE_QUERY_TIMEOUT_MAX_MS, 10000),
  SCHEMA_REFRESH_TIMEOUT_MS: toInt(import.meta.env?.VITE_SCHEMA_REFRESH_TIMEOUT_MS, 30000),
  MAX_ROW_LIMIT: toInt(import.meta.env?.VITE_MAX_ROW_LIMIT, 1000),
}
