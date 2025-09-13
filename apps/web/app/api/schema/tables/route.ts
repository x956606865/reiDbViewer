import { NextResponse, type NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { readSchemaCache } from '@/lib/schema-cache'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const userConnId = url.searchParams.get('userConnId') || undefined
  try {
    if (process.env.APP_DB_URL && userConnId) {
      const session = await auth.api.getSession({ headers: await headers() })
      const userId = session?.user?.id
      if (userId) {
        const cached = await readSchemaCache(userId, userConnId)
        if (cached) return NextResponse.json({ ...(cached.payload || {}), cachedAt: cached.updatedAt })
        // 有连接但无缓存时，不再回退 mock；返回空结果用于前端显示“请刷新”
        return NextResponse.json({ tables: [], schemas: [], databases: [], cachedAt: null })
      }
    }
  } catch (e) {
    // 忽略缓存读取错误，退回到 mock
  }
  // 未提供 userConnId 或未登录场景：继续提供本地 mock 便于开发
  const { getMockSchema } = await import('@rei-db-view/introspect')
  const schema = getMockSchema()
  return NextResponse.json({ ...schema, cachedAt: null })
}
