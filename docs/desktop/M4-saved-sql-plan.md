# M4：Saved SQL（Desktop 版）对齐与复用计划

> 目标：让桌面版（Tauri + Vite + React）在“Saved SQL（/queries）”能力上与 Web 版保持高度一致，包括：模板变量、动态列、导入导出、分页与可选总数计算、Explain、枚举选项拉取；同时移除登录/APP_DB 依赖，采用本地 SQLite 与只读 PG 访问。

## 背景与约束

- 桌面版总体目标与阶段划分参考：`docs/desktop/tauri-edition-plan.md`。
- Web 端 /queries 页面前端逻辑与组件已拆分完善，可直接复用/拷贝到 Desktop：
  - 页面：`apps/web/app/queries/page.tsx`
  - 组件：`apps/web/components/queries/*`（EditQueryPanel / RunQueryPanel / VariablesEditor / DynamicColumnsEditor / CalcItemsEditor / SavedQueriesSidebar / SqlEditor / SqlPreviewPanel / ResultsPanel / RuntimeCalcCards / PaginationBar / tree-utils 等）
  - 逻辑库：
    - 模板编译：`apps/web/lib/sql-template.ts`
    - 导入导出：`apps/web/lib/saved-sql-import-export.ts`
- 重要差异（Web → Desktop）：
  - 存储：APP_DB（Postgres）→ 本地 SQLite（`rdv_local.db`）。
  - 调用：`fetch('/api/...')` → 本地 Service/Repository（tauri-plugin-sql）。
  - 会话/权限：移除 Better Auth；PG 访问只读（语法检查 + 只读事务 + LIMIT 强制）。

## 范围（M4）

- Saved SQL 管理：列表、查看、创建、更新、删除/归档。
- 模板变量：定义（类型/默认值/必填/enum + optionsSql）、基于 `{{name}}` 的参数化编译与预览。
- 执行/预览/Explain：
  - 只读 SQL 自动执行；非只读需确认后可执行（不包裹分页）。
  - 分页/计数：包裹 `select * from ({{_sql}}) t limit $n offset $m`；withCount 可行时 `count(*) from ({{_sql}})`。
  - Explain：支持 text/json；`ANALYZE` 仅允许只读。
- 动态列（客户端 JS 计算）与运行时计算卡片（SQL/JS）。
- 导入/导出：兼容 v1（`rdv.saved-sql.v1`）。

## 当前进度（2025-09-16）

- Saved SQL 组件、模板编译与导入导出工具已在桌面端落地，对应服务 `pgExec` / `savedSql` 也已实现并接入 `routes/queries.tsx`。
- 桌面端 `queries` 页面已复用 Web 交互，包含执行、分页、Explain、动态列、运行时计算与导入导出等核心流程。
- 本地 SQLite 迁移脚本 `002_saved_sql.sql` 仍未提交，需要补全建表文件以支撑 Repository。
- 针对 `sql-template` 与 `saved-sql-import-export` 的 Vitest 用例尚未添加，需按 Test First 约定补测。

## 复用清单

- 类型：`packages/types/src/appdb.ts`（SavedQueryVariableDef / DynamicColumnDef / CalcItemDef）。
- 模板编译：`apps/web/lib/sql-template.ts`（compileSql / isReadOnlySelect / renderSqlPreview / extractVarNames）。
- 导入导出：`apps/web/lib/saved-sql-import-export.ts`（Schema v1 + normalize）。
- UI 组件：`apps/web/components/queries/*`（全部）。

## Desktop 侧新建/改造文件（建议路径）

- 数据与执行服务
  - `apps/desktop/src/services/savedSql.ts`：SQLite Repository（list/get/create/update/archive/export/import）。
  - `apps/desktop/src/services/pgExec.ts`：PG 执行封装（executeSavedSql/explainSavedSql/fetchEnumOptions/computeCalcSql）。
- 逻辑库（直接拷贝或软共享）
  - `apps/desktop/src/lib/sql-template.ts` ← 拷贝自 `apps/web/lib/sql-template.ts`。
  - `apps/desktop/src/lib/saved-sql-import-export.ts` ← 拷贝自 `apps/web/lib/saved-sql-import-export.ts`。
