---
title: reiDbView 开发方案（v0.1 草案）
owner: you + Codex
status: draft
lastUpdated: 2025-09-11
---

# reiDbView 开发方案（v0.1 草案）

> 目标：构建一个“读优先”的数据库数据浏览器，主打清晰高效的表格视图、对 JSON/JSONB 等复杂列的友好渲染，以及可视化多表 Join 的查看与探索能力。

> 范围确认（2025-09-11）：首发仅支持 PostgreSQL 与 Web（Next.js）形态；查询超时为可配置项；视图保存先落地“浏览器存储”，文件导出/导入列为下一阶段 TODO。
>
> 审计采纳（v1）：
> - Lookup 列优先采用 LATERAL 子查询实现与复用；
> - 默认优先使用 Keyset 分页（存在稳定唯一排序键时），Offset 作为回退；
> - JSONB 过滤语义模板化（exist/contain/path_exists），并提供索引友好写法提示；
> - 引入列级敏感度标注与默认掩码；
> - 双连接池（元数据/数据）与每请求 SET LOCAL 安全收敛；
> - JSON 大字段按路径分页渐进加载。

> 多数据库连接（2025-09-11 增补）：
> - 服务器端白名单：`DATABASE_URL_RO`（默认）或 `RDV_CONN_IDS=prod,staging` + `DATABASE_URL_RO__prod`、`DATABASE_URL_RO__staging`；
> - 客户端仅保存“连接别名→连接ID”的映射（localStorage/IndexedDB），不保存连接串；
> - API 接口通过 `connId` 选择连接池；
> - 审计将记录 `connId` + AST hash + 行数分档。

## 1. 产品定位与价值主张

- 清晰直观：提供高密度信息的表格视图，列格式化（时间、金额、布尔、枚举、JSON）一目了然。
- 复杂结构友好：JSON/JSONB 列可树形展开、路径筛选、JSONPath 取值、差异高亮。
- 关系探索高效：可视化 Join 构建器（基于 FK 与命名约定推断关系），点击即可拼接查询并预览 SQL。
- 安全可控：只读访问、参数化查询、列白名单、查询限流/超时，默认“安全默认值”。
- 工程可扩：核心能力模块化（Schema 元数据、查询引擎、UI DataGrid、Join Builder、格式化器插件）。

## 2. 目标用户与典型场景

- 数据/后端工程师：临时排障、检查生产数据；需要快速拼接 Join、定位异常记录。
- 分析/产品/运营：无需写 SQL，也能筛选、排序、导出（受限条数）并保存视图配置。
- 内部工具/运维：以“视图”为单位共享、复用查询，形成团队知识库。

## 3. 核心功能（MVP → 增强）

1) 表格浏览（MVP）
- 服务器端分页、排序、筛选；列投影（选择列）；虚拟滚动；粘性列。
- 列类型感知渲染（时间/时区、数字/千分位、布尔、枚举、JSON）。

2) JSON/JSONB 专项体验（MVP）
- 树形折叠展开、懒加载大字段、键路径 Breadcrumb；键值复制；JSONPath/键路径筛选。
- 预览截断 + 全量展开；大对象支持“按路径增量抓取”。

3) 关系/Join 可视化（M2-M3）
- 自动从 `pg_catalog`/`information_schema` 与命名约定（`xxx_id`）推断关系图。
- 图形化选择表与关系、Join 类型（INNER/LEFT）、On 条件，实时预览 SQL 与结果。
- 冲突/重复列自动别名（`table__column`），列分组显示，可一键“收纳某表列”。

3.5) 视图内“即时 Join 加列”（Lookup Column）（M2.5 → M3 扩展）
- 在当前视图中，通过 UI 从其他表选择一列注入到结果集，底层优先采用 LATERAL 子查询实现（可复用、避免重复 JOIN）；必要时回退到标准 LEFT/INNER JOIN。
- MVP 聚焦“一对一/多对一”关系（如 `orders.user_id -> users.id`）；一对多在 M3 支持聚合（计数、拼接、JSON 聚合）。

4) 视图保存与分享（M3-M4）
- 浏览器侧持久化（IndexedDB/localStorage）保存“表/列/筛选/排序/Join/布局”。
- 视图参数化（如日期范围、关键字）。
- 文件导出/导入（JSON 清单，含版本与校验）列入下一阶段 TODO（M4.5）。

5) 导出（增强）
- 数据导出（CSV/流式）延后到稳定性阶段再评估（见里程碑 M5+）。

