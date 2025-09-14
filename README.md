# reiDbView

一个“读优先”的 Postgres Web 浏览器：专注清晰表格视图、JSON/JSONB 友好渲染、可视化 Schema 与只读查询执行；支持“常用 SQL 模板（含变量）”与客户端“动态列”计算。

## 特性

- **只读安全**：执行查询时强制 `BEGIN … ROLLBACK`，设置 `statement_timeout`/`idle_in_transaction_session_timeout`，`search_path=pg_catalog,"$user"`；仅允许 `SELECT/WITH`。
- **连接管理**：用户自有数据库连接，DSN 以 AES‑256‑GCM 加密保存于“应用数据库”（APP_DB）；前端仅保存连接记录 ID。
- **安装引导**：`/install` 检测 APP_DB 初始化状态，生成初始化 SQL；已初始化但缺少新列/索引时展示“升级 SQL”。
- **Schema Explorer**：列出数据库/Schema/表与合成 DDL，支持一键“浏览数据”。
- **数据浏览**：`/browse/[schema]/[table]` 提供分页、排序、简单筛选（文本/数值/JSON 路径与包含）与 SQL 预览降级；权限不足时展示详细错误（如 `permission denied for …`）。
- **索引查看器**：Schema 页面“查看索引”弹窗，展示索引列表、方法、PK/UNIQUE/PARTIAL/VALID 标记、扫描次数与读/返元组计数（`pg_stat_all_indexes`）、大小与定义。
- **常用 SQL**：新增/编辑/删除保存的 SQL 模板，支持“变量默认值”与“运行参数”分离、同名覆盖确认、树状文件夹管理（名称用 `/` 作为路径）。
- **动态列（客户端）**：以 JS 函数在浏览器端对查询结果逐行计算新增列，函数签名 `(row, vars, helpers) => any`，内置 `helpers.fmtDate/json` 等。
- **登录集成**：使用 Better Auth（email+password），表结构与 schema/prefix 可通过 `/install` 生成 SQL 自行初始化。

## 要求

- Node.js 20 LTS
- pnpm（monorepo）
- PostgreSQL（应用库 + 用户自有库）

## 快速开始

- 安装依赖

```bash
pnpm -w install
```

- 本地开发（Web）

```bash
cd apps/web
pnpm dev
```

- 类型检查 / 测试

```bash
pnpm typecheck
pnpm test
```

## 环境变量（apps/web/.env.local）

- `APP_DB_URL`：应用数据库（保存用户/连接等元数据）。例如：`postgres://user:pass@host:5432/app?sslmode=require`
- `APP_DB_SCHEMA`：应用库 schema（默认 `public`）
- `APP_DB_TABLE_PREFIX`：应用表前缀（默认 `rdv_`）
- `APP_ENCRYPTION_KEY`：32 字节 base64，用于加解密 DSN
- 可选：`QUERY_TIMEOUT_DEFAULT_MS`、`QUERY_TIMEOUT_MAX_MS`、`MAX_ROW_LIMIT`

## 初始化（APP_DB）

- 访问 `/install`：
  - 未初始化：显示“建议执行的 SQL”（包含 `users/accounts/sessions/verification_codes/user_connections/schema_cache/saved_queries` 等表），复制到 APP_DB 执行后“我已执行，重新检测”。
  - 已初始化但有升级项：显示“升级 SQL”（例如为已存在的 `rdv_saved_queries` 表新增 `dynamic_columns` 列的 ALTER 语句）。
- 规则（重要）：凡新增 APP_DB 表或对现有表做结构调整（新增列/索引等），必须同步更新安装检测：
  1) `apps/web/lib/appdb-init.ts`：更新 `expectedTableNames()`、在 `renderInitSql()` 加完整建表 SQL；若为“新增列/索引”，在 `checkInitStatus()` 增加检测与 `ALTER` 拼接（并向 `warnings` 写提示）。
  2) `/install` 页面需展示 `warnings` 并提供包含 `ALTER` 的 `suggestedSQL`。
  3) 相关 API 发现缺列/缺表时返回 `501 feature_not_initialized` 并附 `suggestedSQL` 兜底。

## 页面导航

