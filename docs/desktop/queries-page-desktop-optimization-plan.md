# 桌面端 Queries 页面优化开发方案

## 总体目标
- 将 `QueriesPage` 从巨型组件重构为一组职责清晰的 Hook、容器组件与领域模块，降低维护成本。
- 复用桌面端与未来 Web 端的查询执行、分页、脚本任务等核心逻辑，减少重复实现。
- 在保证现有功能完整性的前提下，补齐关键单元测试与手动验收流程，确保重构安全落地。

## 范围与前提
- 涉及文件以 `apps/desktop/src/routes/queries.tsx` 及其依赖组件/Hook 为主，不触碰服务器端 API 与数据库 Schema。
- 不新增依赖库；如需引入（例如状态管理或请求库扩展），需单独评估并获批准。
- 本方案以渐进式重构为原则，每个阶段都需保持桌面端可运行、核心路径可验证。

## 阶段划分与交付物

### 阶段 0：准备与基础设施
- **主要工作**
  - 梳理并记录现有页面关键功能路径和依赖，确认必须覆盖的回归场景。
  - 实现通用工具：`usePersistentSet`（抽象本地持久化）、`notifySuccess/notifyError/confirmDanger` 等通知封装。
  - 为 `usePersistentSet` 和通知封装添加基础单元测试。
- **输出**
  - 文档更新：回归场景清单。
  - 新增工具模块与对应测试文件。
- **验收标准**
  - 通过 `pnpm test` 覆盖新增测试。
  - 手动验证原页面在新增工具切换后仍可正常加载、折叠状态持久化。
- **实施记录（2025-09-24）**
  - 已新增 `apps/desktop/src/lib/use-persistent-set.ts` 并在 `apps/desktop/src/routes/queries.tsx` 接入折叠/额外文件夹持久化逻辑，保留原有默认值与本地存储键。
  - 提供 `apps/desktop/src/lib/notifications.ts` 的通知与确认包装，替换脚本任务与 Saved SQL 保存等入口的直接 `notifications.show`/`window.confirm` 调用。
  - 新增测试：`apps/desktop/src/lib/use-persistent-set.test.ts`、`apps/desktop/src/lib/notifications.test.ts`，确保持久化读写与通知封装行为可回归。

### 阶段 1：拆分基础状态容器
- **主要工作**
  - 引入 `useSavedSqlSelection`，封装 `currentId`、表单字段、`runValueStoreRef` 等状态，统一提供 `reset`、`load`、`switchMode` 等方法。
  - 实现 `usePaginationState(key)`，替换页面内分页相关的 `useState` 与 `localStorage` 副作用。
  - 清理 `QueriesPage` 内重复的 `useState` 初始化与 `set*` 连锁调用。
- **输出**
  - 新增 Hook 文件（`apps/desktop/src/hooks/queries/useSavedSqlSelection.ts` 等）。
  - 更新后的 `queries.tsx` 使用 Hook 管理状态。
- **验收标准**
  - `queries.tsx` 中 `useState` 数量较现状下降 ≥ 50%。
  - 切换保存查询 / 临时查询模式时，相关字段按预期重置，无残留状态。
  - 单元测试覆盖 `useSavedSqlSelection` 初始化、加载、重置逻辑。

### 阶段 2：统一执行流程 Hook
- **主要工作**
  - 实现 `useQueryExecutor({ mode })`，整合 `onPreview`、`onExecute`、`onExplain`，统一处理 `QueryError`、确认弹窗、计时与分页更新。
  - 抽取可复用的错误类型映射、变量缺失处理（`handleVarsMissing`）。
  - 页面改为调用 `useQueryExecutor` 暴露的 API。
- **输出**
  - 新 Hook 文件（`useQueryExecutor.ts`）及对应测试（覆盖成功、变量缺失、501/409 等分支）。
  - `queries.tsx` 中与执行相关的函数被替换为 Hook 调用。
- **验收标准**
  - 手动验证：预览、执行、Explain、分页、结果刷新均正常；错误提示一致。
  - `queries.tsx` 内不再出现重复的执行分支代码。
  - 测试覆盖率显示 `useQueryExecutor` 关键分支被命中。

### 阶段 3：运行面板 UI 复用
- **主要工作**
  - 抽象 `QueryRunnerLayout` 组件，统一 `RunQueryPanel` 与 `TempQueryPanel` 的布局与分页条、结果面板渲染。
  - 将 `QueryTimingState`、`CalcResultState` 等类型迁移到公共 `types.ts`。
  - 删除重复的分页回调及 `useEffect`，确认两面板仅保留差异化输入区域。
- **输出**
  - 新增共享布局组件与类型文件。
  - 更新后的 `RunQueryPanel.tsx`、`TempQueryPanel.tsx`。
