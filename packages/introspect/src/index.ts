import type { ColumnMeta, ForeignRef, SchemaSummary, TableMeta } from '@rei-db-view/types/meta'

export function getMockSchema(): SchemaSummary {
  const users: TableMeta = {
    schema: 'public',
    name: 'users',
    columns: [
      { name: 'id', dataType: 'uuid', nullable: false, isPrimaryKey: true },
      { name: 'email', dataType: 'text', nullable: false, isPrimaryKey: false, sensitivity: 'restricted' },
      { name: 'profile', dataType: 'jsonb', nullable: true, isPrimaryKey: false }
    ]
  }
  const ordersRef: ForeignRef = { schema: 'public', table: 'users', column: 'id' }
  const orders: TableMeta = {
    schema: 'public',
    name: 'orders',
    columns: [
      { name: 'id', dataType: 'bigint', nullable: false, isPrimaryKey: true },
      { name: 'user_id', dataType: 'uuid', nullable: false, isPrimaryKey: false, isForeignKey: true, references: ordersRef },
      { name: 'total', dataType: 'numeric', nullable: false, isPrimaryKey: false },
      { name: 'meta', dataType: 'jsonb', nullable: true, isPrimaryKey: false },
      { name: 'created_at', dataType: 'timestamp with time zone', nullable: false, isPrimaryKey: false }
    ]
  }
  return { tables: [users, orders] }
}

// 预留：将来可添加 introspectPg(pool) 的真实实现（只读），当前不触库
export type { SchemaSummary }

