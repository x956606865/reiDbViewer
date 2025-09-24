# Desktop Queries Page Developer Guide

_Last updated: 2025-09-24_

## 1. Module Overview
- Entry point: `apps/desktop/src/routes/queries.tsx` orchestrates the saved queries workspace for the desktop client.
- Primary responsibilities: loading saved SQL metadata, editing, executing queries, managing runtime calculations, and coordinating API script tasks.
- Architectural goals: keep UI logic declarative, centralize side effects inside reusable hooks, and protect read-only database guarantees.

## 2. Hook Inventory & Responsibilities

### 2.1 `useSavedSqlSelection`
- Location: `apps/desktop/src/hooks/queries/useSavedSqlSelection.ts`.
- Tracks the active mode (`run`, `edit`, `temp`), form fields (name/description/sql/tempSql), variables, dynamic columns, and calc items.
- Persists run-time variable values per query ID via an internal `RunValueStore` keyed by saved ID/draft/temp.
- Exposes helpers: `startNew`, `switchToTemp`, `loadSaved`, plus React setters for each field.
- When adding new saved-query metadata, extend `SavedSqlSelectionState` and ensure `createInitialSelectionState`/`loadSavedSelection` populate defaults.
- Unit coverage: `useSavedSqlSelection.test.ts` validates mode switching, run value persistence, and reset flows.

### 2.2 `usePaginationState`
- Location: `apps/desktop/src/hooks/queries/usePaginationState.ts`.
- Encapsulates pagination toggles, page size, page index, total rows/pages, and count-loaded flags.
- Persists page size to `localStorage` using the provided `storageKey`.
- Includes `reset()` to clear counters when selection changes.
- Update this hook when new pagination artefacts (e.g. cursor tokens) are introduced.

### 2.3 `useQueryResultState`
- Location: `apps/desktop/src/hooks/queries/useQueryResultState.ts`.
- Maintains preview SQL, grid column order, rows, text explain buffer, and references for the preview panel.
- Provides `reset` helpers used when switching connections or deleting queries.
- Works in tandem with `useQueryExecutor` to surface result updates.

### 2.4 `useQueryExecutor`
- Location: `apps/desktop/src/hooks/queries/useQueryExecutor.ts`.
- Centralizes the preview/execute/explain flows for both saved and temp modes.
- Responsibilities:
  - Validate input state (connection, SQL, variable completeness).
  - Call the appropriate service (`executeSavedSql` vs `executeTempSql`).
  - Handle `QueryError` variants (vars missing, write guard, server failures) and bubble toast/inline errors.
  - Update pagination counters and runtime calc triggers through callbacks.
  - Emit `rdv:query-executing` events for global indicators.
- Uses `QueryTimingState` to track latency, row counts, and statement metadata.
- When extending execution behaviour (e.g., new explain modes), add tests in `useQueryExecutor.test.ts` to lock coverage.

### 2.5 `useRuntimeCalc`
- Location: `apps/desktop/src/hooks/queries/useRuntimeCalc.ts`.
- Manages runtime calculation definitions, auto-run scheduling, and result cache.
- Exposes `onRunCalc` for manual triggers and `updateTotals` helper for count-only refresh.
- Internally distinguishes SQL vs JS calculators and normalizes errors for the UI.
- Tests (`useRuntimeCalc.test.ts`) ensure totals and calc-state transitions remain stable.

### 2.6 `useQueryApiScriptTask`
- Location: `apps/desktop/src/hooks/queries/useQueryApiScriptTask.ts`.
- Wraps the API script drawer lifecycle: execution, cancellation, export, log open, history cleanup.
- Bridges Mantine notifications and confirmation prompts via `notifySuccess/notifyError/confirmDanger`.
- Maintains reactive state for active run IDs, progress, and permission gating (requires latest query result).
- Extend this hook when adding new script actions to keep `queries.tsx` lean.

### 2.7 `useSavedSqlColumnWidths`
- Location: `apps/desktop/src/hooks/queries/useSavedSqlColumnWidths.ts`.
- Fetches and persists column width preferences for saved queries.
- Debounces updates to avoid excessive writes and compares width maps to prevent unnecessary mutations.

### 2.8 Auxiliary Utilities
- `usePersistentSet` (`apps/desktop/src/lib/use-persistent-set.ts`) retains sidebar expansion state.
- Notification helpers live in `apps/desktop/src/lib/notifications.ts` and standardize success/error/confirm flows across hooks.

## 3. Data Flow Summary
1. Sidebar selection invokes `loadSavedSelection`, which hydrates form state and resets pagination via `resetPagination`.
2. Execution actions call into `useQueryExecutor`, streaming results into `useQueryResultState` and propagating pagination totals.
3. Successes or errors feed runtime calc triggers through `useRuntimeCalc`, which updates cards displayed by `RuntimeCalcCards`.
4. Script task drawer consumes `useQueryApiScriptTask` output, enabling asynchronous Tauri command coordination without coupling to the page.

## 4. Adding Features Safely
- **Start with tests**: write or extend Vitest files under `apps/desktop/src/hooks/queries/` before modifying hook logic.
- **Preserve read-only contracts**: new execution flows must keep `QueryError.isWrite` checks and confirmation prompts intact.
- **State additions**: favour augmenting hooks rather than reintroducing `useState` in `queries.tsx`. Share new values via hook return objects.
- **Persistent data**: store new per-query preferences using the existing SQLite tables; update `useSavedSqlSelection` & `applications services` to fetch/save them.
- **Type exposure**: extend `apps/desktop/src/components/queries/types.ts` for shared structs to keep Run/Temp panels consistent.

## 5. Manual Verification Checklist (Dev Focus)
- Saved query → run → explain cycle completes without warnings.
- Temp query switches preserve unsaved SQL and run values independently.
- Pagination toggles accurately disable result slicing and reset totals.
- Runtime calculations auto-trigger after execute and can be retried manually.
- Script tasks refuse to start until a fresh result set exists; cancellation leaves UI consistent.

## 6. Useful References
- Services: `apps/desktop/src/services/savedSql.ts`, `apps/desktop/src/services/pgExec.ts`.
- Components: `SavedQueriesSidebar`, `QueryRunnerLayout`, `RuntimeCalcCards`, `QueryApiScriptTaskDrawer`.
- Events: `@rei-db-view/types/events.ts` for emitted desktop telemetry.

## 7. Contribution Do's & Don'ts
- **Do** keep `queries.tsx` focused on wiring hooks and passing props.
- **Do** document new hook APIs in this guide and add entries to `queries-page-optimization-changelog.md`.
- **Don't** access `localStorage` or `notifications` directly from components—delegate through hooks/utilities.
- **Don't** bypass read-only enforcement when invoking database services.
- **Don't** add dependencies without prior approval (per optimization plan constraints).

