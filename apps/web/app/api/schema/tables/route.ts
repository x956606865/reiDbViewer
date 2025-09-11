import { NextResponse, type NextRequest } from 'next/server'
import { getMockSchema } from '@rei-db-view/introspect'

export async function GET(_req: NextRequest) {
  // 当前返回本地 mock，后续在你同意后接只读连接到 PG
  const schema = getMockSchema()
  return NextResponse.json(schema)
}
