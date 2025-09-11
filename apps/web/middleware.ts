import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { betterFetch } from '@better-fetch/fetch'

const BYPASS_PREFIXES = ['/install', '/api', '/_next', '/favicon', '/assets']

export async function middleware(request: NextRequest) {
  // 若未配置 APP_DB_URL，直接放行
  if (!process.env.APP_DB_URL) return NextResponse.next()

  const { pathname } = request.nextUrl
  if (BYPASS_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const schema = process.env.APP_DB_SCHEMA || 'public'
  const prefix = process.env.APP_DB_TABLE_PREFIX || 'rdv_'
  try {
    const search = new URLSearchParams({ schema, prefix })
    const res = await fetch(`${request.nextUrl.origin}/api/appdb/init/status?${search.toString()}`, {
      // 避免缓存，确保拿到最新状态
      cache: 'no-store',
      headers: { cookie: request.headers.get('cookie') || '' },
    })
    const json = await res.json().catch(() => ({}))
    const initialized = !!json?.initialized
    if (!initialized) {
      const url = request.nextUrl.clone()
      url.pathname = '/install'
      url.searchParams.set('schema', schema)
      url.searchParams.set('prefix', prefix)
      return NextResponse.redirect(url)
    }
    // 需要鉴权的路径：/connections, /preview, /schema
    const needAuth = [/^\/connections/, /^\/preview/, /^\/schema/].some((re) => re.test(pathname))
    if (needAuth) {
      // 对于 Next 15.1.7-，用 HTTP 调 get-session
      const { data: session } = await betterFetch<any>(`${request.nextUrl.origin}/api/auth/get-session`, {
        headers: { cookie: request.headers.get('cookie') || '' },
      })
      if (!session) {
        const url = request.nextUrl.clone()
        url.pathname = '/sign-in'
        return NextResponse.redirect(url)
      }
    }
    return NextResponse.next()
  } catch {
    // 检测失败时不阻断访问，避免循环；可在 /install 页面提供“手动检测”入口
    return NextResponse.next()
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
