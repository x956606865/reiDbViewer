# AGENTS 指南（reiDbView）

> 目标：读优先的数据库数据浏览器（PG-only / Web-only）。强调清晰表格视图、JSON/JSONB 友好渲染、可视化 Join 与“视图内即时 Join 加列（Lookup，优先 LATERAL）”。

## 工作流与约束

- 只读安全：严禁任何写库操作；不做 DB 迁移与权限变更。执行接口默认仅返回 SQL 预览；真实执行前需显式确认只读连接。
- 依赖安装与重型命令：安装/构建/端到端测试需要事先征求同意（本项目已确认可安装依赖）。
- Secrets：不提交 `.env`、密钥、令牌；本地使用 `DATABASE_URL_RO` 等环境变量（示例配置走 `.env.example`）。
- CI/Infra：未经确认不改动；优先在本地验证。

## 开发规范

- Test First：为查询引擎先写单测/属性测，再实现逻辑；UI 交互写组件测试。
- 输入校验：所有 API 入参用 `zod` 校验；标识符（表/列）基于白名单，值参数化。
- SQL 生成：基于 AST，参数与标识符分离，支持 Keyset 分页（默认优先），LATERAL 由 Join Registry 去重与生成。
- JSONB：过滤语义模板化（exist / contain(@>) / path_exists），UI 提示索引友好写法。
- 性能与安全：每请求 `SET LOCAL statement_timeout`、`idle_in_transaction_session_timeout`、收窄 `search_path`；双连接池（元数据/数据）。

## 代码结构

```
.
├─ apps/web                  # Next.js App Router（API 路由 Stub 已就绪）
│  └─ app/api/...            # /schema, /query/preview, /query/execute
├─ packages/query-engine     # AST→SQL、Keyset、LATERAL 占位（测试草案已就绪）
├─ packages/types            # AST 与类型定义
└─ docs                      # 设计方案 & 审计建议
```

## 运行环境与依赖

- Node.js 20 LTS + pnpm（corepack）
- 关键依赖：
  - 前端：`next`、`react`、`@tanstack/react-table`、`@tanstack/react-virtual`、`@tanstack/react-query`、`@xyflow/react`、`react-json-view`
  - 服务端：`zod`、`pg`（只读）、日志与安全库后续按需加入
  - 测试：`vitest`

## 常用命令

- 安装依赖：`pnpm -w install`（若本机无 pnpm，可再考虑 corepack）
- 类型检查：`pnpm typecheck`
- 运行测试：`pnpm test`
- 启动 Web（依赖进一步实现）：`pnpm --filter @rei-db-view/web dev`

## 设计要点（速查）

- Lookup（视图内加列）：优先使用 `LEFT JOIN LATERAL` 子查询，Join Registry 以（toTable + on + pick/agg）签名去重复用；必要时回退标准 JOIN。
- Keyset 分页（默认）：有稳定唯一排序键（追加主键兜底）时启用；Offset 仅作回退。
- 审计与脱敏：列级 `sensitivity` 元数据 + 默认掩码；审计记录 AST hash + 参数摘要 + 返回行数分档；不落盘 SQL 原文。
- JSON 大字段：单元格截断 + 抽屉按“路径+范围”增量抓取 `/api/json/chunk`。

## 多数据库连接（安全方案）

- 白名单策略（服务器端）：
  - 单数据库：`DATABASE_URL_RO`
  - 多数据库：`RDV_CONN_IDS=prod,staging` + `DATABASE_URL_RO__prod`、`DATABASE_URL_RO__staging`
  - 仅服务器持有连接串；客户端永不保存连接串。
- 连接选择（客户端）：
  - `/api/connections` 返回允许的 `id` 列表（不含 URL）。
  - 页面 `/connections` 允许将 `id` 绑定为“别名”（localStorage），并选择一个“当前连接”。
  - 查询请求在 body 中携带 `connId`（仅 ID）。
- 执行安全：
  - 每请求：`SET LOCAL statement_timeout`、`idle_in_transaction_session_timeout`、`search_path=pg_catalog,"$user"`。
  - 强制只读：不提供写入口；执行后 `ROLLBACK` 清理作用域。
