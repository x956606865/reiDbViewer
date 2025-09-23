import { useMemo } from 'react'
import type {
  SavedQueryVariableDef,
  DynamicColumnDef,
  CalcItemDef,
} from '@rei-db-view/types/appdb'

const JSON_HEADERS = { 'content-type': 'application/json' } as const

export type FetchLike = (input: RequestInfo, init?: RequestInit) => Promise<Response>

export type SavedQueriesApiErrorType =
  | 'not_initialized'
  | 'conflict'
  | 'validation'
  | 'not_found'
  | 'unauthorized'
  | 'app_db_not_configured'
  | 'network'
  | 'unknown'

export interface SavedQueriesApiErrorInit {
  type: SavedQueriesApiErrorType
  message: string
  status?: number
  suggestedSQL?: string
  existingId?: string
  detail?: unknown
  missing?: string[]
  cause?: unknown
}

export class SavedQueriesApiError extends Error {
  readonly type: SavedQueriesApiErrorType
  readonly status?: number
  readonly suggestedSQL?: string
  readonly existingId?: string
  readonly detail?: unknown
  readonly missing?: string[]

  constructor(init: SavedQueriesApiErrorInit) {
    super(init.message, init.cause ? { cause: init.cause } : undefined)
    this.name = 'SavedQueriesApiError'
    this.type = init.type
    this.status = init.status
    this.suggestedSQL = init.suggestedSQL
    this.existingId = init.existingId
    this.detail = init.detail
    this.missing = init.missing
  }
}

export const isSavedQueriesApiError = (err: unknown): err is SavedQueriesApiError =>
  err instanceof SavedQueriesApiError

export interface SavedQueryListItem {
  id: string
  name: string
  description: string | null
  variables: SavedQueryVariableDef[]
  dynamicColumns: DynamicColumnDef[]
  calcItems: CalcItemDef[]
  createdAt: string | null
  updatedAt: string | null
}

export interface SavedQueryDetail extends SavedQueryListItem {
  sql: string
  isArchived: boolean
}

export interface SavedQueryCreateInput {
  name: string
  description?: string | null
  sql: string
  variables: SavedQueryVariableDef[]
  dynamicColumns?: DynamicColumnDef[]
  calcItems?: CalcItemDef[]
}

export interface SavedQueryUpdateInput {
  name?: string
  description?: string | null
  sql?: string
  variables?: SavedQueryVariableDef[]
  dynamicColumns?: DynamicColumnDef[]
  calcItems?: CalcItemDef[]
  isArchived?: boolean
}

interface ListResponse {
  items?: Array<{
    id?: unknown
    name?: unknown
    description?: unknown
    variables?: unknown
    dynamicColumns?: unknown
    dynamic_columns?: unknown
    calcItems?: unknown
    calc_items?: unknown
    createdAt?: unknown
    created_at?: unknown
    updatedAt?: unknown
    updated_at?: unknown
  }>
  suggestedSQL?: string
}

interface DetailResponse extends ListResponse {
  sql?: unknown
  isArchived?: unknown
  is_archived?: unknown
}

interface CreateResponse {
  id?: unknown
}

interface UpdateResponse {
  ok?: unknown
}

const DEFAULT_MESSAGES: Record<SavedQueriesApiErrorType, string> = {
  not_initialized: '功能未初始化：请先在 APP_DB 执行建表/ALTER SQL 后重试。',
  conflict: '存在同名的已保存查询。',
  validation: '请求参数不符合要求，请检查后重试。',
  not_found: '指定的已保存查询不存在。',
  unauthorized: '登录状态已过期，请重新登录。',
  app_db_not_configured: '应用未配置 APP_DB_URL，无法读取已保存查询。',
  network: '网络异常，请稍后重试。',
  unknown: '请求失败，请稍后重试。',
}

const toStringOrNull = (value: unknown): string | null => {
  if (value == null) return null
  return String(value)
}

