# 桌面端 Queries 页面优化分析

## 现状概览
- `QueriesPage` 组件所在文件 `apps/desktop/src/routes/queries.tsx` 当前 2156 行（`wc -l` 结果），主组件从 `apps/desktop/src/routes/queries.tsx:191` 起声明，单文件承载列表、编辑器、执行、脚本、导入导出、计算项等全部职责。
- 文件内部出现 46 次 `useState` 与 15 次 `useEffect` 调用，集中在组件前半部分（例如 `apps/desktop/src/routes/queries.tsx:191`、`apps/desktop/src/routes/queries.tsx:255`、`apps/desktop/src/routes/queries.tsx:340`），导致状态爆炸且副作用散落。
- 运行查询、预览、Explain、脚本任务、结果统计、公用本地存储等流程全部在同级函数内编排，代码路径交叉、重启难以局部测试。
- 类型定义 `QueryTimingState`、`CalcTimingState`、`CalcResultState` 分别在页面文件（`apps/desktop/src/routes/queries.tsx:80`）以及 `RunQueryPanel`（`apps/desktop/src/components/queries/RunQueryPanel.tsx:13`）和 `TempQueryPanel`（`apps/desktop/src/components/queries/TempQueryPanel.tsx:14`）重复声明，遗漏了集中维护的机会。

## 主要问题
### 1. 状态与副作用集中难维护
- 查询编辑、执行、脚本运行、分页、日志、导入导出、临时查询等状态全部堆叠在 `QueriesPage` 的 `useState` 列表中，任何重置都要手动同步多个 setter（例如 `onNew`、`onTempQueryMode`、`loadAndOpen` 分别位于 `apps/desktop/src/routes/queries.tsx:966`、`apps/desktop/src/routes/queries.tsx:992`、`apps/desktop/src/routes/queries.tsx:1018`，重复清空字段）。
- `useEffect` 里直接读写 `localStorage`（`apps/desktop/src/routes/queries.tsx:340`、`apps/desktop/src/routes/queries.tsx:385`、`apps/desktop/src/routes/queries.tsx:394`）以及连接列表加载（`apps/desktop/src/routes/queries.tsx:357`），缺少统一的持久化与资源加载封装，测试不易覆盖。
- 运行值缓存 `runValueStoreRef` 与同步逻辑散布在组件内（`apps/desktop/src/routes/queries.tsx:203`、`apps/desktop/src/routes/queries.tsx:220`、`apps/desktop/src/routes/queries.tsx:234`），没有独立 Hook，导致运行模式切换时重置代码重复。

### 2. 执行相关逻辑重复
- `onPreview`、`onExecute`、`onExplain`（`apps/desktop/src/routes/queries.tsx:1136`、`apps/desktop/src/routes/queries.tsx:1190`、`apps/desktop/src/routes/queries.tsx:1476`）都包含 `mode === 'temp'` 与 Saved SQL 的双分支，流程相似但细节分散：拼装分页、处理 `QueryError`、记录 `lastRunResultRef`、触发计数刷新等逻辑均重复，修改任一行为需在两个分支同步。
- `QueryError` 的确认写入流程在 temp/saved 两个分支各自嵌套确认框与重试逻辑，提示与 telemetry 也未抽象。

### 3. 运行面板 UI 复用不足
- `RunQueryPanel` 与 `TempQueryPanel` 均渲染 `PaginationSettings`、`RunActionsBar`、`SqlPreviewPanel`、`ResultsPanel`、`PaginationBar`，差异仅在顶部信息块和运行参数区域，却重复代码（参见 `apps/desktop/src/components/queries/RunQueryPanel.tsx:34` 与 `apps/desktop/src/components/queries/TempQueryPanel.tsx:21`）。
- 两个组件独立维护相同的 `QueryTimingState` 定义，以及重复的分页按钮回调，未来若引入“跳转到指定页”等需求需要在两处同步。

### 4. 脚本任务逻辑体量过大且耦合页面状态
- `handleRunScript`、`handleCancelRunRequest`、`performSaveRunZip`、`handleManualExport`、`handleOpenLogViewer`、`handleCleanupCache`、`handleDeleteHistoryRun`、`handleClearHistory` 等函数本质是“脚本任务”领域逻辑，却全部放在页面内（分别起始于 `apps/desktop/src/routes/queries.tsx:595`、`apps/desktop/src/routes/queries.tsx:628`、`apps/desktop/src/routes/queries.tsx:656`、`apps/desktop/src/routes/queries.tsx:771`、`apps/desktop/src/routes/queries.tsx:778`、`apps/desktop/src/routes/queries.tsx:792`、`apps/desktop/src/routes/queries.tsx:817`、`apps/desktop/src/routes/queries.tsx:837`）。
- 这些函数共享 `notifications`、`refreshScriptRunsHistory`、`selectedScriptId`、`scriptRunRecords` 等状态，同时还操作 `setCancelingRunId` 等本页面局部状态，导致脚本区域难以复用，也阻碍未来迁移到独立面板。

### 5. 计算项与计数逻辑散落
- 运行时计算项的准备与自动触发（`runtimeCalcItems`、`runtimeCalcItemsRef`、`runCalcItem` 位于 `apps/desktop/src/routes/queries.tsx:289`、`apps/desktop/src/routes/queries.tsx:1625`、`apps/desktop/src/routes/queries.tsx:1649`）与执行结果紧耦合，但目前既承担分页总数刷新，又处理自定义 JS 计算，副作用写在页面组件里，缺少可单测的纯函数或 Hook。