6) 安全与治理（贯穿）
- 只读 DB 角色、参数化查询、列白名单、最大行数/查询超时、审计日志（谁在看什么）。

## 4. 技术架构（读优先、Web 优先）

- 运行形态：
  - 首发 Web 应用（自托管或本地运行）。后续可评估 Tauri/桌面封装。
  
- 前端：
  - React + TypeScript；Next.js（App Router）
  - 表格：TanStack Table + 虚拟滚动（`@tanstack/react-virtual`）
  - JSON 视图：`react-json-tree` 或 `react-json-view`（二选一，以体积与交互为准）
  - Join Builder/ER 图：`@xyflow/react`（React Flow）
  - 数据请求：`@tanstack/react-query`

- 服务端：
  - Node.js + TypeScript（Next.js Route Handlers 或独立 Fastify/Express，MVP 优先集成在 Next）
  - 数据访问：`pg` + 自研轻量查询构建/AST；或 Kysely（更结构化、便于多方言扩展）
  - 校验：`zod`（入参校验）
  - 日志：`pino`
  - 防护：`helmet`、简单速率限制（如 `rate-limiter-flexible`）

- 数据库与适配层：
  - 首发仅支持 PostgreSQL（重点 JSONB 能力）。
  - 抽象 DataConnector 接口（`introspect() / query(ast) / previewSQL(ast)`），后续接 MySQL/SQLite。

- 配置与密钥：
  - 环境变量：
    - `DATABASE_URL_RO`
    - `QUERY_TIMEOUT_DEFAULT_MS`（默认 5000）
    - `QUERY_TIMEOUT_MAX_MS`（默认 10000，用于限制前端可调上限）
    - `MAX_ROW_LIMIT`（默认 1000）
    - `ALLOWED_ORIGINS`
  - 前端可在安全范围内（≤ `QUERY_TIMEOUT_MAX_MS`）对单视图/单查询设置超时；超出即回退到最大值。
  - 数据库会话安全收敛（每请求）：`SET LOCAL statement_timeout`、`SET LOCAL idle_in_transaction_session_timeout`、最小化 `search_path`（`pg_catalog, "$user"`）。
  - 禁止将密钥写入仓库；本地以假密钥跑集成测试。

```
┌──────────────┐    HTTP/WS    ┌────────────────────┐
│  Web Client  │ ───────────▶ │ Query API (Next)   │
│  (Next.js)   │ ◀─────────── │  - zod 校验        │
└──────▲───────┘               │  - AST→SQL 生成    │
       │                       │  - 限流/超时       │
       │ React Query           └─────────┬──────────┘
       │                                  │
       │                                  ▼
       │                          ┌───────────────┐
       │                          │ PostgreSQL RO │
       └──────────────────────────│  (pg_catalog) │
                                  └───────────────┘
```

## 5. Schema 元数据与关系推断

- 元数据来源：
  - `pg_catalog.pg_class / pg_attribute / pg_type / pg_constraint / pg_namespace` 等
  - `information_schema`（跨兼容字段）

- 关系构建：
  - 以 FK 为主，并结合列名约定（`<table>_id`）补全弱关系建议。
  - 生成“关系图”和“可选 join 列表”（含 join 类型建议）。

- 列类型映射：
  - 时间（`timestamp[tz]`）→ 本地/UTC 切换；数值（`numeric`）→ 千分位/小数位；
  - JSON/JSONB → 树形组件；数组类型 → 列中以 tag/折叠渲染。

## 6. 查询模型（AST）与 SQL 生成

- AST 组成：`Select{ columns[], from, joins[], where[], orderBy[], limit, offset }`
- 参数化：所有谓词使用占位符（`$1..$n`），值分离，防注入；列名/表名仅允许白名单（来自 introspection）。
- 别名策略：避免列名冲突，`<table>__<column>` 作为默认别名并回显到前端列头。
- 计数与分页：单独生成 `COUNT(*)` 查询；默认优先 Keyset 分页（存在稳定唯一排序键时），Offset 作为回退。
- 超时与资源控制：
  - 服务器端强制超时（默认 `QUERY_TIMEOUT_DEFAULT_MS`，上限 `QUERY_TIMEOUT_MAX_MS`），行数上限（如 1000），对 LIKE/ILIKE 做前缀索引提示但不自动改写。

### 6.1 Keyset 分页（默认优先）

