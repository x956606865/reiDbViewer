# AGENTS 指南（reiDbView）

> 目标：读优先的数据库数据浏览器（PG-only / Web-only）。强调清晰表格视图、JSON/JSONB 友好渲染、可视化 Join 与“视图内即时 Join 加列（Lookup，优先 LATERAL）”。

## 工作流与约束

- 只读安全：严禁任何写库操作；不做 DB 迁移与权限变更。执行接口默认仅返回 SQL 预览；真实执行前需显式确认只读连接。
- 依赖安装与重型命令：安装/构建/端到端测试需要事先征求同意（本项目已确认可安装依赖）。
- Secrets：不提交 `.env`、密钥、令牌；生产数据库连接改为“用户自有连接”存放应用库（加密后），不再使用 `DATABASE_URL_RO` 白名单。
- CI/Infra：未经确认不改动；优先在本地验证。

## 开发规范

- Test First：为查询引擎先写单测/属性测，再实现逻辑；UI 交互写组件测试。
- 输入校验：所有 API 入参用 `zod` 校验；标识符（表/列）基于白名单，值参数化。
- SQL 生成：基于 AST，参数与标识符分离，支持 Keyset 分页（默认优先），LATERAL 由 Join Registry 去重与生成。
- JSONB：过滤语义模板化（exist / contain(@>) / path_exists），UI 提示索引友好写法。
- 性能与安全：每请求 `SET LOCAL statement_timeout`、`idle_in_transaction_session_timeout`、收窄 `search_path`；双连接池（元数据/数据）。

## 代码结构（当前实际）

```
.
├─ apps/web                       # Next.js App Router 应用（前后端同仓）
│  ├─ app                         # 页面与 API 路由
│  │  ├─ layout.tsx               # 全局布局（Mantine Provider + AppFrame）
│  │  ├─ page.tsx                 # 首页（项目简介）
│  │  ├─ install/page.tsx         # 安装引导页（/install）
│  │  ├─ schema/page.tsx          # Schema Explorer 页面（/schema）
│  │  ├─ browse/[schema]/[table]/page.tsx  # 表数据浏览（分页/筛选/排序/SQL 预览）
│  │  ├─ queries/page.tsx         # Saved SQL 管理与运行（导入/导出/变量）
│  │  ├─ connections/page.tsx     # 用户连接管理
│  │  ├─ ops/page.tsx             # 运维预设查询（pg_stat_*）
│  │  └─ api                      # App Router API
│  │     ├─ auth/[...all]/route.ts              # Better Auth Handler
│  │     ├─ appdb/init/status/route.ts          # APP_DB 初始化检测
│  │     ├─ schema/tables/route.ts              # 读取缓存的元数据或返回 mock
│  │     ├─ schema/refresh/route.ts             # 连真实库做只读自省并写入缓存
│  │     ├─ schema/indexes/route.ts             # 单表索引详情（pg_index/pg_indexes）
│  │     ├─ query/preview/route.ts              # AST→SQL 预览（不执行）
│  │     ├─ query/execute/route.ts              # AST→SQL + 执行（仅 SELECT/WITH）
│  │     ├─ saved-sql/execute/route.ts          # 运行保存的 SQL（分页可选）
│  │     ├─ user/saved-sql/route.ts             # 列表/创建 Saved SQL
│  │     ├─ user/saved-sql/[id]/route.ts        # 查看/更新 Saved SQL
│  │     ├─ user/connections/route.ts           # 用户连接：列出/新增（AES 加密 DSN）
│  │     ├─ ops/queries/route.ts                # 运维查询：长跑/阻塞/锁/连接概览
│  │     └─ ops/signal/route.ts                 # 对 PID 发 cancel/terminate 信号
│  ├─ components                 # UI 组件
│  │  ├─ AppFrame.tsx            # 顶部导航 + 主题切换 + 连接切换
│  │  ├─ Providers.tsx           # Mantine Provider & 主题
│  │  ├─ ConnectionSwitcher.tsx  # 选择当前用户连接（localStorage）
│  │  ├─ SmartGrid.tsx           # 基于 mantine-react-table 的表格（排序/筛选 UI）
│  │  ├─ DataGrid.tsx            # 轻量表格（Ops/查询结果）
│  │  ├─ JsonCell.tsx            # JSON/JSONB 友好渲染（MVP）
│  │  └─ LeftDrawer.tsx 等       # Queries 页侧栏
│  ├─ lib                        # 服务端/通用工具
│  │  ├─ env.ts                  # 运行时配置（超时/限制/schema/prefix）
│  │  ├─ appdb.ts                # 应用库连接池（设定 search_path）
│  │  ├─ appdb-init.ts           # APP_DB 初始化状态检测与 SQL 生成
│  │  ├─ auth.ts                 # Better Auth 初始化（定制表名/字段名）
│  │  ├─ crypto.ts               # AES-256-GCM 加/解密（APP_ENCRYPTION_KEY）
│  │  ├─ validate-dsn.ts         # DSN 校验（协议/端口等）
│  │  ├─ db.ts                   # withSafeSession：只读会话 + SET LOCAL 守护
│  │  ├─ user-conn.ts            # 从 APP_DB 读 DSN（解密）并创建用户池
│  │  ├─ current-conn.ts         # 浏览器端当前连接 ID（localStorage + 订阅）
│  │  ├─ schema-cache.ts         # 元数据缓存读写（APP_DB 表 rdv_schema_cache）
│  │  ├─ schema-hide.ts          # 前端隐藏 schema/table 规则（localStorage）
│  │  ├─ sql-template.ts         # Saved SQL 占位符编译/预览/只读校验
│  │  ├─ saved-sql-import-export.ts  # JSON 导入/导出 schema 与规范化
│  │  └─ ops/queries.ts          # 运维查询 SQL 生成（zod 校验）
│  ├─ middleware.ts              # 初始化检测与鉴权跳转（/install, /sign-in）
│  └─ next.config.ts             # Next 配置（standalone, tracing root）
├─ packages/query-engine         # AST→SQL 生成器
│  └─ src/{sql,keyset,quote}.ts  # SELECT 渲染、Keyset 谓词、标识符引用
├─ packages/types                # 共享类型（AST/Meta/APP_DB）
│  └─ src/{ast,meta,appdb}.ts
├─ packages/introspect           # 本地开发 mock 的元数据（getMockSchema）
└─ docs                          # 设计/运维/功能文档（docker, saved-sql 等）
```