### 6. 可抽离的重复代码
- Toast/Confirm 模式在多个函数间复制，例如保存、执行、脚本操作都手写 `notifications.show` 与 `window.confirm`。
- 重复的类型定义和默认 SQL 常量可迁移到 `apps/desktop/src/components/queries/types.ts` 或新的公共模块，避免多处手改。

## 建议的抽象与拆分
1. **状态管理分层**
   - 提取 `useSavedSqlList()` 负责列表加载与 `refresh`，暴露 `items`、`error`、`loading`，减少页面直接调用 `listSavedSql`（参考 `apps/desktop/src/routes/queries.tsx:334`、`apps/desktop/src/routes/queries.tsx:347`）。
   - 构建 `useSavedSqlSelection()`，封装 `currentId`、表单字段、`runValueStoreRef`、`onNew`、`onTempQueryMode`、`loadAndOpen` 等重置逻辑，集中处理变量合并与默认值。
   - 构建 `usePaginationState(key)`，内部维护 `pgEnabled`、`pgSize`、`pgPage`、`pgTotalRows`、`pgCountLoaded`，并带上持久化（替换 `apps/desktop/src/routes/queries.tsx:340`、`apps/desktop/src/routes/queries.tsx:385` 的裸 `localStorage` 调用）。
   - 提供 `usePersistentSet(key, initial)` 抽象 `expanded` 与 `extraFolders`，以免重复 JSON 序列化（`apps/desktop/src/routes/queries.tsx:394`）。

2. **执行引擎模块化**
   - 定义 `useQueryExecutor({ mode })`，统一封装 `onPreview`、`onExecute`、`onExplain` 行为，内部根据模式选择 `executeTempSql` 或 `executeSavedSql`，并出具统一的计时、错误与确认流程。页面仅负责传入依赖（连接、变量、状态 setter）。
   - 将写确认逻辑包装成 `ensureReadOnlyExecution()`，返回“是否允许执行”与预览 SQL，避免重复确认弹窗。

3. **UI 布局复用**
   - 抽出 `QueryRunnerLayout` 组件，接收 `header`, `params`, `editor`, `actions`, `resultExtras` 等插槽，实现 `RunQueryPanel` 与 `TempQueryPanel` 共用：两者仅提供头部说明和参数表单，其余全部走公共布局。
   - 将 `QueryTimingState`、`CalcResultState` 等类型迁移到 `apps/desktop/src/components/queries/types.ts`，其他文件统一引用。

4. **脚本任务领域封装**
   - 新建 `useQueryApiScriptTask(queryId, runContext)` Hook，集中处理脚本 CRUD、执行、导出、日志、缓存清理，内部维护 `scriptRunning`/`cancelingRunId` 等状态，并暴露给 `scriptTaskDrawer`。
   - 抽象统一的 `notifySuccess/notifyError/confirmDanger` 辅助函数，减少重复通知代码。

5. **计算项与统计**
   - 拆出 `useRuntimeCalc(items, deps)`，负责 `runtimeCalcItems` 组合、自动触发、分页总数更新，并将 `runCalcItem` 拆成纯函数（便于测试）与外层 Hook（负责状态写回）。
   - 对计数逻辑（`onUpdateTotals`、`__total_count__`）提供单独的 helper，确保临时查询与保存查询共用同一实现。

## 渐进式落地步骤
1. **整理基础工具**：先实现通用通知/确认与 `usePersistentSet`，替换 `localStorage` 副作用，并补充最少单测验证错误兜底。
2. **拆分状态容器**：引入 `useSavedSqlSelection` 与 `usePaginationState`，从 `QueriesPage` 中搬迁大部分 setter，确保切换模式时只需调用 Hook 的 reset 方法。
3. **抽离执行逻辑**：实现 `useQueryExecutor`，让页面与面板组件改用该 Hook 暴露的 `preview`, `execute`, `explain`，并在 Hook 内集中处理 `QueryError` 重试分支。
4. **统一面板 UI**：在 Hook 稳定后重构 `RunQueryPanel` 与 `TempQueryPanel` 成共享布局组件，减少重复类型与分页回调。
5. **封装脚本任务**：迁移脚本函数到 `useQueryApiScriptTask`，为任务 Drawer 提供干净的 props，同时预留未来拆分到独立 tab 的能力。
6. **整理计算项**：将 `runCalcItem` 及相关 helper 移至独立模块，增加针对 SQL/JS 类型的单元测试，保证自动触发正确。

## 风险与测试建议
- 抽象 Hook 时需关注依赖变更引起的重新执行：在 `useQueryExecutor` 与 `useSavedSqlSelection` 中务必使用 `useRef` 或 memo 化结果，避免每次渲染都触发异步请求。
- 迁移脚本任务逻辑应补充集成测试或最少的手动验证脚本执行/取消/导出流程，确保通知状态保持一致。
- 抽离分页状态后，要验证桌面端本地存储行为（分页大小记忆、折叠状态）在 `localStorage` 不可写的环境下仍能安全降级。
- 对 `runCalcItem` 新增 Vitest 单测覆盖 SQL 计数、自定义 JS helper 错误等分支，防止重构过程中破坏现有功能。

