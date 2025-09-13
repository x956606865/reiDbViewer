import { NextResponse, type NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { readSchemaCache } from '@/lib/schema-cache'
import { getMockSchema } from '@rei-db-view/introspect'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const userConnId = url.searchParams.get('userConnId') || undefined
  try {
    if (process.env.APP_DB_URL && userConnId) {
      const session = await auth.api.getSession({ headers: await headers() })
      const userId = session?.user?.id
      if (userId) {
        const cached = await readSchemaCache(userId, userConnId)
        if (cached) {
          return NextResponse.json({ ...(cached.payload || {}), cachedAt: cached.updatedAt })
        }
      }
    }
  } catch (e) {
    // 忽略缓存读取错误，退回到 mock
  }
  const schema = getMockSchema()
  return NextResponse.json({ ...schema, cachedAt: null })
}
