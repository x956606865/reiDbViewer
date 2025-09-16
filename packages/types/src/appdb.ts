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
  | 'enum'

export interface SavedQueryVariableDef {
  name: string
  label?: string
  type: SavedQueryVarType
  required?: boolean
  default?: unknown
  // Only for type === 'enum'
  options?: string[]
  // Optional SQL used to fetch enum options (first column as string)
  optionsSql?: string
}

export interface SavedQueryRecord {
  id: string
  userId: string
  name: string
  description?: string | null
  sql: string
  variables: SavedQueryVariableDef[]
  dynamicColumns?: DynamicColumnDef[]
  calcItems?: CalcItemDef[]
  isArchived?: boolean
  createdAt: string
  updatedAt: string
}

export interface DynamicColumnDef {
  name: string
  code: string // JavaScript function body. Signature: (row, vars, helpers) => any
  manualTrigger?: boolean
}

export interface CalcItemDef {
  name: string
  type: 'sql' | 'js'
  code: string // if type=js: function body Signature: (vars, rows, helpers) => any; if type=sql: SQL text supporting {{vars}} and special {{_sql}}
  runMode?: 'always' | 'initial' | 'manual'
}
