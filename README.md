# reiDbView

一个“读优先”的 Postgres Web 浏览器：专注清晰表格视图、JSON/JSONB 友好渲染、可视化 Schema 与只读查询执行；支持“常用 SQL 模板（含变量）”与客户端“动态列”计算。

## 使用

可直接在 release 中下载软件版

## 特性

- **只读安全**：主打各种读取展示，如果有涉及修改数据的操作，会弹窗提示。
- **连接管理**：用户自有数据库连接，DSN 以 AES‑256‑GCM 加密保存于“应用数据库”（APP_DB）；前端仅保存连接记录 ID。
- **Schema Explorer**：列出数据库/Schema/表与合成 DDL，可以快速查看相关索引以及索引触发的次数，确定索引是否在生效中，以及当前所以占用大小

- **常用 SQL**：新增/编辑/删除保存的 SQL 模板，支持“变量默认值”与“运行参数”分离，像使用 api 工具一样使用 sql
  - sql 模版默认树形展示，方便层级管理
  - sql 模版支持变量定义，在运行时再赋值，如同使用 api 一般
  - 支持添加动态列，填入一个回调函数，函数可以接受到当前行所有数据，然后进行处理输出
  - 支持添加“计算数据”，通过自定的附加 sql 或者 js 函数，展现包括总数、特定类型数据的数量等等自定义的计算数据展示
- **登录集成**：使用 Better Auth（email+password），不同账户管理自己的 sql 与数据库

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

或者：

```bash
pnpm --filter @rei-db-view/web dev
```

- 类型检查 / 测试

```bash
pnpm typecheck
pnpm test
```

## Docker / Compose 一键运行

```bash
BETTER_AUTH_SECRET="$(openssl rand -base64 32)" docker compose up --build -d
```

## 环境变量（apps/web/.env.local）

- `APP_DB_URL`：应用数据库（保存用户/连接等元数据）。例如：`postgres://user:pass@host:5432/app?sslmode=require`
- `APP_DB_SCHEMA`：应用库 schema（默认 `public`）
- `APP_DB_TABLE_PREFIX`：应用表前缀（默认 `rdv_`）
- `APP_ENCRYPTION_KEY`：32 字节 base64，用于加解密 DSN
- `BETTER_AUTH_SECRET`:32 字节 base64，用于 better auth
- `BETTER_AUTH_TRUSTED_ORIGINS`:better auth 允许的登录 origin，示例：http://localhost:3000,http://127.0.0.1:3000
- 可选：`QUERY_TIMEOUT_DEFAULT_MS`、`QUERY_TIMEOUT_MAX_MS`、`MAX_ROW_LIMIT`

## 初始化（APP_DB）

- 访问 `/install`：

## 页面截图

| 直接查看 JSON 数据                               | 集成常见运维 SQL                                      | 简单添加动态列                             | 自定义计算数据                             |
| ------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| ![直接查看 JSON 数据](pics/直接查看json数据.png) | ![直接集成常见运维 SQL](pics/直接集成常见运维sql.png) | ![简单添加动态列](pics/简单添加动态列.png) | ![自定义计算数据](pics/自定义计算数据.png) |

| 轻松编辑 SQL 模版                              | 方便的运行工具                             | 查看索引大小与调用次数                                     | 简单添加计算数据                               |
| ---------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------- |
| ![轻松编辑 SQL 模版](pics/轻松编辑sql模版.png) | ![方便的运行工具](pics/方便的运行工具.png) | ![查看索引大小与调用次数](pics/查看索引大小与调用次数.png) | ![简单添加计算数据](pics/简单添加计算数据.png) |

## 页面导航

- `/install`：APP_DB 初始化/升级引导（仅生成 SQL，不会自动执行）
- `/connections`：新增连接（别名+DSN）、设置当前连接（前端保存当前连接 ID）
- `/schema`：Schema Explorer；每张表支持“查看索引”和“浏览数据”
- `/browse/[schema]/[table]`：只读数据浏览（分页/排序/筛选/SQL 预览）；失败时展示详细 DB 错误 message
- `/queries`：常用 SQL 模板

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
