# Queries Page Baseline (2025-09-23)

## Context
- Phase 0 deliverable for the saved queries refactor.
- Focus on recording the current state before any structural changes.

## Build & Bundle Status
- Command: `source ~/.nvm/nvm.sh && nvm use 20 && corepack pnpm --filter @rei-db-view/web build`
- Result: build fails during type-checking with `CalcItemDef` incompatibility at `apps/web/app/queries/page.tsx:1124`. The compiler rejects `CalcItemDef` entries where `kind` can be `'group'`, while the type definition expects `'single'` or `undefined`.
- Additional warnings: ESLint reports a missing dependency list in `apps/web/app/install/page.tsx` and `<a>` usage in `apps/web/components/NavBar.tsx`.
- With lint/type checks disabled the failure persists because Next.js still runs the same type pipeline.
- Existing artifact size (previous build artifacts currently in repo root):
  - `apps/web/.next/server/app/queries/page.js` - 3.3 MiB (transpiled server module).
  - Directory footprint: `du -sh apps/web/.next/server/app/queries` -> ~572 KiB on disk (likely trimmed by filesystem compression).
- Action: unblockable baseline metrics (First Load JS, main bundle) require the type error to be addressed or the build to run in an environment where type-checks can be bypassed explicitly.

## Runtime Profiling Attempts
- Command: `source ~/.nvm/nvm.sh && nvm use 20 && corepack pnpm --filter @rei-db-view/web dev`
- Result: Next.js dev server fails with `listen EPERM: operation not permitted 0.0.0.0:3000` under the current sandbox, preventing React Profiler captures and event-log sampling.
- Follow-up: rerun locally on an unrestricted environment using Chrome DevTools -> Profiler (record load, `Run` button, dynamic column trigger). Export `.json` traces for future comparison.

## Event Logging Snapshot
- The page dispatches `rdv:query-executing` via `emitQueryExecutingEvent(isExecuting, 'web/queries')` (`packages/types/src/events.ts`).
- Suggested capture script (to run in browser console once dev server is available):
  ```ts
  window.addEventListener('rdv:query-executing', (ev) => {
    const { executing, source } = ev.detail ?? {};
    console.info('[Profiler]', new Date().toISOString(), executing, source);
  });
  ```
- No additional telemetry hooks were detected in the page component.

## Regression Checklist (Baseline)
- Load saved query tree on first render, including persisted expanded folders (`localStorage['rdv.savedSql.expanded']`).
- Select existing saved query (ensures `/api/user/saved-sql/:id` hydration, variable defaults, pagination reset).
- Create new query, save, and reopen (POST `/api/user/saved-sql`).
- Save with duplicate name -> confirm overwrite path, archiving prior ID when applicable.
- Save failure when APP_DB tables missing (`501` with `suggestedSQL` surface).
- Delete from sidebar (confirmation prompt, refresh list, selection reset).
- Import JSON file: empty file, conflict overwrite, skip conflict, missing schema case.
- Export JSON payload: verify filename `saved-queries-<timestamp>.json` and payload structure (`version`, `items`).
- Detect variables from SQL (`{{var}}` regex) and sync run-time values.
- Run query with pagination on/off, including manual count fetch and count-only refresh path.
- Preview SQL after execute/preview/explain paths.
- Explain with `text` vs `json` formats.
- Dynamic columns: auto-evaluated and manual trigger button (label "\u8ba1\u7b97") both update rows correctly.
- Run values missing -> server `vars_missing` error surfaces toast + inline message.
- Execute write-flag queries -> prompt for confirmation (`allowWrite`).
- Connection switch -> clears preview/results (`useCurrentConnId` effect).
- Calc items manual run and auto-run baseline (including hidden count calc).
- Notifications pipeline (`notifications.show`) for success/failure scenarios.

## Automated Test Status
- Command: `source ~/.nvm/nvm.sh && nvm use 20 && corepack pnpm test apps/web/app/queries`
- Result: Vitest exits with "No test files found", so no automated coverage exists for this page yet.
- Action: document this gap; test scaffolding will be required in later phases.

## Tracking & Ownership Notes
- Project board updates pending manual action in the primary workspace (not accessible from the sandbox). Recommended to register Phase 0/1/2 tickets with owners and target windows once back on the main board.
- Coordinate with desktop team on shared components (`ResultsPanel`, `SmartGrid`) before refactor begins; current baseline shows runtime-only coupling via shared event types.

## Open Questions
- Confirm whether the `CalcItemDef` type discrepancy is intentional (desktop fork?) before adjusting type definitions in Phase 1.
- Decide whether bundle analysis should wait for the type fix or be captured via `next build --turbo --profile` after temporarily patching types.
- Determine preferred tooling for profiler exports (Chrome vs. React DevTools standalone) so the team collects comparable traces post-refactor.
