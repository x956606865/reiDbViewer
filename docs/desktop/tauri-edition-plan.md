# reiDbView Tauri Edition（本地版）开发计划

> 目标：将现有 Web 版（Next.js + API Routes）改造成 Tauri 桌面版，主打本地使用，不再依赖项目自带应用数据库与登录系统；敏感信息与用户数据改为本地安全存储。对目标 PostgreSQL 仅做只读访问。

## 一、范围与非目标

- 目标功能：
  - Schema Explorer（元数据浏览/刷新）。
  - 表数据浏览（分页/排序/筛选/SQL 预览降级）。
  - Saved SQL（变量占位、导入导出、可选分页、动态列）。
  - 运维只读查询（长跑/锁/等待等）与可选 cancel/terminate（需二次确认）。
  - JSON/JSONB 友好渲染与大字段按“路径+范围”增量抓取（逐步实现）。
- 非目标（该分支不包含）：
  - 登录/多用户/服务端会话管理（完全移除 Better Auth）。
  - 应用自带数据库（APP_DB_URL）与任何服务端持久化。
  - 服务端部署与 CI/Infra 改动（桌面版仅本机运行）。

## 二、总体架构与选型

- 宿主与打包：Tauri v2（Rust 后端 + WebView 前端）。
- 前端技术栈：React + Vite（复用 `apps/web/components` 组件与样式体系：Mantine、mantine-react-table、@tanstack/react-query）。
- 数据访问与本地存储：
  - 方案 A（MVP 首选）：`tauri-plugin-sql`（官方插件，基于 SQLx），在前端通过 JS API 直接执行 SQL：
    - 连接 PostgreSQL：`Database.load("postgres://...")`（仅在只读事务中使用）。
    - 本地 SQLite：`Database.load("sqlite:rdv_local.db")` 存储 Saved SQL、连接元数据、Schema 缓存与偏好设置。
  - 方案 B（增强阶段）：Rust `#[tauri::command]` 封装数据库访问与只读会话守护（SQLx/Pool<Postgres>），前端通过 `invoke()` 或 typesafe 桥（tauri-specta/taurpc）调用；更强约束与审计能力。
- 敏感信息保护：
  - 首选使用 OS 原生秘钥库存储 DSN/密码（Rust `keyring` crate），SQLite 中仅保存 `key_ref` 与非敏感元数据。
  - 若秘钥库不可用：使用 AES-256-GCM 本地加密（每设备随机密钥 + 文件权限收紧）。
- 只读与安全守护：
  - 每次执行在只读事务内：`BEGIN READ ONLY; SET LOCAL statement_timeout=...; SET LOCAL idle_in_transaction_session_timeout=...; SET LOCAL search_path='pg_catalog', '"$user"'; ... ROLLBACK;`
  - SQL 白名单校验：允许 `SELECT`/`WITH` 开头；Saved SQL 参数化；返回行数限制（`MAX_ROW_LIMIT`）。
  - Tauri 权限模型最小化：仅启用必须的插件与命令权限（window、dialog、sql、fs 等）。

参考文档：
- Tauri（权限与命令）：tauri v2 permissions（window/tray 等指令可精细 allow/deny）。
- Tauri Plugin SQL：支持 SQLite/MySQL/PostgreSQL，JS 侧 `Database.load()` 与参数占位规则（PG/SQLite 用 `$1..$n`，MySQL 用 `?`）。

## 三、与现有仓库的复用与重构

- 完全复用：
  - `packages/types`（AST/Meta/APP_DB 类型）。
  - `packages/query-engine`（AST→SQL 渲染、Keyset 分页、标识符引用）。
  - 前端组件：`apps/web/components/*`（Mantine Provider、SmartGrid、JsonCell、DataGrid 等）。
- 轻度改造：
  - 将 `apps/web/app/*` 的 Next.js App Router 页面迁移为 Vite + React 路由页面（React Router 或 TanStack Router）。
  - 将原 API 路由（`/api/*`）调用改为：
    - 方案 A：直接通过 `tauri-plugin-sql` 在前端执行（封装一个 `dbClient` 统一入口，提供只读事务/参数化/行数限制）。
    - 方案 B：调用 `invoke('command')` 由 Rust 实现安全网（后续增强）。
  - `apps/web/lib/db.ts` 的 `withSafeSession` 语义迁移到：
    - 方案 A：前端封装的“只读事务执行器”。
    - 方案 B：Rust 侧命令统一包装（推荐最终态）。