- 前提：存在稳定唯一排序键（优先使用主键；多列排序时追加主键兜底）。
- 语义：基于上页最后一行的排序键生成 `>`/`<` 谓词；Offset 仅在无法满足前提时回退。
- Cursor：`{ last: Record<col, value> }`；排序方向影响比较符。

### 6.2 即时 Join 加列（Lookup Column）模型

- 术语：`LookupColumn = { fromTable, toTable, on: Eq(colA,colB), type: 'LEFT'|'INNER', pick: [toColumn|agg], alias }`
- 映射到 AST：在 `Select.columns[]` 中加入形如 `Computed{ expr: ColumnRef('toTable.toColumn') | Agg(JSON_AGG/COUNT/STRING_AGG), viaJoinId }`；对应 `joins[]` 中维护去重后的 Join 定义（同条件复用）。
- 别名与冲突：`<toTable>__<column>` 作为默认别名；重复 alias 自动加后缀数字。
- 基数处理：
  - 一对一/多对一：直接映射目标列。
  - 一对多：默认聚合为 `json_agg`（受上限控制），或 `count(*)`/`string_agg(text, ',')`；由 UI 选项决定。
- 结果回显：DataGrid 中将 Lookup 列以“来源表标记+别名”显示，可展开查看聚合内容（JSON/数组）。

### 6.3 Lookup → LATERAL 渲染策略

- 将单个 Lookup 转换为 `LEFT JOIN LATERAL (SELECT /* pick/agg */ FROM toTable WHERE on /* + LIMIT 或聚合 */) AS lc_<id> ON TRUE`；`SELECT` 中引用 `lc_<id>.<alias>`。
- 具名 Join Registry：以（toTable + on + pick/agg）签名做去重复用；冲突时提升为标准 JOIN。
- 与安全：所有标识符白名单校验，值参数化；禁止 LATERAL 子查询中拼接原始文本。

### 6.4 JSONB 过滤语义模板

- 三类模板：
  - 存在性：`col ? 'key'` / `col ?| array['k1','k2']`
  - 包含：`col @> '{"k":"v"}'::jsonb`（配 GIN/jsonb_path_ops）
  - 路径存在：`jsonb_path_exists(col, '$.a.b ? (@ == "v")')`（建议表达式索引）
- UI 以模板引导并提示可索引写法；自由组合场景需额外警告与超时更严格阈值。

## 7. 前端交互与信息架构（IA）

- 左侧：Schema Explorer
  - 搜索表/列；点击进入数据视图；显示关系与索引提示。
- 顶部：Query Bar
  - 表选择、列选择、筛选/排序、快速条件（如“近 7 天”）；“预览 SQL”开关。
- 主区：DataGrid
  - 虚拟滚动、列宽/顺序/冻结、单元格渲染器（日期/金额/布尔/JSON）。
  - JSON 单元格：预览→抽屉全量→路径筛选/复制；可对选中键生成筛选条件。
- 右侧：Join Builder（可折叠）
  - 图形节点为表；边为关系；选中边配置 Join 类型与条件；实时预览影响列。
- Row Detail Drawer（增强）
  - 显示该行涉及的引用记录（FK 跳转），JSON diff/格式化复制。

### 7.1 即时 Join 加列（Lookup Column）交互
- 触发方式：DataGrid 顶部“添加列”→ “来自其他表…”。
- 选择关系：
  - 自动推荐基于 FK 的关系；也可手动指定 `from.col = to.col`。
  - 仅允许通过已知关系路径的表（白名单），防止任意笛卡尔积。
- 选择列/聚合：
  - 一对一：选择 `toTable.column`。
  - 一对多：选择聚合策略（`count`/`string_agg`/`json_agg(limit=N)`）。
- 预览：右侧展示生成的 SQL 片段与估计耗时（基于采样/阈值提示），超过阈值提示降采样或添加筛选。
- 注入结果：在列头以来源表标识与 alias 呈现；支持一键移除（同步移除对应 join，若无其他列依赖）。

### 7.2 可达路径与深度控制
- 仅允许沿 FK 与命名约定推断出的可达表；默认最大 3 跳，可配置；UI 随跳数显示性能风险徽标。

### 7.3 键盘优先与可达性
- 提供快捷键面板（`?`）：列搜索、冻结/解冻、添加 Lookup、切换 JSON 展开层级等。

## 8. 安全设计（默认安全）