> 提示：IDE 中仍显示的 `apps/web/app/preview/page.tsx` 为历史文件，现已移除（预览改为 `/api/query/preview`）。

## 运行环境与依赖

- Node.js 20 LTS + pnpm（corepack）
- 关键依赖：
  - 前端：`next`、`react`、`@mantine/*`、`mantine-react-table`（基于 TanStack Table）、`@tanstack/react-query`、`react-json-view`
  - 服务端：`zod`、`pg`（只读）、日志与安全库后续按需加入
  - 测试：`vitest`

> 说明：仍可按需引入 `@tanstack/react-table`/`react-virtual`，但当前网格实现集中于 `mantine-react-table`。

## 环境变量与默认值（apps/web/lib/env.ts）

- `QUERY_TIMEOUT_DEFAULT_MS`：查询超时默认值（默认 5000）
- `QUERY_TIMEOUT_MAX_MS`：查询超时上限（默认 10000）
- `SCHEMA_REFRESH_TIMEOUT_MS`：Schema 自省独立超时（默认 30000）
- `MAX_ROW_LIMIT`：单次最大返回行数（默认 1000）
- `APP_DB_SCHEMA`：应用库 schema（默认 `public`）
- `APP_DB_TABLE_PREFIX`：应用表前缀（默认 `rdv_`）

## 文件地图（按功能）

— 安装与初始化
- 前端引导：`apps/web/app/install/page.tsx`
- 中间件：`apps/web/middleware.ts`（已配置 APP_DB_URL 但未初始化时重定向 /install，并对 `/schema`/`/connections` 做登录检查）
- 检测 API：`apps/web/app/api/appdb/init/status/route.ts` → `apps/web/lib/appdb-init.ts`
- 应用库连接：`apps/web/lib/appdb.ts`（连接时设置 `search_path=pg_catalog,<schema>`）

— 登录认证（Better Auth）
- 初始化：`apps/web/lib/auth.ts`（绑定 APP_DB 表名/字段名，插件 `nextCookies()`）
- Handler：`apps/web/app/api/auth/[...all]/route.ts`