- 完全移除：
  - Better Auth 与所有 `/api/auth/*`、`middleware.ts`。
  - APP_DB 相关文件：`lib/appdb.ts`、`lib/appdb-init.ts`、`schema-cache.ts` 中“持久化到 APP_DB”的路径；改为本地 SQLite。

## 四、本地数据模型（SQLite）

> 文件：`sqlite:rdv_local.db`（路径相对 Tauri App 数据目录）。迁移由 `tauri-plugin-sql` 的 `add_migrations()` 驱动。

表结构（草案）：
- `user_connections`
  - `id` TEXT PRIMARY KEY（ULID）
  - `alias` TEXT NOT NULL
  - `driver` TEXT NOT NULL CHECK(driver IN ('postgres'))
  - `host` TEXT, `port` INTEGER, `database` TEXT, `username` TEXT
  - `dsn_key_ref` TEXT NULL  — 指向 OS Keychain 项；二选一
  - `dsn_cipher` TEXT NULL   — 本地密文（AES-256-GCM）
  - `created_at` INTEGER, `updated_at` INTEGER

- `saved_sql`
  - `id` TEXT PRIMARY KEY, `path` TEXT, `name` TEXT, `sql` TEXT NOT NULL
  - `variables_schema` TEXT NULL  — JSON（Zod schema 序列化或自定义）
  - `dynamic_columns` TEXT NULL   — JSON
  - `created_at` INTEGER, `updated_at` INTEGER

- `schema_cache`
  - `conn_id` TEXT, `payload` TEXT NOT NULL — JSON（与 `packages/introspect` 结构兼容）
  - `updated_at` INTEGER
  - 复合主键 (`conn_id`)

- `app_prefs`
  - `key` TEXT PRIMARY KEY, `value` TEXT NULL — JSON

索引：
- `saved_sql(path)`，`saved_sql(updated_at)`；`schema_cache(updated_at)`。

## 五、API/命令映射（从 Web → 桌面）

- Schema：
  - `GET /api/schema/tables` → `schema_cache` 读取（无缓存时调用 PG 自省 SQL 并写入缓存）。
  - `POST /api/schema/refresh` → 执行只读自省 SQL（PG 侧 `pg_catalog`），写入 `schema_cache`。
  - `GET /api/schema/indexes` → 直接生成查询（合并 `pg_indexes` 与 `pg_index`）。
- 查询执行：
  - `POST /api/query/preview` → 仍由 `packages/query-engine` 生成 SQL 文本（本地预览，无执行）。
  - `POST /api/query/execute` → 只读事务执行 SQL；超时/行数限制；失败降级到 `preview`。
- Saved SQL：
  - 列表/创建/更新 → 读取/写入 `saved_sql`。
  - 执行 → 模板编译（TS 侧 `sql-template.ts`）+ 只读检查 + 只读事务执行。
- 运维查询：
  - `GET /api/ops/queries` → 复用 `apps/web/lib/ops/queries.ts` 生成 SQL 并执行。
  - `POST /api/ops/signal` → `pg_cancel_backend`/`pg_terminate_backend`（用户确认 + 只对当前连接）。

## 六、只读会话与超时策略

- 执行器（方案 A：TS 封装；方案 B：Rust 命令）：
  1) `BEGIN READ ONLY;`
  2) `SET LOCAL statement_timeout=$timeout;`
  3) `SET LOCAL idle_in_transaction_session_timeout=$timeout;`
  4) `SET LOCAL search_path='pg_catalog', '"$user"';`
  5) `/* 执行用户查询（SELECT/WITH）*/`
  6) `ROLLBACK;`
- 额外限制：
  - 强制 `LIMIT <= MAX_ROW_LIMIT`（若未指定则自动追加 `LIMIT`）。
  - 多语句拒绝；禁止 `;` 出现在模板外（基本语法检查）。

## 七、关键库与插件（选型结论）

- Tauri（v2）：桌面框架与权限模型。
- `tauri-plugin-sql`：
  - JS API：`Database.load('sqlite:...') | load('postgres://...')`、`execute()`/`select()`；PG/SQLite 参数占位使用 `$1..$n`。
  - Rust 侧可注册 `add_migrations()` 管理 SQLite 架构演进。
- 本地秘钥：`keyring`（OS Keychain 读取/写入），无法可用时退回 AES-256-GCM（Rust `aes-gcm` + `secrecy`）。
- 前端：Mantine、mantine-react-table、@tanstack/react-query。
- 类型校验：Zod（所有前端输入/配置/连接信息）。

## 八、里程碑与 TODO（Test First）

