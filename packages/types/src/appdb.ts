export interface UserRecord {
  id: string
  email: string
  createdAt: string
}

export interface UserConnectionRecord {
  id: string
  userId: string
  alias: string
  dsnCipher: string // AES-256-GCM(iv+tag+ct base64)
  createdAt: string
  lastUsedAt?: string
}

export type SavedQueryVarType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'json'
  | 'uuid'
  | 'raw'

export interface SavedQueryVariableDef {
  name: string
  label?: string
  type: SavedQueryVarType
  required?: boolean
  default?: unknown
}

export interface SavedQueryRecord {
  id: string
  userId: string
  name: string
  description?: string | null
  sql: string
  variables: SavedQueryVariableDef[]
  dynamicColumns?: DynamicColumnDef[]
  isArchived?: boolean
  createdAt: string
  updatedAt: string
}

export interface DynamicColumnDef {
  name: string
  code: string // JavaScript function body. Signature: (row, vars, helpers) => any
  manualTrigger?: boolean
}