- 审计（后续）：记录 `connId` + AST hash + 行数分档。

## 用户系统与应用数据库（设计草案）

- 目标：在“应用自有 PG”中存储用户、用户的数据库连接配置（只保存加密后的 DSN）与偏好/视图等。
- 重要约束：
  - 浏览器端永不保存数据库连接串；仅保存“别名→连接ID”。
  - 服务端存储的 DSN 必须使用 `APP_ENCRYPTION_KEY`（32B base64）进行 AES-256-GCM 加密。
  - 对用户提交的 DSN 做 SSRF 防护：拒绝私网/本机地址、要求 TLS（`sslmode=require`）。
- 环境变量：
  - `APP_DB_URL`：应用自有 PG（用于用户/连接等数据）
  - `APP_ENCRYPTION_KEY`：32 字节 base64，用于对敏感字段加解密
- API（占位）：
  - `GET/POST /api/user/connections`（已添加占位，APP_DB_URL 未配置时返回 501；已做 DSN 校验与加密预览）
  - 后续：`/api/user/views`、`/api/user/audit`
- 初始化检测与引导（不做自动迁移）：
  - 启动守卫：`apps/web/middleware.ts` 在 `APP_DB_URL` 已配置但未初始化时，将页面重定向到 `/install`。
  - 检测接口：`GET /api/appdb/init/status?schema=...&prefix=...` 返回 `{ initialized, schemaExists, existingTables, expectedTables, suggestedSQL, warnings }`。
  - 初始化页面：`/install` 展示 SQL、支持切换 schema 与“表前缀”并“复制 SQL / 我已执行，重新检测”。
  - 永不在应用内执行 DDL；所有变更均由用户在 DB 客户端手工执行。
- 代码参考：
  - `apps/web/lib/validate-dsn.ts`：DSN 校验与 SSRF 防护
  - `apps/web/lib/crypto.ts`：AES-256-GCM 加/解密
  - `apps/web/lib/appdb.ts`：应用库连接（占位，不迁移）

## 登录集成（Better Auth）

- 方案：使用 Better Auth（适配 Next.js App Router）
- 依赖：better-auth、@better-fetch/fetch（已安装）
- 最小接入（示例）：
  - `lib/auth.ts` 创建实例并启用 `nextCookies()` 插件（用于 Set-Cookie 透传）
  - `app/api/auth/[...all]/route.ts`：
    ```ts
    import { auth } from '@/lib/auth'
    import { toNextJsHandler } from 'better-auth/next-js'
    export const { GET, POST } = toNextJsHandler(auth.handler)
    ```
  - 中间件保护（Next 15.2+）：
    ```ts
    import { headers } from 'next/headers'
    import { NextResponse } from 'next/server'
    import { auth } from '@/lib/auth'
    export async function middleware(req){
      const session = await auth.api.getSession({ headers: await headers() })
      if(!session) return NextResponse.redirect(new URL('/sign-in', req.url))
      return NextResponse.next()
    }
    export const config = { runtime: 'nodejs', matcher: ['/connections','/preview','/schema'] }
    ```
- 注意：登录后端与应用库（APP_DB_URL）表结构需要你执行迁移；本项目不自动变更数据库。初始化页可配置 schema 与表前缀，生成与 Better Auth 对齐的表：`<prefix>users`（password_hash）、`<prefix>sessions`、`<prefix>verification_codes`。

## 工具使用规范

- 代码/文本搜索：`rg`；代码结构（TS/TSX）：`ast-grep`（优先）。
- JSON：`jq`；YAML/XML：`yq`。
- 官方文档：使用 Context7 获取库/API 文档（Next.js：`/vercel/next.js`；TanStack：`/tanstack/table`、`/tanstack/query`；Zod：`/colinhacks/zod`；pg：`/brianc/node-postgres`）。

## 风险与边界

- 高并发 + LATERAL：需限流/超时与结果列聚合（对一对多默认 `count` 或 `json_agg(limit)`）。
- Keyset 跳页语义：UI 采用上一页/下一页，弱化“跳转到第 N 页”预期。
- 索引建议：仅提示不改写，不做任何 DB 侧变更；权限收紧仅出现在运行手册建议中。
