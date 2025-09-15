# Saved SQL 功能（只读）

本功能允许用户保存常用 SQL，并在运行前通过表单填入变量值。所有执行均在用户自有连接上以只读会话运行（`ROLLBACK`），并设置 `statement_timeout` 等安全参数。

## 初始化数据表（应用数据库 APP_DB_URL）

若首次使用，API 将返回 501 并附带建表 SQL，或手动使用以下 SQL（默认 schema 与前缀由 `APP_DB_SCHEMA` / `APP_DB_TABLE_PREFIX` 控制，默认 `public.rdv_`）：

```sql
-- Saved Queries table (per-user)
CREATE TABLE IF NOT EXISTS "public"."rdv_saved_queries" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "public"."rdv_users"(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  description TEXT,
  sql TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "rdv_saved_queries_user" ON "public"."rdv_saved_queries"(user_id);
```

## 占位符与类型

- 占位符语法：`{{name}}`，同名变量多处使用会映射为同一个 `$n` 参数。
- 变量类型：`text | number | boolean | date | timestamp | json | uuid | raw`。
- `raw`：将传入值原样内联到 SQL 文本（不做参数化）。谨慎使用，仅用于列名/排序片段等安全位置；执行仍在只读事务中并且仅允许 `SELECT/WITH` 开头，但内联文本可能导致语法错误或注入风险，请勿拼接来自不可信输入的表达式。
- 只允许 `SELECT` 或 `WITH` 开头的查询。

## API（App Router）

- `GET /api/user/saved-sql`：列出我的查询（若缺表返回 501 + `suggestedSQL`）。
- `POST /api/user/saved-sql`：创建。
- `GET /api/user/saved-sql/:id`：详情。
- `PATCH /api/user/saved-sql/:id`：更新（软归档等）。
- `POST /api/saved-sql/execute`：编译+执行；Body: `{ savedQueryId, values, userConnId, previewOnly? }`。

## 前端页面

- 路径：`/queries`（导航已有入口）。
- 支持：列表、编辑/新增、变量编辑、提取变量、预览 SQL、执行并用 DataGrid 展示结果。

### 导入/导出

- 导出：左侧抽屉点击“导出全部”，下载 JSON 文件（格式 `rdv.saved-sql.v1`）。
- 导入：点击“导入”选择上述 JSON；可选择遇到同名时“覆盖”或“跳过”。
- 文件结构（v1）：

```json
{
  "version": "rdv.saved-sql.v1",
  "exportedAt": "2025-09-14T10:00:00.000Z",
  "items": [
    {
      "name": "reports/daily/top_users",
      "description": "Top users by score",
      "sql": "SELECT * FROM users WHERE created_at >= {{from}}",
      "variables": [{ "name": "from", "type": "timestamp", "required": true }],
      "dynamicColumns": [{ "name": "fullName", "code": "return `${row.first_name} ${row.last_name}`" }]
    }
  ]
}
```

注意：导入/导出均不涉及数据库结构变更；若首次使用未初始化 `rdv_saved_queries`，按页面提示执行 SQL 后再重试。

## 安全

- 执行端口：使用参数化（`$1,$2,...`）替换占位符，避免注入。
- 只读会话：`SET LOCAL statement_timeout` / `idle_in_transaction_session_timeout`，并 `ROLLBACK`。
- 输入校验：所有 API 使用 `zod` 校验；用户连接 ID 来自受保护的应用库。
