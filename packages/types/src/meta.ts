export type Sensitivity = 'public' | 'internal' | 'restricted'

export interface ForeignRef {
  schema: string
  table: string
  column: string
}

export interface ColumnMeta {
  name: string
  dataType: string
  nullable: boolean
  isPrimaryKey: boolean
  isForeignKey?: boolean
  references?: ForeignRef
  sensitivity?: Sensitivity
}

export interface TableMeta {
  schema: string
  name: string
  columns: ColumnMeta[]
}

export interface SchemaSummary {
  tables: TableMeta[]
}

