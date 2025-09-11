import { NextResponse } from 'next/server'
import { listConnectionIds } from '../../../lib/db'

export async function GET() {
  // 仅返回可用的连接ID列表，不返回任何连接字符串或详细配置
  const ids = listConnectionIds()
  return NextResponse.json({ ids, default: ids.includes('default') ? 'default' : null })
}

