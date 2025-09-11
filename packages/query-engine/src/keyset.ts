import type { KeysetCursor, OrderByItem } from '../../types/src/ast'

export function buildKeysetPredicate(
  orderBy: OrderByItem[] | undefined,
  cursor: KeysetCursor | undefined,
  tableAlias?: string
): { clause: string; values: unknown[] } | null {
  if (!orderBy || orderBy.length === 0 || !cursor) return null
  const cols = orderBy.map((o) => (tableAlias ? `${tableAlias}."${o.expr.name}"` : `"${o.expr.name}"`))
  const values = orderBy.map((o) => cursor.last[o.expr.name])
  const allSameDir = orderBy.every((o) => o.dir === orderBy[0].dir)
  if (allSameDir) {
    const tupleCols = '(' + cols.join(', ') + ')'
    const tupleVals = '(' + values.map((_, i) => `$${i + 1}`).join(', ') + ')'
    const op = orderBy[0].dir === 'DESC' ? '<' : '>'
    return { clause: `${tupleCols} ${op} ${tupleVals}`, values }
  }
  // 混合方向：使用 (c1 > v1) OR (c1 = v1 AND c2 > v2) ... 形式
  const parts: string[] = []
  let used = 0
  for (let i = 0; i < orderBy.length; i++) {
    const ors: string[] = []
    // 前缀相等
    if (i > 0) {
      const eqs = [] as string[]
      for (let j = 0; j < i; j++) {
        eqs.push(`${cols[j]} = $${++used}`)
      }
      ors.push('(' + eqs.join(' AND ') + ')')
    }
    // 当前位比较符
    const op = orderBy[i].dir === 'DESC' ? '<' : '>'
    ors.push(`${cols[i]} ${op} $${++used}`)
    parts.push(ors.length === 1 ? ors[0] : '(' + ors.join(' AND ') + ')')
  }
  // 重新组织 values 顺序：前缀相等会重复使用相同的值；为简单起见，重复 push
  const flatValues: unknown[] = []
  for (let i = 0; i < orderBy.length; i++) {
    for (let j = 0; j < i; j++) flatValues.push(values[j])
    flatValues.push(values[i])
  }
  return { clause: parts.join(' OR '), values: flatValues }
}