- `/install`：APP_DB 初始化/升级引导（仅生成 SQL，不会自动执行）
- `/connections`：新增连接（别名+DSN）、设置当前连接（前端保存当前连接 ID）
- `/schema`：Schema Explorer；每张表支持“查看索引”和“浏览数据”
- `/browse/[schema]/[table]`：只读数据浏览（分页/排序/筛选/SQL 预览）；失败时展示详细 DB 错误 message
- `/queries`：常用 SQL 模板
  - 变量：默认值（定义时存储）与运行参数（执行前填写）分离
  - 同名覆盖：保存/更新时检测重名，弹窗确认后覆盖；支持“另存为/新建/删除（软删除）”
  - 树形管理：名称以 `/` 组织为“文件夹”（展开状态保存在 `localStorage`）
  - 动态列：按行执行 JS 函数扩展列，运行在浏览器端

## API 速览（App Router）

- 初始化
  - `GET /api/appdb/init/status?schema=&prefix=`
- 用户连接
  - `GET/POST /api/user/connections`
- 模板 SQL
  - `GET/POST /api/user/saved-sql`
  - `GET/PATCH /api/user/saved-sql/:id`
  - `POST /api/saved-sql/execute`（仅 `SELECT/WITH`；`previewOnly` 支持仅编译）
- 查询引擎（AST → SQL）
  - `POST /api/query/preview`
  - `POST /api/query/execute`（只读会话；401/501/错误时返回 preview）
- Schema
  - `GET /api/schema/tables`（读取缓存或 mock）
  - `POST /api/schema/refresh`（拉取真实元数据并缓存）
  - `GET /api/schema/indexes?schema=&table=&userConnId=`（索引 + 统计 + 定义）

## 安全模型

- **只读事务**：`withSafeSession(client)` 包裹，执行后一律 `ROLLBACK`；设置 per‑request 超时；`search_path` 收窄。
- **参数化**：常用 SQL 的变量编译为 `$1,$2,…`；避免注入。
- **DSN 安全**：连接串加密存储；前端仅保存 ID；后端按 `userId+connId` 动态解密建池。
- **动态列**：仅在浏览器端执行用户提供的 JS，永不回传/执行于服务端或数据库。

## 开发规范（简版）

- Test First：查询引擎优先单测/属性测；UI 交互写组件测试。
- Zod 校验：所有请求体/参数的输入校验。
- 搜索工具：`rg`；TS/TSX 结构搜索：`ast-grep`。
- 变更约束：
  - 不改 CI/Infra 与敏感配置（.env/密钥）；不提交 secrets。
  - 不做任何数据库迁移/写库操作（仅生成 SQL 供用户手动执行）。
  - 若涉及 APP_DB 表结构变更，务必同步 `/install` 检测与文档（见“初始化”）。

## 已知注意事项

- 常用 SQL 名称目前未在 DB 层强制唯一，前端已做覆盖确认与软删除；如需彻底约束，可在 APP_DB 添加唯一（可选）：

```sql
-- 不区分大小写且排除已归档
CREATE UNIQUE INDEX IF NOT EXISTS "rdv_saved_queries_user_name_ci"
  ON "<schema>"."<prefix>saved_queries"(user_id, lower(name))
  WHERE is_archived = false;
```

- 动态列运行在浏览器端；请仅输入可信任的函数代码。
- 部分统计（pg_stat_all_indexes）需要数据库具备相应 catalog 视图权限；权限不足时会返回详细错误 message。

## 目录结构

```
.
├─ apps/web                  # Next.js App Router
│  ├─ app/api/...            # /schema, /query, /user, /appdb, /saved-sql
│  ├─ app/queries            # 常用 SQL 页面
│  ├─ app/schema             # Schema Explorer 页面
│  ├─ app/browse/[s]/[t]     # 表数据浏览
│  └─ lib                    # appdb/crypto/auth 等工具
├─ packages/types            # AST/应用类型定义
└─ docs                      # 设计方案 & 使用文档
```

## 路线图（建议）

- 表数据页加入“查看/导出 EXPLAIN”与“示例查询”。
- 动态列沙箱（Web Worker + 超时终止）。
- 更丰富的 JSON 过滤器与 UI。
- Saved SQL 的标签/分享/审计记录。

