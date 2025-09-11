# reiDbView 方案审计与优化建议（v1）

> 本文基于你提供的《reiDbView 开发方案（v0.1 草案）》进行系统性审计，并给出可落地的优化与调整建议。fileciteturn0file0

- **作者**：协同助手（依据你提供的草案整理与扩展）  
- **日期**：2025-09-11  
- **适用范围**：PG-only + Web（Next.js）首发；读优先；不包含生产写入能力。

---

## 目录
- [TL;DR（可直接执行的前 10 条改进）](#tldr可直接执行的前-10-条改进)
- [总体评价（优点与定位）](#总体评价优点与定位)
- [深入审计与优化建议（按领域）](#深入审计与优化建议按领域)
  - [1) 查询/AST 与 SQL 生成](#1-查询ast-与-sql-生成)
  - [2) JSON/JSONB 体验与过滤](#2-jsonjsonb-体验与过滤)
  - [3) 关系推断与 Join Builder](#3-关系推断与-join-builder)
  - [4) 安全与治理](#4-安全与治理)
  - [5) 性能与可观测性](#5-性能与可观测性)
  - [6) 前端交互与 IA](#6-前端交互与-ia)
  - [7) 依赖与技术选型](#7-依赖与技术选型)
  - [8) 里程碑调整与验收补丁](#8-里程碑调整与验收补丁)
- [关键设计提案（可直接用于实现/Review）](#关键设计提案可直接用于实现review)
  - [A. Lookup Column 的 AST 与 SQL 生成（LATERAL 版）](#a-lookup-column-的-ast-与-sql-生成lateral-版)
  - [B. Keyset Pagination 规范](#b-keyset-pagination-规范)
  - [C. JSON 大字段“渐进加载”协议](#c-json-大字段渐进加载协议)
  - [D. 审计与脱敏最小集合](#d-审计与脱敏最小集合)
- [实施清单（Quick Wins）](#实施清单quick-wins)
- [结语](#结语)

---

## TL;DR（可直接执行的前 10 条改进）

1. **Lookup Column 改为 LATERAL 子查询优先**：避免为每个被选列都重复 JOIN，降低列级“补列”带来的笛卡尔或重复 JOIN 风险，提升性能与复用性（见“设计提案 A”）。fileciteturn0file0  
2. **默认采用 Keyset Pagination，Offset 仅作回退**：显著减少深分页开销（见“设计提案 B”）。你草案已有“Keyset 选项（增强）”，建议上移到 MVP。fileciteturn0file0  
3. **JSONB 过滤语义收敛为三类可索引模式**（exist/contain/path_exists），UI 显式提示可用索引与等价写法，避免自由组合导致慢查询（见“JSON 体验与过滤”）。fileciteturn0file0  
4. **Query API 层统一下推 `SET LOCAL statement_timeout` 与 `search_path` 控制**：杜绝用户会话跨请求污染，与你的 `QUERY_TIMEOUT_*` 一致（保留 API 级保险丝）。fileciteturn0file0  
5. **“关系路径白名单 + Join 深度上限”**：Join Builder 与 Lookup 只能沿着已知 FK/命名约定路径走，且限制最大 hop（例如 ≤3），防止意外生成“类星型”爆表查询。你草案已强调“白名单与限制”，建议把“深度”量化并前端预估。fileciteturn0file0  
6. **“预览 SQL”升级为“EXPLAIN 轻量诊断”开关**：提供不含 ANALYZE 的 `EXPLAIN (FORMAT TEXT, TIMING off)` 预估，配合 UI 的“潜在慢查询”黄色提示。fileciteturn0file0  
7. **数据面与元数据面分离连接池**：一个连接池只跑 `pg_catalog/information_schema` 与统计；另一个只跑数据查询，避免元数据扫描在高并发时干扰数据面。fileciteturn0file0  
8. **加入“列级脱敏与掩码策略”**：在 Schema Explorer 标注敏感列（如 email/phone），默认仅显示前/后若干位；审计日志记录“谁查看了敏感列”。你草案有“审计/治理”，补齐“掩码”策略。fileciteturn0file0  
9. **视图保存格式（.rdv.json）从 M4.5 前置到 M3，并加语义版本与校验和**：方便团队复制/回放与回滚。你草案已规划导入/导出，建议提前一个里程碑，配合“只读分享链接”。fileciteturn0file0  
10. **把“只读角色”再收紧**：专用 ROLE 撤销 `TEMP` 权限、禁止 `SET ROLE`、限制函数执行（白名单）、禁止 `COPY TO PROGRAM` 等——DB 层“零信任”。fileciteturn0file0

---

## 总体评价（优点与定位）

- **定位清晰**：强调“读优先、JSON/JSONB 友好、多表可视探索”，与通用 Admin/BI 工具差异化明显。  
- **安全意识强**：只读、参数化、白名单、限流/超时与审计均在方案中体现。  
- **工程划分合理**：`introspect / query-engine / ui` 模块化清晰，AST→SQL 的安全出口路线正确。fileciteturn0file0

---

## 深入审计与优化建议（按领域）

### 1) 查询/AST 与 SQL 生成

**发现与风险**  
- 当前 AST 结构简单易控，但**列/表别名与去重**逻辑若放在“JOIN 去重”层，很容易在“Lookup 多次选列”时生成重复 JOIN。建议在 AST 层**引入 Join Registry（按 join key 归一）**并给每条 JOIN 赋稳定 ID。fileciteturn0file0  
- “一对多聚合”在 M3 以后才支持，但**一对多是数据浏览常态**（如 `orders -> order_items`）。建议 MVP 就支持 `count(*)` 聚合；`json_agg`/`string_agg` 可延后。fileciteturn0file0

**改进建议**  
- **设计提案 A：用 LATERAL 子查询实现 Lookup Column**  
  - 语义：对当前行，沿指定关系补一列/若干列（或聚合），而不改变主结果集基数。  
  - SQL 模式（示例）：
    ```sql
    SELECT o.id,
           u_col.email
    FROM orders o
    LEFT JOIN LATERAL (
      SELECT u.email
      FROM users u
      WHERE u.id = o.user_id
      LIMIT 1
    ) AS u_col ON TRUE;
    ```
  - 好处：
    1) 复用同一主表扫描；  
    2) 避免重复 JOIN 产生列乘积；  
    3) 每个 Lookup 有独立的 `LIMIT`/聚合策略与别名空间。

- **设计提案 B：Keyset Pagination（服务端默认）**  
  - AST 增加 `pagination: { mode: 'keyset'|'offset', orderBy: [...], cursor?: {...} }`；  
  - 规则：当 `orderBy` 存在唯一性列组合（或强制追加主键）时启用 keyset；否则回退 offset 并在 UI 提示“选择唯一排序列可加速翻页”。fileciteturn0file0

**别名与冲突**  
- 建议**可读 alias 与内部 alias 分离**（用户可重命名列头，但导出/回放继续用内部稳定名），避免因 UI 重命名影响回放与自动化测试。fileciteturn0file0

---

### 2) JSON/JSONB 体验与过滤

**发现与风险**  
- JSONPath/键路径筛选能力强，但**太自由**时容易命中无索引扫描。fileciteturn0file0

**改进（策略化）**  
- 将 JSON 过滤统一成 3 种“索引友好”模式，并在 UI 以模板暴露：  
  1) **存在性**：键是否存在（`?` / `?&` 等）；  
  2) **包含关系**：`@>` 子句（部分结构匹配）；  
  3) **路径存在/值比较**：`jsonb_path_exists` 或 `#>>` 取值比较（谨慎）。  
- **UI 指南与提示**：当用户选择“包含/存在/比较”时，右侧展示“建议索引与样例语句”，执行前做**静态规则校验**（如禁止对超大 JSON 做 `%like%`）。  
- **大 JSON 懒加载质控**：  
  - 单元格默认 4KB 预览（字符/字节阈值），超出进入“抽屉”按路径分页加载；  
  - **预估体积提示**：元数据面记录列均值/中位大小，超过阈值前置提示“分页/路径抓取”。fileciteturn0file0

---

### 3) 关系推断与 Join Builder

- **路径白名单 + 深度上限**：沿 FK 与命名约定的可达图才可选；默认最大 3 跳，UI 每增加一跳显示“数据量与耗时风险”徽标。fileciteturn0file0  
- **冲突与重复列的分组显示**：将“来源表”做可折叠分组，并在列头展示来源标签（表/别名），支持“一键收纳该表列”。fileciteturn0file0

---

### 4) 安全与治理

- **数据库侧“零信任只读”**（在只读基础上再收紧）：  
  - 连接用户撤销 `CREATE/TEMP`、`EXECUTE`（除白名单函数）、`SET ROLE`；  
  - 每请求：
    ```sql
    SET LOCAL statement_timeout = :ms;
    SET LOCAL idle_in_transaction_session_timeout = :ms;
    SET LOCAL search_path = pg_catalog, "$user";
    ```
    保证作用域隔离；  
  - 禁止 FDW/dblink 与 `COPY TO PROGRAM`。fileciteturn0file0  
- **列级脱敏**：在 `packages/introspect` 产出的元数据中加 `sensitivity: 'public'|'internal'|'restricted'`，UI 默认掩码（可临时揭示，需额外确认并记录审计）。fileciteturn0file0  
- **审计最小化但有用**：记录“谁、何时、访问了什么视图/表、选了哪些列/过滤/join（hash 后）以及返回行数区间”。避免把 SQL 原文直接落盘，以**AST hash + 参数摘要**代替。fileciteturn0file0

---

### 5) 性能与可观测性

- **双通道连接池**（元数据 vs 数据查询），并对“长/短查询”设置不同超时与并发上限。fileciteturn0file0  
- **轻量指标**：p95 耗时、超时率、被限流次数、平均行返回量分布；慢查询日志以 SQL hash 聚合。fileciteturn0file0  
- **“索引提示但不改写”**：维持“只提示不改写”，提示做成**可展开的知识卡片**（为何慢、怎样建索引、影响面）。fileciteturn0file0

---

### 6) 前端交互与 IA

- **键盘优先**：表格列搜索、路径筛选、列冻结/解冻、添加 Lookup，提供快捷键（`?` 面板）。  
- **JSON 单元格“选中键 → 生成筛选”**：并支持“从筛选栏高亮对应键路径”。fileciteturn0file0  
- **Row Detail Drawer**：把“关联记录预览”与“JSON Diff”做成插件插槽，后续易扩展。fileciteturn0file0

---

### 7) 依赖与技术选型

- **TanStack Table + Virtual**：当前阶段足够；若未来需要 200k+ 单元格复杂冻结/分组，才评估 AG Grid。fileciteturn0file0  
- **Kysely 可选**：如自研 AST→SQL，则 Kysely 的价值更多在多方言扩展；首发 PG-only 可暂不引入，避免双重抽象。fileciteturn0file0  
- **React Query**：保留，并用 `suspense` 与请求去重降低飞线。fileciteturn0file0

---

### 8) 里程碑调整与验收补丁

- **M2**：加入 Keyset Pagination（至少对“按主键排序”的场景默认启用）。  
- **M2.5**：Lookup 采用 LATERAL；并支持“一对多 count(*)”聚合。  
- **M3**：引入 `.rdv.json` 视图导出/导入（含 schema 版本与校验和）与“只读分享链接”。  
- **每个里程碑的验收**增加自动化：
  - AST→SQL 属性测试（随机 AST 不产生非法/危险 SQL）；  
  - 关键路径 E2E：`introspect → DataGrid → Lookup(LATERAL) → 保存视图 → 回放`；  
  - 性能门槛：10w 行表，p95 首屏 < 1.5s；JSON 抽屉 < 300ms。fileciteturn0file0

---

## 关键设计提案（可直接用于实现/Review）

### A. Lookup Column 的 AST 与 SQL 生成（LATERAL 版）

**AST 片段**
```ts
type LookupColumn = {
  id: string;                    // 稳定ID，供去重与移除
  fromTable: TableRef;           // 主表别名
  toTable: TableRef;
  on: EqRef;                     // 等值条件（仅白名单列）
  agg?: { kind: 'none'|'count'|'json_agg'|'string_agg', limit?: number };
  pick: ColumnRef | AggExpr;     // 选择列或聚合表达式
  alias?: string;                // 外显列别名
};
```

**SQL 生成策略**
- 将每个 Lookup 转换为：
```sql
LEFT JOIN LATERAL (
  SELECT /* pick/agg */
  FROM "toTable" t
  WHERE /* on */
  /* 可选 LIMIT 1 或聚合 */
) AS lc_<id> ON TRUE
```
- `SELECT` 列表达式使用 `lc_<id>.<pickAlias>`；  
- 末尾对 LATERAL 子查询按（on 条件 + toTable + pick/agg）去重与复用；  
- 一对多默认 `count(*)`，`json_agg` 建议带 `limit` 防炸。

---

### B. Keyset Pagination 规范

- 要求存在“**稳定唯一排序键**”（默认追加主键作为尾序）。  
- Cursor 结构：
```ts
type Cursor = { last: Record<ColumnName, string|number|Date> };
```
- 生成谓词（升序示例）：
```sql
WHERE (col1, col2, pk) > (:last_col1, :last_col2, :last_pk)
ORDER BY col1 ASC, col2 ASC, pk ASC
LIMIT :pageSize
```
- 若降序则对比符号反转。

---

### C. JSON 大字段“渐进加载”协议

- 单元格初始只取 `left(jsonb::text, 4096)` 与 `jsonb_array_length`/`jsonb_object_keys` 计数；  
- 抽屉模式按“路径 + 分页”增量抓取；  
- 后端暴露统一接口（示例）：
```
GET /json/chunk?table=…&pk=…&path=a.b&range=0:50
```
- 一律参数化与白名单表/列校验。

---

### D. 审计与脱敏最小集合

- `AuditEvent = { userId, time, action: 'view'|'export', target: { table, columns[], joinsHash }, rowCountBucket: '<100'|'100-1k'|'1k-10k'|'>10k' }`；  
- `SensitivityPolicy = { column: 'users.email', rule: 'mask: keep-last-4' }` 在前后端同时生效。

---

## 实施清单（Quick Wins）

- [ ] 在 `query-engine` 增加 **Join Registry** 与 **LATERAL 渲染器**；  
- [ ] 在分页模型中加入 **keyset** 模式，UI 强制选择“唯一排序键”；  
- [ ] JSON 过滤 UI **模板化三类**（exist/contain/path_exists），执行前做静态校验；  
- [ ] API 开始使用 `SET LOCAL statement_timeout` 与 `search_path`；  
- [ ] `introspect` 输出 **关系可达图（含最大深度）** 与 **敏感列标注**；  
- [ ] 打通 **导出/导入 `.rdv.json`**（含 `version`, `checksum`, `createdAt`）；  
- [ ] **双连接池策略**与限流等级（元数据面更严格）；  
- [ ] **慢查询采样与指纹聚合**（SQL hash + 参数摘要）。

---

## 结语

整体方案已相当成熟、边界清晰。最大的收益点在于：  
- **Lookup Column → LATERAL 子查询**（复用与稳定性更好）；  
- **Keyset 分页默认化**；  
- **JSON 过滤语义模板化**。

这些改动能显著提升性能稳定性与使用流畅度，同时保持“读优先、安全默认”的产品定位，且与现有草案天然兼容、代价可控。后续你若需要，我可以按该文档把 `packages/query-engine` 的 AST 类型、LATERAL 渲染与 keyset 生成的最小实现草稿写出来，并配一组属性测试用例（不接真实库也能跑通）。fileciteturn0file0
