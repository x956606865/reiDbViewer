import { qid } from './quote'
import type {
  BuildResult,
  ColumnSelect,
  ComputedSelect,
  JoinDef,
  JoinType,
  OrderByItem,
  Select,
  SelectItem,
  TableRef,
} from '../../types/src/ast'
import { buildKeysetPredicate } from './keyset'

function tableToSql(t: TableRef): string {
  const schema = t.schema ? `${qid(t.schema)}.` : ''
  const base = `${schema}${qid(t.name)}`
  return t.alias ? `${base} ${qid(t.alias)}` : base
}

function selectItemToSql(s: SelectItem): string {
  if ((s as ColumnSelect).kind === 'column') {
    const cs = s as ColumnSelect
    const tbl = cs.ref.table ? `${qid(cs.ref.table)}.` : ''
    const expr = `${tbl}${qid(cs.ref.name)}`
    return cs.alias ? `${expr} AS ${qid(cs.alias)}` : expr
  }
  const comp = s as ComputedSelect
  // MVP：仅支持 count(*) 与列引用
  let expr = ''
  if (comp.expr.kind === 'agg') {
    if (comp.expr.fn === 'count') {
      expr = 'count(*)'
    } else {
      // 其他聚合先返回占位，后续通过 LATERAL 实现
      expr = '/* agg via LATERAL */ NULL'
    }
  } else if (comp.expr.kind === 'colref') {
    const tbl = comp.expr.table ? `${qid(comp.expr.table)}.` : ''
    expr = `${tbl}${qid(comp.expr.name)}`
  }
  return `${expr} AS ${qid(comp.alias)}`
}

function buildLateralSubquery(select: Select, j: JoinDef): string {
  // 收集引用该别名的列
  const alias = j.alias || 'lc'
  const usedCols = new Set<string>()
  for (const c of select.columns) {
    if ((c as any).kind === 'computed') {
      const comp = c as ComputedSelect
      if (comp.expr.kind === 'colref' && comp.expr.table === alias) {
        usedCols.add(comp.expr.name)
      }
    } else if ((c as any).kind === 'column') {
      const cc = c as ColumnSelect
      if (cc.ref.table === alias) usedCols.add(cc.ref.name)
    }
  }
  // 至少选择一个列，避免 SELECT 空
  if (usedCols.size === 0) usedCols.add('id')

  const innerAlias = 't'
  const colsSql = Array.from(usedCols).map((n) => `${qid(innerAlias)}.${qid(n)} AS ${qid(n)}`).join(', ')
  const base = `${qid(j.to.schema || '')}${j.to.schema ? '.' : ''}${qid(j.to.name)}`
  let whereSql = 'TRUE'
  if (j.on && j.on.kind === 'eq') {
    const left = j.on.left
    const right = j.on.right
    // 将 on 条件中的目标表引用替换为子查询内部别名
    const fmt = (ref: any) => {
      const tbl = ref.table === alias ? innerAlias : (ref.table || '')
      return `${qid(tbl)}.${qid(ref.name)}`
    }
    whereSql = `${fmt(left)} = ${fmt(right)}`
  }
  return `LEFT JOIN LATERAL (SELECT ${colsSql} FROM ${base} ${qid(innerAlias)} WHERE ${whereSql} LIMIT 1) ${qid(alias)} ON TRUE`
}

function joinToSql(select: Select, j: JoinDef): string {
  const t = tableToSql(j.to)
  if (j.type === 'LATERAL') {
    return buildLateralSubquery(select, j)
  }
  const jt = j.type === 'INNER' ? 'INNER JOIN' : 'LEFT JOIN'
  const on = j.on && j.on.kind === 'eq'
    ? ` ON ${qid(j.on.left.table || '')}.${qid(j.on.left.name)} = ${qid(j.on.right.table || '')}.${qid(j.on.right.name)}`
    : ''
  return `${jt} ${t}${on}`
}

export function buildSelectSql(ast: Select): BuildResult {
  const values: unknown[] = []
  const parts: string[] = []
  const param = (v: unknown) => {
    values.push(v)
    return '$' + values.length
  }
  parts.push('SELECT')
  parts.push(ast.columns.map(selectItemToSql).join(', '))
  parts.push('FROM')
  parts.push(tableToSql(ast.from))
  if (ast.joins && ast.joins.length) {
    for (const j of ast.joins) parts.push(joinToSql(ast, j))
  }
  if (ast.where && ast.where.length) {
    const ws = ast.where.map((w: any) => {
      const left = `${qid(w.left.table || '')}.${qid(w.left.name)}`
      switch (w.kind) {
        case 'eq':
          if (w.right?.kind === 'param') return `${left} = ${param(w.right.value)}`
          return `${left} = ${qid(w.right.table || '')}.${qid(w.right.name)}`
        case 'ilike': {
          const rv = w.right?.value
          const l = w.castText ? `${left}::text` : left
          return `${l} ILIKE ${param(rv)}`
        }
        case 'gt':
          return `${left} > ${param(w.right?.value)}`
        case 'lt':
          return `${left} < ${param(w.right?.value)}`
        case 'gte':
          return `${left} >= ${param(w.right?.value)}`
        case 'lte':
          return `${left} <= ${param(w.right?.value)}`
        case 'between':
          return `${left} BETWEEN ${param(w.from?.value)} AND ${param(w.to?.value)}`
        case 'json_contains':
          return `${left} @> ${param(w.right?.value)}::jsonb`
        case 'json_path_exists':
          return `jsonb_path_exists(${left}, ${param(w.right?.value)}::jsonpath)`
        default:
          return 'TRUE'
      }
    })
    parts.push('WHERE ' + ws.join(' AND '))
  }
  if (ast.orderBy && ast.orderBy.length) {
    const os = ast.orderBy.map((o: OrderByItem) => `${qid(o.expr.table || '')}.${qid(o.expr.name)} ${o.dir}`).join(', ')
    parts.push('ORDER BY ' + os)
  }
  if (ast.keyset) {
    const p = buildKeysetPredicate(ast.orderBy, ast.keyset, ast.from.alias || ast.from.name)
    if (p) {
      parts.push(parts.some((p) => p.startsWith('WHERE')) ? 'AND ' + p.clause : 'WHERE ' + p.clause)
      values.push(...p.values)
    }
  }
  if (ast.limit != null) parts.push('LIMIT ' + Number(ast.limit))
  if (ast.offset != null) parts.push('OFFSET ' + Number(ast.offset))
  return { text: parts.join(' '), values }
}