- **验收标准**
  - 两个面板组件行数降低 ≥ 30%，且主要包含差异化 JSX。
  - 手动验证：运行面板分页、切页、预览、结果展示一致无回归。
  - Storybook（如有）或组件级测试通过。

### 阶段 4：脚本任务逻辑封装
- **主要工作**
  - 编写 `useQueryApiScriptTask`，集中管理脚本执行、取消、导出、日志、清理等状态与副作用。
  - 页面与 Drawer 改为通过 Hook 提供的 API 与状态渲染。
  - 整理脚本相关通知、确认逻辑，复用阶段 0 的工具。
- **输出**
  - 新 Hook 文件与对应测试（覆盖执行、取消、失败兜底）。
  - `queries.tsx` 中脚本相关函数大幅减少，主要保留 Hook 接入。
- **验收标准**
  - 手动验证：脚本任务执行、取消、下载日志、清理历史等流程正常。
  - Hook 测试覆盖主要分支；失败时的通知内容与旧版本一致。
  - 代码审查确认页面文件内脚本领域逻辑已最小化。

### 阶段 5：计算项与统计重构
- **主要工作**
  - 拆分 `runCalcItem` 为纯函数 + `useRuntimeCalc` Hook，处理自动触发与分页总数同步。
  - 提供 `updateTotals` helper，统一临时/保存查询的计数逻辑。
  - 为自定义 JS 与 SQL 计数流程补充单元测试。
- **输出**
  - 新的计算项模块与测试。
  - 页面 Hook 化后的调用逻辑。
- **验收标准**
  - 手动验证：自动计算项、总行数刷新、手动触发均正常。
  - 测试覆盖 `useRuntimeCalc` 的成功、异常分支。
  - 移除页面内直接操作 `runtimeCalcItems` 的代码。

### 阶段 6：整体验收与回归
- **主要工作**
  - 汇总阶段性自测结果，执行完整回归流程（保存/编辑/执行/导入导出/脚本/计算项/分页/折叠持久化）。
  - 对照阶段 0 的回归清单完成勾验，记录已知风险或遗留问题。
  - 整理迁移文档，说明新增 Hook、组件的使用方式及未来扩展建议。
- **输出**
  - 回归报告与遗留问题列表。
  - 最终文档更新：《桌面端 Queries 页面使用说明》《开发者指南》中的 Hook 介绍。
- **验收标准**
  - 回归清单全部通过。
  - 没有未解决的高优先级问题；若有低优先级遗留，需有明确的后续 owner 与计划。
  - 代码审查确认：`apps/desktop/src/routes/queries.tsx` 行数减至 < 1200 行，职责清晰。

## 测试策略
- 单元测试：针对每个新 Hook/工具模块添加 Vitest 覆盖；特别关注错误分支、临时查询路径。
- 组件测试（如使用 Testing Library）：覆盖 `QueryRunnerLayout` 关键交互。
- 手动测试：阶段完成后执行 mini 回归，阶段 6 进行全量回归。
- 如发现关键回归，可补充端到端脚本或回归手册。

## 风险与缓解
- **状态拆分导致的渲染抖动**：在 Hook 中使用 `useMemo`/`useRef` 控制依赖；必要时引入 `useSyncExternalStore`。
- **脚本任务持久化依赖历史状态**：迁移前记录现有状态结构，迁移后提供向后兼容的转换逻辑。
- **测试覆盖不足**：每阶段合入前必须补充对应测试，禁止先合代码后补测试。
- **重构期间的功能冻结**：除 bug fix 外暂停对 `queries.tsx` 的新需求，减少冲突；若必须合入新功能，先与负责人同步并在 Hook 层扩展。

## 沟通与里程碑
- 每阶段结束输出简短总结（变更点、风险、下一步），同步到 `docs/desktop/queries-page-optimization-changelog.md`。
- 建议以 1〜1.5 周为一个阶段节奏，可根据复杂度调整：阶段 0～2 优先完成，为后续拆分铺路。
- 关键评审节点：
  1. 阶段 2 完成后组织代码走查，确认执行链 Hook 设计合理。
  2. 阶段 4 完成后复盘脚本任务模块，评估是否抽离为独立包。
  3. 阶段 6 完成时召开验收会，确认迁移关闭。

## 后续展望
- 视 Hook 抽象成熟度评估是否提取到 `packages/desktop-shared` 供 CLI/网页版共用。
- 结合 `@tanstack/react-query` 或其他缓存方案的引入可在本次重构稳定后开展。
- 持续监控 `QueriesPage` 文件体量，超过 1200 行时触发自动提醒，防止再次膨胀。
