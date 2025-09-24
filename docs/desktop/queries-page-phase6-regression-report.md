# Desktop Queries Page Phase 6 Regression Report (2025-09-24)

## Scope
- Confirm the refactored queries workspace remains functionally equivalent after Phases 0–5.
- Validate saved query management, temporary query execution, runtime calculations, and script tasks.
- Capture outstanding risks or follow-up actions before handing the module back to product/QA.

## Code Snapshot
- Branch: `feat/tauri-edition`
- Commit window: all changes merged up to 2025-09-24 prior to Phase 6 delivery.
- Key files: `apps/desktop/src/routes/queries.tsx`, hooks under `apps/desktop/src/hooks/queries/`.
- File length check: `apps/desktop/src/routes/queries.tsx` is 950 lines (`wc -l`), satisfying the <1200 LoC acceptance bar.

## Automated Tests
| Command | Target | Status | Notes |
| --- | --- | --- | --- |
| `source ~/.nvm/nvm.sh && nvm use 20 && pnpm test apps/desktop/src/hooks/queries/useQueryExecutor.test.ts` | Execution flow hook | Pass | Covers preview/execute/explain branches, pagination refresh, count-only path |
| `... pnpm test apps/desktop/src/hooks/queries/usePaginationState.test.ts` | Pagination settings persistence | Pass | Verifies localStorage integration and reset behaviour |
| `... pnpm test apps/desktop/src/hooks/queries/useSavedSqlSelection.test.ts` | Saved/temporary state container | Pass | Confirms reset, load, and mode switching |
| `... pnpm test apps/desktop/src/hooks/queries/useQueryApiScriptTask.test.ts` | Script task lifecycle | Pass | Exercises success, cancel, failure fallback branches |
| `... pnpm test apps/desktop/src/hooks/queries/useRuntimeCalc.test.ts` | Runtime calculation engine | Pass | Validates SQL aggregate refresh and JS calculators |

## Manual Regression Checklist
| Scenario | Result | Evidence / Notes |
| --- | --- | --- |
| Load saved query tree with persisted folder expansion | Blocked | Desktop build cannot start (`tauri dev`) under sandbox; requires verification on host machine |
| Switch between saved query and temporary query modes | Blocked | UI smoke pending external run |
| Create, save, reopen, and delete queries | Blocked | To be executed once desktop runtime is available |
| Import/export saved queries JSON (conflict + missing schema) | Blocked | Need manual confirmation with representative fixtures |
| Execute preview/execute/explain across temp & saved queries | Blocked | Requires backend connectivity |
| Trigger runtime calc items (auto + manual) | Blocked | Dependent on successful query execution |
| Pagination on/off toggles with count-only refresh | Blocked | Requires interactive session |
| Script task execution, cancel, download log, clear history | Blocked | Tauri command channel inaccessible in sandbox |
| Connection switch resets preview/results and calc state | Blocked | Awaiting manual verification |
| Notifications/confirm prompts (write guard, vars missing) | Blocked | Needs user-driven flow |

## Known Issues & Follow-ups
- **Sandbox limitations** prevent launching the desktop app and validating manual scenarios. Coordinate with the desktop QA owner to execute the checklist on a local environment (macOS/Windows) using the Phase 6 branch build.
- Ensure the regression run captures screenshots/logs, especially for script tasks and runtime calc behaviours, to establish a new baseline.
- No open Vitest failures observed; however, end-to-end coverage still relies on manual QA.

## Sign-off Plan
1. Share this report with product/QA and schedule an acceptance session.
2. Once manual checks complete, update the checklist in this document to reflect `Pass` statuses and capture any anomalies.
3. If additional issues are identified, log them under desktop backlog with clear reproduction steps.
