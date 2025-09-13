// 基础 AST 类型定义（MVP）

export type SqlIdentifier = string

export interface TableRef {
  schema?: SqlIdentifier
  name: SqlIdentifier
  alias?: SqlIdentifier
}

export interface ColumnRef {
  kind: 'colref'
  table?: SqlIdentifier
  name: SqlIdentifier
}

export interface LiteralParam {
  kind: 'param'
  value: unknown
}

export type Expr = ColumnRef | LiteralParam

export type AggFn = 'count' | 'json_agg' | 'string_agg'

export interface AggExpr {
  kind: 'agg'
  fn: AggFn
  args: Expr[]
  options?: { distinct?: boolean; limit?: number; separator?: string }
}

export type ComputedExpr = AggExpr | ColumnRef

export interface ColumnSelect {
  kind: 'column'
  ref: ColumnRef
  alias?: SqlIdentifier
}

export interface ComputedSelect {
  kind: 'computed'
  expr: ComputedExpr
  alias: SqlIdentifier
  viaJoinId?: string // 若来源于 Lookup(LATERAL)
}

export type SelectItem = ColumnSelect | ComputedSelect

export type JoinType = 'INNER' | 'LEFT' | 'LATERAL'

export interface OnEq {
  kind: 'eq'
  left: ColumnRef
  right: ColumnRef
}

export type JoinOn = OnEq

export interface JoinDef {
  type: JoinType
  to: TableRef
  alias?: SqlIdentifier
  on?: JoinOn
  id?: string // 用于复用/去重
}

export interface OrderByItem {
  expr: ColumnRef
  dir: 'ASC' | 'DESC'
}

export interface KeysetCursor {
  last: Record<string, string | number | boolean | null | Date>
}

export type WhereOp =
  | { kind: 'eq'; left: ColumnRef; right: ColumnRef | LiteralParam }
  | { kind: 'ilike'; left: ColumnRef; right: LiteralParam; castText?: boolean } // paramized text search
  | { kind: 'gt' | 'lt' | 'gte' | 'lte'; left: ColumnRef; right: LiteralParam }
  | { kind: 'between'; left: ColumnRef; from: LiteralParam; to: LiteralParam }
  | { kind: 'json_contains'; left: ColumnRef; right: LiteralParam } // jsonb @>
  | { kind: 'json_path_exists'; left: ColumnRef; right: LiteralParam } // jsonb_path_exists(col, path)

export interface Select {
  columns: SelectItem[]
  from: TableRef
  joins?: JoinDef[]
  where?: WhereOp[] // 支持等值与 ILIKE
  orderBy?: OrderByItem[]
  limit?: number
  offset?: number
  keyset?: KeysetCursor
}

export interface LookupColumn {
  id: string
  fromTable: TableRef
  toTable: TableRef
  on: OnEq
  agg?: { kind: 'none' | 'count' | 'json_agg' | 'string_agg'; limit?: number; separator?: string }
  pick: ColumnRef | AggExpr
  alias?: SqlIdentifier
}

export interface BuildResult {
  text: string
  values: unknown[]
}