- 页面与组件
  - `apps/desktop/src/pages/Queries.tsx`：等价于 `apps/web/app/queries/page.tsx`，将 fetch 改为调用本地 services。
  - `apps/desktop/src/components/queries/*`：从 web 端同名目录完整拷贝。
- SQLite 迁移（仅文档化与文件准备，不在此阶段执行）
  - `apps/desktop/src-tauri/migrations/002_saved_sql.sql`

## SQLite 表结构（本地）

> 存储 Saved SQL 定义与元数据；JSON 字段以 TEXT 形式存放标准 JSON 字符串。

```sql
-- apps/desktop/src-tauri/migrations/002_saved_sql.sql
CREATE TABLE IF NOT EXISTS saved_sql (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  description TEXT NULL,
  sql TEXT NOT NULL,
  variables TEXT NOT NULL DEFAULT '[]',          -- JSON (SavedQueryVariableDef[])
  dynamic_columns TEXT NOT NULL DEFAULT '[]',     -- JSON (DynamicColumnDef[])
  calc_items TEXT NOT NULL DEFAULT '[]',          -- JSON (CalcItemDef[])
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,                    -- epoch millis
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_sql_updated_at ON saved_sql(updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_sql_name ON saved_sql(name) WHERE is_archived = 0;
```

- Repository 层负责 JSON 字段序列化/反序列化与时间戳维护。
- 归档策略：优先软删除（`is_archived=1`），避免误删。

## Service 设计

### 1) `savedSql`（SQLite Repository）

- `list(): Promise<Array<{ id,name,description,variables,createdAt,updatedAt }>>`
- `get(id: string): Promise<{ id,name,description,sql,variables,dynamicColumns,calcItems,isArchived,createdAt,updatedAt }>`
- `create(input: { name, description?, sql, variables, dynamicColumns, calcItems }): Promise<{ id: string }>`
- `update(id: string, patch: Partial<...>): Promise<void>`（含重名校验）
- `archive(id: string): Promise<void>` / `remove(id: string): Promise<void>`（可选实现其一）
- `exportAll(): Promise<SavedQueriesExport>`（v1）
- `import(items, { overwrite: boolean }): Promise<{ added:number; overwritten:number; skipped:number }>`

实现要点：
- 使用 `@tauri-apps/plugin-sql`：`const db = await Database.load('sqlite:rdv_local.db')`。
- 所有写入均参数化；JSON 字段使用 `JSON.stringify`。
- `name` 去空格与重名处理与 Web 保持一致（同名可覆盖需确认）。

### 2) `pgExec`（Postgres 执行封装）

- `executeSavedSql({ savedId, values, userConnId, pagination, allowWrite })`：
  - 加载 Saved SQL → `compileSql()` → 只读判定（`isReadOnlySelect()`）。
  - 只读：支持分页包裹与可选计数；非只读：需要 `allowWrite=true` 且不包裹分页。
  - 预览：总是返回 `renderSqlPreview(compiled, vars)`（用于 UI 显示）。
- `explainSavedSql({ savedId, values, userConnId, format:'text'|'json', analyze?:boolean })`
  - 仅允许只读 SQL 使用 `ANALYZE`。
- `fetchEnumOptions({ userConnId, sql })`
  - 仅允许只读 SQL；取首列非空值，去重保持顺序。
- `computeCalcSql({ savedId, values, userConnId, calcSql })`
  - 支持 `{{_sql}}` 作为子查询引入 Saved SQL 的编译结果。

执行安全网（与 Web 对齐）：
- 语法检查：`isReadOnlySelect()` 仅允许以 `WITH`/`SELECT` 起始。
- 会话守护（只读事务）：
  - `BEGIN READ ONLY;`
  - `SET LOCAL statement_timeout = <env.QUERY_TIMEOUT_DEFAULT_MS (<= MAX)>;`
  - `SET LOCAL idle_in_transaction_session_timeout = <同上>;`
  - `SET LOCAL search_path = pg_catalog, "$user";`
  - 查询执行后 `ROLLBACK`。