— 用户连接（加密 DSN）
- API：`apps/web/app/api/user/connections/route.ts`（GET/POST）
- DSN 校验：`apps/web/lib/validate-dsn.ts`
- 加解密：`apps/web/lib/crypto.ts`（`APP_ENCRYPTION_KEY` 必须为 32 字节 base64）
- 读取连接池：`apps/web/lib/user-conn.ts`（从 APP_DB 取 `dsn_cipher` 解密成 Pool）
- 前端状态：`apps/web/lib/current-conn.ts`（localStorage 键 `rdv.currentUserConnId`）+ `apps/web/components/ConnectionSwitcher.tsx`

— Schema Explorer / 索引
- 读取缓存或 mock：`apps/web/app/api/schema/tables/route.ts`（登录+userConnId 时读缓存，否则使用 `packages/introspect` mock）
- 刷新元数据（真实库自省）：`apps/web/app/api/schema/refresh/route.ts`（只读事务 + SET LOCAL 守护 + DDL 合成）→ 写入 `apps/web/lib/schema-cache.ts`
- 索引 API：`apps/web/app/api/schema/indexes/route.ts`（合并 `pg_indexes` 与 `pg_index` 视图信息）
- 前端页面：`apps/web/app/schema/page.tsx`

— 表数据浏览（只读执行 + SQL 预览降级）
- 页面：`apps/web/app/browse/[schema]/[table]/page.tsx`（构建 AST → `/api/query/execute`，失败时降级 `/api/query/preview`）
- 执行 API：`apps/web/app/api/query/execute/route.ts`（强制只读 withSafeSession + 限制 `MAX_ROW_LIMIT`）
- SQL 预览 API：`apps/web/app/api/query/preview/route.ts`
- 查询引擎：`packages/query-engine/src/{sql,keyset,quote}.ts` + 类型 `packages/types/src/ast.ts`
- 表格组件：`apps/web/components/SmartGrid.tsx`（排序/筛选 UI 与列推导）

— Saved SQL（模板变量/导入导出/分页可选）
- 列表/创建：`apps/web/app/api/user/saved-sql/route.ts`（缺表返回 501 并提供建表 SQL；兼容旧表无 `dynamic_columns` 情况）
- 查看/更新：`apps/web/app/api/user/saved-sql/[id]/route.ts`（同上返回 501 建议 ALTER）
- 执行：`apps/web/app/api/saved-sql/execute/route.ts`（只允许 `SELECT/WITH`，占位符编译→参数化；可选分页与计数）
- 模板编译：`apps/web/lib/sql-template.ts`（`{{name}}`→`$n` + 只读语句检查 + 预览文本渲染）
- 导入/导出：`apps/web/lib/saved-sql-import-export.ts`（Schema v1）+ 文档 `docs/saved-sql.md`
- 前端页面：`apps/web/app/queries/page.tsx`（树状“/”路径为文件夹，动态列为客户端 JS 计算）

— 运维（只读排障）
- SQL 生成：`apps/web/lib/ops/queries.ts`（长跑/阻塞链/长事务/等待锁/连接概览）
- 执行 API：`apps/web/app/api/ops/queries/route.ts`
- 信号 API：`apps/web/app/api/ops/signal/route.ts`（对 pid 调用 `pg_cancel_backend`/`pg_terminate_backend`，需确认）
- 前端页面：`apps/web/app/ops/page.tsx`

— 安全与会话守护
- withSafeSession：`apps/web/lib/db.ts`（`BEGIN`→`SET LOCAL statement_timeout/idle_in_transaction_session_timeout/search_path`→用户回调→`ROLLBACK`）
- 只读限制：
  - AST 执行路径：前端生成 AST，仅 `/api/query/execute` 执行 SELECT；行数受 `env.MAX_ROW_LIMIT` 限制。
  - Saved SQL：`isReadOnlySelect()` 限制仅允许 `SELECT/WITH` 开头。

## 测试与样例数据

- 单测：
  - `apps/web/lib/validate-dsn.test.ts`、`apps/web/lib/ops/queries.test.ts`
  - `packages/query-engine/test/*.test.ts`（Keyset/LATERAL 草案测试）
- 元数据 mock：`packages/introspect/src/index.ts`（`getMockSchema()` 被 `/api/schema/tables` 在未登录/未提供连接时使用）

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

- 用户自有连接（服务器端持久化）：
  - 用户在 `/connections` 新增 `别名 + DSN`；服务端以 `APP_ENCRYPTION_KEY` 加密后存入 `<prefix>user_connections`。
  - 客户端仅保存“当前连接记录 ID”（`localStorage['rdv.currentUserConnId']`），不保存明文 DSN。