- 只读：使用只读 DB 连接用户，不进行任何写操作。
- 输入校验：所有 API 入参经 `zod` 校验；表/列/排序字段基于白名单校验。
- 注入防护：仅参数化查询，禁止拼接字面量；标识符严格引用（`"schema"."table"`）。
- 资源限制：超时、行数上限、并发/频率限制；异常与慢查询日志。
- CORS：显式 `ALLOWED_ORIGINS`；Cookie 仅限必要场景；默认不启用第三方资源。
- 审计：记录“谁在何时查看了哪些表/视图/条件”（脱敏后）。
  - 审计最小集合：记录用户、时间、目标（表/列/joinsHash）、参数摘要与返回行数分档（如 `<100`/`100-1k`/`1k-10k`/`>10k`）；不落盘 SQL 原文，使用 AST hash。
  - 敏感列：在元数据上标注 `sensitivity: public|internal|restricted`；UI 默认掩码（如邮箱仅显示后 4 位），临时揭示需二次确认并写审计。
  - 数据库最小权限建议（运行手册中执行）：撤销 `CREATE/TEMP/EXECUTE(非白名单)`、`SET ROLE`；禁止 FDW/dblink/COPY PROGRAM。应用侧不可越权，仅做“建议”。
  - 多连接白名单：服务端以环境变量配置连接池白名单；客户端只传 `connId`，永不看到连接串。

## 9. 测试策略（Test First）

- 单元测试：
  - AST→SQL 生成的快照与属性测试（随机 AST 不产生非法 SQL）。
  - 输入校验（zod schemas）、别名冲突解决、列白名单校验。
- 组件测试：
  - DataGrid 排序/筛选/虚拟滚动交互；JSON 渲染（展开/复制/路径筛选）。
- 端到端（可选）：
  - 以 Docker 本地 PG（假数据）+ Playwright；不接真实生产库。
 - 属性测试：随机 AST 不产生非法/危险 SQL；Lookup(LATERAL) 与 Keyset 的不变量验证。

## 10. 性能与可观测性

- 客户端：虚拟滚动、仅投影选中列、JSON 懒加载。
- 服务端：索引提示（只提示不改写）、查询超时、按需字段、Stream/分页。
- 监控：基本计量（请求量、耗时、超时/限流次数）、慢查询日志（SQL hash + 参数摘要）。
 - 指标门槛（指导值）：中等规模（10w 行）表，首屏 p95 < 1.5s；JSON 抽屉展开 < 300ms（采样/懒加载）。
 - 连接池：区分“元数据池”和“查询池”，分别配置超时/并发上限。

## 11. 包与依赖建议（征求同意后安装）

- 前端：`next`、`react`、`@tanstack/react-table`、`@tanstack/react-virtual`、`@tanstack/react-query`、`@xyflow/react`、`react-json-tree`（或 `react-json-view`）。
- 服务端：`pg`、（可选）`kysely`、`zod`、`pino`、`helmet`、`rate-limiter-flexible`。
- 测试：`vitest`、`@testing-library/react`、`playwright`。
- 工具：`typescript`、`tsx`、`eslint`、`prettier`、`pnpm`。

> 说明：依赖安装需先与你确认。安装前会给出影响评估与锁定策略（如 `pnpm` + `corepack`）。

## 12. 目录结构建议

MVP（单仓库，后续可演进 Monorepo）：

```
.
├─ apps/web            # Next.js 应用（Route Handlers 提供后端 API）
├─ packages/query-engine  # AST/SQL 生成 & 安全校验
├─ packages/introspect    # PG 元数据与关系图构建
├─ packages/ui            # 复用组件（JSON 视图、列渲染器、Join Builder）
├─ packages/types         # 跨包类型定义
└─ docs                   # 文档
```

> 若先走轻量，亦可单体 Next 应用，将 `query-engine` 与 `introspect` 以文件夹模块存在。

## 13. 里程碑与验收（建议）

- M0 初始化（1-2 天）
  - 仓库、基础 ESLint/Prettier、CI（Lint/Type Check/Unit Test）、环境变量约定、最小可运行服务。
- M1 Schema 浏览 + 基础表格（3-5 天）
  - 连接 PG（只读）、Schema Explorer、表格分页/排序/筛选（简单文本/等值）。
- M2 JSONB 体验（3-5 天）
  - JSON 渲染器、路径筛选、懒加载大 JSON。
- M2.5 Lookup 列（2-3 天）
  - 支持一对一/多对一的“即时 Join 加列”（优先 LATERAL），列别名与移除逻辑；Join Registry 去重复用。
 - M2.K Keyset 分页（1-2 天）
  - 在存在稳定唯一排序键时默认启用 Keyset；Offset 作为回退路径；前端游标处理与测试覆盖。