> 进度小结（截至 2025-09-16）
>
> - `apps/desktop` 脚手架已创建（Vite + React + Mantine），基础布局与导航就绪。
> - 集成 `tauri-plugin-sql`（features: sqlite, postgres）并注册本地 SQLite 迁移（4 张表）。
> - 权限最小化已落实：`capabilities/default.json` 基线能力；`capabilities/sql.json` 仅开放 SQL 插件必要能力（包含 `allow-execute` 以支持本地 SQLite 迁移与写入；对 PostgreSQL 的只读约束通过应用层语法检查与 LIMIT 强制实现）。
> - 当前分支：`feat/tauri-edition`（已从主线切出并开展开发）。
> - M2（Schema Explorer）进展：已实现 PG 自省（columns/PK/FK + 合成 DDL）、本地 `schema_cache` 读写与“手动刷新”，完成 Schema/表列表与索引详情 UI；“自省 SQL 生成与结果映射的单测”待补。
> - M3（表数据浏览）进展：已完成 AST→SQL 构建（复用 `packages/types` 与 `packages/query-engine`）、SmartGrid 排序/筛选与 JSONCell 渲染、基本分页与 SQL 预览；只读执行器已提供“只读语句校验 + LIMIT 强制”，事务与超时（SET LOCAL）待补；组件测试待补。
- M4（Saved SQL）进展：桌面端已接入 `sql-template` / `saved-sql-import-export` 与 `savedSql`/`pgExec` 服务，`routes/queries.tsx` 完成执行、分页、Explain、动态列与导入导出联调；对于可能写操作，已在 UI 层弹窗确认；SQLite 建表脚本与相关 Vitest 仍缺失。

- M0 基线分支与脚手架
  - [x] 建立分支 `feat/tauri-edition`（不改动现有 Web 主线）。【已在 `feat/tauri-edition` 分支】
  - [x] 新建 `apps/desktop`：`src-tauri`（Rust）+ `src`（Vite + React + Mantine）。
  - [x] 集成 `tauri-plugin-sql`（features: `sqlite`, `postgres`），注册 SQLite 迁移（四张表）。
  - [x] 前端基础壳：主题、布局、导航、窗口权限最小化。

- M1 本地存储与连接管理
  - [x] 实现 `keyring` 读写，并在 SQLite 中保存 `dsn_key_ref`。
  - [x] 连接管理 UI：新增/测试连接（含 TLS 使用建议）。
  - [ ] 连接管理 UI：编辑连接与别名（待补）。
  - [ ] 输入校验：改用 Zod 进行 DSN/表单校验（当前为轻量校验函数）。
  - [~] 单测：已覆盖 DSN 校验；秘钥读写（使用模拟）待补。

- M2 Schema Explorer
  - [x] 复用 `packages/introspect` 结构，设计/实现 PG 自省 SQL。
  - [x] `schema_cache` 读写策略（过期或手动刷新）。
  - [x] UI：schema/table 列表与索引详情。
  - [ ] 单测：自省 SQL 生成与结果映射。

- M3 表数据浏览
  - [x] 复用 `packages/types` + `packages/query-engine` 构建 AST→SQL。
  - [~] 只读执行器封装（事务 + 超时 + LIMIT）。
  - [x] UI：SmartGrid（排序/筛选），JSONCell 渲染。
  - [ ] 组件测：分页/排序/筛选行为一致性。

- M4 Saved SQL（模板/动态列/导入导出）
  - [x] 迁移 `sql-template.ts` 并在执行写操作前弹窗确认。【`apps/desktop/src/lib/sql-template.ts` 已落地，`routes/queries.tsx` 遇到写语句时要求用户确认】
  - [x] `saved_sql` CRUD + 运行；导入/导出 JSON（沿用当前 schema v1）。【`apps/desktop/src/services/savedSql.ts` / `pgExec.ts` 已实现并在 `routes/queries.tsx` 调用】
  - [ ] 单测：模板编译只读校验；导入规范化。

- M5 运维只读查询与信号
  - [x] 复用 `apps/web/lib/ops/queries.ts` 生成 SQL 并执行。【新增 `packages/ops` 导出 `buildOpsQuery`，桌面端 `apps/desktop/src/services/ops.ts` 复用并通过 `withReadonlySession` 只读执行】
  - [x] `pg_cancel_backend`/`pg_terminate_backend` 操作（危险操作二次确认 + 记录审计摘要到本地）。【`apps/desktop/src/routes/ops.tsx` 中终止动作需确认；`apps/desktop/src/services/ops.ts` 通过 `withWritableSession` 执行并写入本地 `ops_audit`（见迁移 version 2）】
  - [~] UI：进程/锁视图与快速过滤。【基础界面就绪（连接切换、分钟/行数筛选、结果表 + signal 操作），后续需补充更细粒度的列筛选与审计记录查看】