- LIMIT 上限：`pageSize <= env.MAX_ROW_LIMIT`；若用户 SQL 含 `LIMIT/OFFSET`，则标记 `countSkipped`。

## UI 对齐与替换点

- 页面 `apps/web/app/queries/page.tsx` 的核心状态机直接复用；将所有 `fetch('/api/...')` 替换为 `savedSql/pgExec` 对应方法：
  - 列表/增改查删：`/api/user/saved-sql` → `savedSql.*`
  - 执行/预览/分页：`/api/saved-sql/execute` → `pgExec.executeSavedSql`
  - Explain：`/api/saved-sql/explain` → `pgExec.explainSavedSql`
  - 枚举选项：`/api/saved-sql/enum-options` → `pgExec.fetchEnumOptions`（支持 `{{var}}` 模板，占位值沿用运行面板中的变量设置）
  - 运行时计算：`/api/saved-sql/compute` → `pgExec.computeCalcSql`
- 连接信息：使用已实现的本地 `user_connections`（M1），页面侧沿用 `useCurrentConnId()` 获取当前连接 ID，并以本地 connections service 获取 `alias/host` 用于显示。

## 测试计划（Test First）

- 单元测试（TS / Vitest）：
  - `sql-template`：变量类型校验、`raw` 插值、`isReadOnlySelect()` 边界、`renderSqlPreview()` 转义。
  - `saved-sql-import-export`：v1 解析、normalize、错误路径（enum options vs optionsSql 约束）。
  - `pgExec` 纯逻辑：分页包裹与计数可行性判断（当用户 SQL 自带 LIMIT/OFFSET 时的 `countSkipped`）。
- 组件测试（关键交互）：
  - 变量编辑与提取、动态列（自动/手动触发）、分页跳转与“仅统计”刷新、Explain text/json 切换。
- E2E（轻量、可后置）：
  - 连接 PG（本地/远程/TLS）；超时/行数上限；非只读确认提示。

## 风险与对策

- 只读保证：双重防线（语法检查 + READ ONLY 事务）。
- 大结果集性能：默认 `MAX_ROW_LIMIT=1000`，支持配置；必要时评估游标/流式（后续）。
- 组件复用成本：保持组件 props 与状态机一致，优先“替换数据源”而非重写组件。
- 跨平台 TLS：沿用 Tauri v2 + plugin-sql 的 PG 能力；必要时后续切到 Rust 命令统一执行以增强控制。

## 执行清单（建议切片）

- [x] 复制 `apps/web/components/queries/*` → `apps/desktop/src/components/queries/*`
- [x] 复制 `apps/web/lib/sql-template.ts` → `apps/desktop/src/lib/sql-template.ts`
- [x] 复制 `apps/web/lib/saved-sql-import-export.ts` → `apps/desktop/src/lib/saved-sql-import-export.ts`
- [x] 新建 `apps/desktop/src/services/savedSql.ts`（SQLite Repository）
- [x] 新建 `apps/desktop/src/services/pgExec.ts`（只读执行器与 Explain/Enum/Compute）
- [x] 新建 `apps/desktop/src/pages/Queries.tsx`（已实际落地为 `apps/desktop/src/routes/queries.tsx`，逻辑与 Web 对齐）
- [ ] 准备 `apps/desktop/src-tauri/migrations/002_saved_sql.sql`（本地迁移脚本文件，尚未找到对应文件）
- [ ] 增补 `sql-template` 与 `import-export` 的 Vitest 用例（desktop 包，尚未新增相关测试）

## 验收标准

- UI/交互与 Web 版 /queries 基本一致：
  - 变量提取/校验、动态列新增/执行、运行时计算卡片、分页与计数、Explain、导入导出。
- 安全：
  - 只读 SQL 自动执行；非只读需确认。
  - pageSize 不得超出 `MAX_ROW_LIMIT`，且默认 LIMIT 生效。
- 本地化：所有 Saved SQL 定义/文件导入导出均不依赖 APP_DB/登录。

---

更新时间：2025-09-15
维护人：Desktop 版负责人