const toIsoString = (value: unknown): string | null => {
  if (!value) return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

function normalizeSummary(json: ListResponse['items'][number]): SavedQueryListItem {
  return {
    id: String(json?.id ?? ''),
    name: String(json?.name ?? ''),
    description: toStringOrNull(json?.description),
    variables: asArray<SavedQueryVariableDef>(
      json?.variables ?? (json as any)?.variables
    ),
    dynamicColumns: asArray<DynamicColumnDef>(
      json?.dynamicColumns ?? (json as any)?.dynamic_columns
    ),
    calcItems: asArray<CalcItemDef>(json?.calcItems ?? (json as any)?.calc_items),
    createdAt:
      toIsoString(json?.createdAt ?? (json as any)?.created_at) ?? null,
    updatedAt:
      toIsoString(json?.updatedAt ?? (json as any)?.updated_at) ?? null,
  }
}

function normalizeDetail(json: DetailResponse): SavedQueryDetail {
  const summary = normalizeSummary(json)
  return {
    ...summary,
    sql: String(json?.sql ?? ''),
    isArchived: Boolean(json?.isArchived ?? (json as any)?.is_archived ?? false),
  }
}

function buildCreateBody(input: SavedQueryCreateInput) {
  return {
    name: input.name,
    description: input.description ?? undefined,
    sql: input.sql,
    variables: Array.isArray(input.variables) ? input.variables : [],
    dynamicColumns: Array.isArray(input.dynamicColumns)
      ? input.dynamicColumns
      : [],
    calcItems: Array.isArray(input.calcItems) ? input.calcItems : [],
  }
}

function buildUpdateBody(patch: SavedQueryUpdateInput) {
  const body: Record<string, unknown> = {}
  if (patch.name !== undefined) body.name = patch.name
  if (patch.description !== undefined) body.description = patch.description
  if (patch.sql !== undefined) body.sql = patch.sql
  if (patch.variables !== undefined) body.variables = patch.variables
  if (patch.dynamicColumns !== undefined)
    body.dynamicColumns = patch.dynamicColumns
  if (patch.calcItems !== undefined) body.calcItems = patch.calcItems
  if (patch.isArchived !== undefined) body.isArchived = patch.isArchived
  return body
}

interface RawErrorBody {
  error?: unknown
  message?: unknown
  suggestedSQL?: unknown
  suggestedSql?: unknown
  existingId?: unknown
  existing_id?: unknown
  detail?: unknown
  missing?: unknown
}

const mapError = (
  status: number,
  body: RawErrorBody | null,
): SavedQueriesApiError => {
  const code = typeof body?.error === 'string' ? body?.error : undefined
  const messageFromBody =
    typeof body?.message === 'string' ? body.message : undefined
  const suggestedSQL = toStringOrNull(body?.suggestedSQL ?? body?.suggestedSql ?? null)
  const existingId = toStringOrNull(body?.existingId ?? body?.existing_id ?? null)
  const missing = Array.isArray(body?.missing)
    ? (body?.missing as string[])
    : undefined

  if (status === 501) {
    if (code === 'feature_not_initialized') {
      return new SavedQueriesApiError({
        type: 'not_initialized',
        message: messageFromBody ?? DEFAULT_MESSAGES.not_initialized,
        status,
        suggestedSQL: suggestedSQL ?? undefined,
        detail: body?.detail,
      })
    }
    if (code === 'app_db_not_configured') {
      return new SavedQueriesApiError({
        type: 'app_db_not_configured',
        message:
          messageFromBody ?? DEFAULT_MESSAGES.app_db_not_configured,
        status,
      })
    }
  }

  if (status === 409 && code === 'name_exists') {
    return new SavedQueriesApiError({
      type: 'conflict',
      message: messageFromBody ?? DEFAULT_MESSAGES.conflict,
      status,
      existingId: existingId ?? undefined,
    })
  }

  if (status === 404) {
    return new SavedQueriesApiError({
      type: 'not_found',
      message: messageFromBody ?? DEFAULT_MESSAGES.not_found,
      status,
    })
  }

  if (status === 401 || code === 'unauthorized') {
    return new SavedQueriesApiError({
      type: 'unauthorized',
      message: messageFromBody ?? DEFAULT_MESSAGES.unauthorized,
      status,
    })
  }

  if (status === 400) {
    return new SavedQueriesApiError({
      type: 'validation',
      message: messageFromBody ?? DEFAULT_MESSAGES.validation,
      status,
      detail: body?.detail,
      missing,
    })
  }

  return new SavedQueriesApiError({
    type: 'unknown',
    message:
      messageFromBody ??
      (code ? `${DEFAULT_MESSAGES.unknown}（${code}）` : DEFAULT_MESSAGES.unknown),
    status,
    detail: body?.detail,
  })
}

const makeNetworkError = (cause: unknown): SavedQueriesApiError =>
  new SavedQueriesApiError({
    type: 'network',
    message: DEFAULT_MESSAGES.network,
    cause,
  })

const makeRequest = (fetchImpl: FetchLike) =>
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response
    try {
      response = await fetchImpl(path, init)
    } catch (err) {
      throw makeNetworkError(err)
    }

    const contentType = response.headers.get('content-type') ?? ''
    const isJson = contentType.includes('application/json')
    let payload: any = null

    if (isJson) {
      payload = await response.json().catch(() => ({}))
    } else if (!response.ok) {
      const text = await response.text().catch(() => '')
      payload = text ? { message: text } : null
    }

    if (!response.ok) {
      throw mapError(response.status, payload)
    }

    if (isJson) {
      return (payload ?? {}) as T
    }

    // 对于 204 / 非 JSON 响应，返回空对象
    return {} as T
  }

export interface SavedQueriesApi {
  list(): Promise<SavedQueryListItem[]>
  get(id: string): Promise<SavedQueryDetail>
  create(input: SavedQueryCreateInput): Promise<{ id: string | null }>
  update(id: string, patch: SavedQueryUpdateInput): Promise<void>
  archive(id: string): Promise<void>
}

const encodeId = (id: string) => encodeURIComponent(id)

export function createSavedQueriesApi(fetchImpl: FetchLike = fetch): SavedQueriesApi {
  const request = makeRequest(fetchImpl)

  return {
    async list() {
      const data = await request<ListResponse>('/api/user/saved-sql', {
        cache: 'no-store',
      })
      const items = Array.isArray(data.items) ? data.items : []
      return items.map((item) => normalizeSummary(item))
    },

    async get(id: string) {
      const data = await request<DetailResponse>(
        `/api/user/saved-sql/${encodeId(id)}`,
        { cache: 'no-store' },
      )
      return normalizeDetail(data)
    },

    async create(input) {
      const body = JSON.stringify(buildCreateBody(input))
      const data = await request<CreateResponse>('/api/user/saved-sql', {
        method: 'POST',
        headers: JSON_HEADERS,
        body,
      })
      const id = data?.id != null ? String(data.id) : null
      return { id }
    },

    async update(id, patch) {
      const payload = buildUpdateBody(patch)
      await request<UpdateResponse>(`/api/user/saved-sql/${encodeId(id)}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
      })
    },

    async archive(id) {
      await request<UpdateResponse>(`/api/user/saved-sql/${encodeId(id)}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ isArchived: true }),
      })
    },
  }
}

export function useSavedQueriesApi(fetchImpl?: FetchLike): SavedQueriesApi {
  return useMemo(() => createSavedQueriesApi(fetchImpl), [fetchImpl])
}