- M6 安全与稳定性加固
  - [x] 为主窗口 capability 去掉 `core:default` 聚合，仅保留 app/version、event emit/listen 以及窗口显隐/关闭权限。
  - [x] `sql-minimal` capability 仅保留 `sql:allow-load/select/execute`。
  - [ ] `secrets-minimal` 仅暴露 `set_secret`/`get_secret`/`delete_secret` 自定义命令。（待引入自定义 permission manifest，当前暂用 `core:default` 兜底）
  - [ ] `pnpm --filter @rei-db-view/desktop tauri dev` 自检并记录如需额外权限的日志。
  - [ ] 大 JSON 增量抓取 `/api/json/chunk` 的桌面等价（按路径+范围分页）。
  - [ ] 跨平台 TLS（Postgres 连接 `rustls` 首选，必要时 fallback `native-tls`）。
  - [ ] 崩溃恢复与错误上报（本地日志）。

- M7 打包与分发
  - [ ] macOS/Windows/Linux 打包与签名配置。
  - [~] GitHub Actions 多平台打包流水线（`desktop-bundles`，tag/手动触发 + Artifact 上传）。
  - [ ] 更新检查（可选，默认关闭；尊重离线需求）。
  - [ ] 文档与上手指引。

## 九、测试策略

- 单元测试：
  - TS：保留并扩展现有 `vitest` 测试（query-engine、ops SQL 生成、DSN 校验）。
  - Rust：只读事务执行器（若采用方案 B）、密钥读写降级逻辑、SQLite 迁移。
- 组件/交互测试：
  - 表格排序/筛选/分页行为；Saved SQL 动态列渲染。
- 手工/E2E（轻量）：
  - 跨平台连接 PG（本地/远程/TLS）；超时/行数限制验证；取消查询行为。

## 十、风险与应对

- DSN 安全存储：优先 OS Keychain；失败时本地加密并清晰提示安全等级。
- 只读保证：双重防线（语法检查 + 只读事务），并强制 LIMIT。
- 跨平台 TLS：优先 `rustls`，在企业环境下提供 `native-tls` 备选。
- 大结果集性能：默认 LIMIT=1000，可配置；必要时流式/游标（后续评估）。
- 组件复用成本：Next.js 页面迁移为 Vite 路由，尽量保持组件 API 不变。

## 十一、落地细节与目录草案

```
apps/
  desktop/
    src/                 # React + Vite 前端（Mantine Provider/路由/页面）
    src/lib/dbClient.ts  # tauri-plugin-sql 只读执行封装（方案 A）
    src/lib/keyring.ts   # 秘钥读写封装（keyring + 降级 AES-GCM）
    src/routes/*         # schema / browse / queries / connections / ops
    src/components/*     # 复用/补齐
    src-tauri/
      src/main.rs        # 注册插件、权限、迁移
      Cargo.toml
packages/
  query-engine/          # 复用
  types/                 # 复用
```

## 十二、迁移清单（逐项）

- [ ] 去除 Web 登录/中间件与 APP_DB 依赖；保留类型与 SQL 生成。
- [ ] 统一数据访问入口（`dbClient`/`invoke`），替换所有 `/api/*` 调用点。
- [ ] 本地 SQLite 迁移：建表/迁移、存取 API、导入导出工具。
- [ ] 连接管理：Keychain 优先，AES-GCM 兜底。
- [ ] Schema Explorer：缓存策略 + 手动刷新。
- [x] Schema Explorer：缓存策略 + 手动刷新。
- [ ] 浏览页：Keyset/Offset 分页一致性（复用现有逻辑）。
- [ ] Saved SQL：v1 JSON 兼容；动态列在客户端计算。
- [ ] Ops：查询与信号；严格二次确认与日志。
- [ ] 大 JSON 抓取：分片接口与 UI 抽屉（桌面等价）。
- [~] 打包脚本与跨平台验证（CI 工作流 scaffold，待补本地 smoke 与签名说明）。

---

附：关键参考（节选）
- Tauri v2 权限模型与命令：窗口/托盘等指令可显式 allow/deny；最小权限配置。
- `tauri-plugin-sql`：支持 `sqlite:`、`postgres://` 连接；JS API `Database.load()`、`execute()`；PG/SQLite 参数占位 `$1..$n`；可在 Rust 侧注册迁移。
- TanStack Query/Mantine/mantine-react-table：前端 UI 与数据获取层与现有实现一致，可平滑迁移至 Vite。
