// 简单的标识符引用（PostgreSQL）
export function qid(id: string | undefined): string {
  if (!id) return ''
  return '"' + String(id).replaceAll('"', '""') + '"'
}