- M3 Join Builder v1（5-7 天）
  - 关系图、选择 Join、SQL 预览、结果列别名/分组。
- M3.5 Lookup 列扩展（2-3 天）
  - 一对多聚合（count/string_agg/json_agg(limit)），DataGrid 展开/预览支持。
- M4 视图保存（浏览器存储）（3-5 天）
  - 本地浏览器持久化、参数化视图、分享链接（内部，URL 携带视图定义或短链映射）。
- M4.5 视图导出/导入（2 天）
  - 导出为 `.rdv.json`（含 schema 版本与校验和），支持导入回放。
- M5 稳定性与性能（持续）
 - 限流/超时/审计、慢查询分析、UX 打磨、导出上限与流式导出。

## 19. 应用数据库与登录（新增提案）

- 目标：在独立的“应用 PG”中存储用户、用户连接（加密 DSN）、保存的视图、审计等；前端提供登录与连接管理 UI。
- 存储安全：
  - 环境变量：`APP_DB_URL`、`APP_ENCRYPTION_KEY`（32B base64）。
  - 敏感字段（DSN）使用 AES-256-GCM（`apps/web/lib/crypto.ts`）加密后存储。
  - DSN 校验与 SSRF 防护（`apps/web/lib/validate-dsn.ts`）：拒绝私网/本机、默认要求 TLS。
- API（占位实现已加）：
  - `GET/POST /api/user/connections`：APP_DB_URL 未配置时返回 501；POST 做 DSN 校验与加密预览。
- 登录方案：Better Auth（Next.js App Router）
  - 路由：`/api/auth/[...all]` 由 `toNextJsHandler(auth.handler)` 暴露。
  - 中间件：`auth.api.getSession()` 保护受限路由（Next 15.2+ 可用 Node runtime）。
  - 后续将 session.user.id 用于应用库的 user 外键与审计。


> 注：上述为工作量参考，实际以你侧节奏与范围为准。

## 14. 风险与权衡

- 复杂 Join 的可视化与可理解性：以“逐步展开”为原则，优先 LEFT/INNER，限制 Join 数量与行上限。
- 大 JSON 字段渲染：默认截断 + 懒加载 + 路径按需取数，避免一次性传输巨量数据。
- 安全边界：严格只读、白名单与参数化，任何“原生 SQL 执行”入口需二次确认并默认关闭。
- 多数据库兼容：先聚焦 PG，抽象接口为后续适配留钩子，但不提前承担复杂度。

## 15. 开放问题（更新）

1) 已确认 PG-only、Web-only。是否需要 Docker 打包与本地运行脚本？
2) 视图保存：先浏览器存储；文件导出/导入排期到 M4.5。是否需要团队共享（服务端存储）作为后续选项？
3) 访问控制与审计：是否需要登录与角色（RBAC）？若单机/单用户可暂缓。
4) 导出表数据：是否确需 CSV 导出？若需要，最大行数与字段脱敏默认值？

## 16. 下一步（建议）

- 步骤 A：确认范围已完成（PG-only、Web-only、可配置超时、视图浏览器存储）。
- 步骤 B：固化依赖清单与脚手架方案（征求同意后执行）。
- 步骤 C：以“测试先行”搭建 `query-engine`（AST→SQL）与最小 DataGrid，打通首条查询链路；同时预留 Lookup 列 AST 能力。

> 文档与库/API 参考：后续进入实现阶段时，将使用 Context7 获取官方文档（Next.js、Kysely/TanStack Table 等）以确保 API/配置准确性。

## 17. JSON 大字段渐进加载（协议）

- 初始单元格仅返回截断文本与元素计数（如 `left(jsonb::text, 4096)`、`jsonb_array_length`）。
- 抽屉模式按“路径 + 范围”增量抓取：`GET /api/json/chunk?table=…&pk=…&path=a.b&range=0:50`。
- 服务端统一参数化与白名单校验；错误返回标准化（路径不存在/越界/类型不符）。

## 18. 审计建议采纳情况（v1 小结）

- 采纳：Lookup→LATERAL、Keyset 默认化、JSON 过滤模板化、列级敏感度与掩码、双连接池、SET LOCAL 策略、JSON 渐进加载。
- 保持：导出/导入仍在 M4.5（与既定“下一阶段 TODO”一致）。
- 说明：数据库权限收紧（REVOKE/禁止 FDW 等）作为运行手册建议，应用不直接执行任何 DB 变更。