- 查询执行（服务器端解密）：
  - `/api/query/execute` 从会话中获取 `userId`，依据 `userConnId` 读取并解密 DSN，动态创建只读连接池。
  - 每请求：`SET LOCAL statement_timeout`、`idle_in_transaction_session_timeout`、`search_path=pg_catalog,"$user"`；执行后 `ROLLBACK`。
- 兼容性：
  - 旧的环境白名单（`DATABASE_URL_RO`/`RDV_CONN_IDS`、`/api/connections`、body.connId）已移除。

## 用户系统与应用数据库（设计草案）

- 目标：在“应用自有 PG”中存储用户、用户的数据库连接配置（只保存加密后的 DSN）与偏好/视图等。
- 重要约束：
  - 浏览器端永不保存数据库连接串；仅保存“别名→连接ID”。
  - 服务端存储的 DSN 必须使用 `APP_ENCRYPTION_KEY`（32B base64）进行 AES-256-GCM 加密。
  - 对用户提交的 DSN 做基本校验：允许私网/本机地址；为安全起见建议 TLS（`sslmode=require`）。
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
  - 规则（重要）：凡新增 APP_DB 表或对现有表做结构调整（新增列/索引等），必须同步更新安装检测：
    1) `apps/web/lib/appdb-init.ts`：
       - 将新表加入 `expectedTableNames()`；
       - 在 `renderInitSql()` 中加入完整建表 SQL；
       - 若为“对已有表的新增列/索引”，在 `checkInitStatus()` 中增加存在性检测，并在 `suggestedSQL` 里追加相应 `ALTER` 语句，同时把说明写入 `warnings`；例如 2025-09 新增 `saved_queries.dynamic_columns` 的检测与 `ALTER`。
    2) `/install` 页面需展示 `warnings` 并提供复制包含 `ALTER` 的 `suggestedSQL`；
    3) 相关 API 发现缺列/缺表时返回 `501 feature_not_initialized` 并附 `suggestedSQL` 兜底。
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
    export const config = { runtime: 'nodejs', matcher: ['/connections','/schema'] }
    ```
- 注意：登录后端与应用库（APP_DB_URL）表结构需要你执行迁移；本项目不自动变更数据库。初始化页可配置 schema 与表前缀，生成与 Better Auth 对齐的表：`<prefix>users`（password_hash）、`<prefix>sessions`、`<prefix>verification_codes`。

## 工具使用规范

- 代码/文本搜索：`rg`；代码结构（TS/TSX）：`ast-grep`（优先）。
- JSON：`jq`；YAML/XML：`yq`。
- 官方文档：使用 Context7 获取库/API 文档（Next.js：`/vercel/next.js`；TanStack：`/tanstack/table`、`/tanstack/query`；Zod：`/colinhacks/zod`；pg：`/brianc/node-postgres`）。

## 常见开发任务清单（Checklist）

- 新增 APP_DB 表/列/索引：同步更新 `apps/web/lib/appdb-init.ts` 的 expected/SQL/检查 + `/install` 页提示；相关 API 缺项时返回 501 并附 SQL。
- 新增 API 路由：
  - 参数校验用 `zod`；
  - 读取用户连接需经 `auth.api.getSession()` + `getUserConnPool()`；
  - 所有 DB 调用包裹 `withSafeSession()` 并确保只读与超时；
  - 返回错误时附带 `preview`（如适用）帮助前端降级展示。
- 扩展查询引擎：优先在 `packages/types` 补齐 AST，再在 `packages/query-engine` 实现与增测。
- UI 表格新列/筛选：在 `SmartGrid.tsx` 保持排序/筛选的一致行为与易读性（对象/数组先 JSON 字符串化再比对）。

## 语言约定

- 聊天对话时：一律使用中文回复。
- 其他场景（代码注释、提交信息、文档、标识符等）：默认使用英文，除非用户特别要求中文。

## 风险与边界

- 高并发 + LATERAL：需限流/超时与结果列聚合（对一对多默认 `count` 或 `json_agg(limit)`）。
- Keyset 跳页语义：UI 采用上一页/下一页，弱化“跳转到第 N 页”预期。
- 索引建议：仅提示不改写，不做任何 DB 侧变更；权限收紧仅出现在运行手册建议中。
