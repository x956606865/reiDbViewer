# Queries 页面优化分析

## 背景
Current saved queries page in `apps/web/app/queries/page.tsx` has accumulated complex responsibilities, causing slow iteration and high bug risk. file length ~1141 lines etc.

## 问题梳理
- 职责集中: single component handling data fetch, editing state, run execution, import/export, dynamic columns, notifications. Hard to maintain. Section references.
- 状态爆炸: >30 useState wrappers for short/long states; inconsistent resets; no central store. Complex.
- API 交互杂糅: fetch logic inline with view; repeated error handling; lacks shared error semantics.
- 动态列逻辑嵌入: `new Function` runtime compiled inside component produce UI coupling and hamper test coverage.
- 持久化逻辑重复: `expanded` and `extraFolders` persist to localStorage with copy-pasted effect blocks.
- 用不到的代码: `currentConnLabel`, `tree` unused duplicates.
- 执行逻辑重复: `onPreview`/`onExecute`/`onExplain` share steps but code duplicates.
- 删除逻辑重复: `onDelete`/`onDeleteById` replicates flows aside from prompt string.

## 建议改造方向

### 1. 切分状态管理
- Introduce `useSavedQueriesPageState` reducer/hook for editor state (currentId, form, dynamic columns). Expose actions for load/select/clear.
- Move runtime execution state (pagination, running flags, results) into `useQueryRunner` consumed by `RunQueryPanel`.
- Provide `usePersistentSet(key, init)` to generalize localStorage sets for expanded/extraFolders.

### 2. 标准化 API 层
- Create `useSavedQueriesApi` (or service module) wrapping `/api/user/saved-sql*`. Provide typed helpers `listSavedQueries`, `fetchSavedQuery`, `createOrUpdateQuery`, `archiveQuery`, `exportSavedQueries`, `importSavedQueries`.
- Handle 501 `suggestedSQL` and 409 name conflicts centrally, returning structured errors for UI.
- Prepare for integration with `@tanstack/react-query` by exposing query keys and mutation hooks.

### 3. 抽象常见交互
- `confirmAction(message)` and `showNotification({ type, title, message })` wrappers to avoid repetitive `window.confirm`/`notifications.show` usage.
- Shared `ensureCurrentQuerySelected` guard returning early with typed errors.
- Shared `handleVarsMissing` to convert server error to toast.

### 4. 组件职责重组
- Move dynamic column evaluation into `ResultsPanel` (or dedicated helper) to isolate DOM creation, ensure `setRows` updates remain local.
- Let `SavedQueriesSidebar` receive prepared tree data from parent to avoid duplicate `buildSavedTree` execution.
- Create `QueryEditorProvider` context wrapping `EditQueryPanel` to decouple form from page component.

### 5. 清理冗余
- Delete unused `currentConnLabel` and `tree` to reduce mental load.
- Reset `calcResults` when executing `clearEditor` and | or switching connections to avoid stale values.

### 6. 渐进式实施计划
1. **基础清理**: remove dead code, align `clearEditor` resets, add `usePersistentSet` hook.
2. **API Hook**: extract fetch logic into `useSavedQueriesApi`, update page to use functions.
3. **执行抽象**: implement `useQueryRunner`, share between preview/execute/explain.
4. **组件拆分**: wrap new context/providers, relocate dynamic column logic.
5. **测试补齐**: add Vitest cases for `useSavedQueriesApi`, import/export error branches, dynamic column evaluation, `usePersistentSet` fallback.
6. **后续优化**: consider migrating to `react-query` for caching, and to smaller child components for run panel controls.

## 风险与验证
- 抽离后需防止引入额外 API 调用次数，尤其是导出时的批量 fetch；可在 API 层增加并发限速或批量接口。
- 动态列 evaluation 需保证 `manualTrigger` 按钮仍能更新 `rows`; 需要针对内存引用深拷贝进行测试。
- 搭配 `react-query` 时，需要复查鉴权 headers/缓存策略，避免泄露敏感 SQL 内容至缓存。

## 建议测试
- 更新现有单测或新增：
  - `usePersistentSet` localStorage 操作。
  - 变量缺失时 `handleVarsMissing` 行为。
  - 导入流程覆盖/跳过统计。
  - 动态列运行时 helper 错误兜底。
- 手动验证：列表刷新、导入导出、分页执行、Explain JSON 模式、动态列按钮、初始化 501 提示。

## 后续跟进
- 确认是否采用 `@tanstack/react-query`；若采纳，需规划 query key 结构与缓存失效策略。
- 评估把“自定义计算项”移动到独立面板或弹窗，配合 schema 预检。
- 若桌面端共享逻辑，考虑提取公共 `saved-queries` package 复用 Hook 与类型。

