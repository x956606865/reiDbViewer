# Queries Page Optimization Plan

## Overview
- Refactor the saved queries page in `apps/web/app/queries/page.tsx` to reduce complexity, improve maintainability, and unblock future feature work.
- Guided by findings in `queries-page-optimization-analysis.md`, focusing on responsibility separation, state management cleanup, API normalization, and dynamic column safety.
- Desktop app consumers should be able to reuse the resulting hooks/services without adopting web-only dependencies.

## Goals
- Decompose the monolithic page into testable, well-scoped modules (state hooks, service layer, presentation components).
- Eliminate duplicated workflow logic for executing, previewing, explaining, deleting, and importing/exporting saved queries.
- Standardize API access patterns, error handling, and local persistence utilities.
- Preserve all current user journeys while improving observability and regression coverage.

## Non-Goals
- Introducing new database schema changes or additional backend endpoints.
- Migrating to `@tanstack/react-query` immediately (planned as a follow-up if time allows).
- Reimagining UX flows beyond structural cleanups; UI/UX adjustments are limited to supporting the refactor.

## Success Metrics
- Reduce page-level React component size from ~1.1k LOC to <500 LOC while keeping top-level page responsibility minimal.
- Cut the number of ad-hoc React state holders (`useState`) by at least 50%, replacing them with organized reducers/hooks.
- All critical flows (list, create/update, delete, execute, explain, import/export, dynamic columns) covered by automated or scripted regression checks.
- Zero high-severity regressions reported during two release cycles after launch.

## Phase Plan

### Phase 0 — Preparation & Baseline (0.5 week)
**Objectives**
- Establish scope, ownership, and baseline measurements before refactoring begins.

**Key Tasks**
- Catalogue current saved queries flows and document mandatory regression checklist.
- Capture baseline metrics: bundle size (via `next build` analyze), render timings (React Profiler), editor/event logs.
- Create tracking tickets per phase in project board; align with desktop team on shared components.
- Verify existing unit tests status (`pnpm test apps/web/app/queries/*`); log gaps.

**Deliverables**
- Baseline metrics report committed to docs (`docs/desktop/queries-page-baseline.md`).
- Regression checklist covering UI flows and API edge cases.
- Updated workboard with owners and target dates.

**Acceptance Criteria**
- Sign-off from product/tech leads on scope and baseline metrics documented.
- No outstanding unknowns regarding API contracts and auth requirements.

**Metrics & Validation**
- Baseline captured for later comparison; no code changes merged until document approved.

### Phase 1 — Cleanup & Persistence Utilities (1 week)
**Objectives**
- Remove dead code, align state resets, and introduce shared persistence helpers to stabilize current behavior.

**Key Tasks**
- Delete unused variables (`currentConnLabel`, `tree`) and align `clearEditor` side effects.
- Implement `usePersistentSet` hook for localStorage-backed sets; migrate expanded folders and extra folders to it.
- Audit state initialization paths, ensuring consistent resets when switching connections or clearing editors.
- Update lint rules/tests to prevent reintroduction of unused fields.

**Deliverables**
- New `usePersistentSet` utility with unit tests covering init, update, storage unavailability fallbacks.
- Simplified page component with removed unused logic and documented state transitions.

**Acceptance Criteria**
- All existing manual regression checklist items pass without behavioral drift.
- Vitest suite for persistence utilities runs green locally and in CI.
- Code review confirms no regressions in saved queries functionality.

**Metrics & Validation**
- LOC reduced in page component by ≥10% through removals and helper extraction.
- localStorage interactions consolidated through the new hook (validated via static analysis or search).

### Phase 2 — API Service Layer (1 week)
**Objectives**
- Centralize Saved SQL API interactions into reusable, typed helpers/hooks with consistent error semantics.

**Key Tasks**
- Create `useSavedQueriesApi` (or module) encapsulating fetch logic for list, fetch, create/update, delete/archive, export/import.
- Normalize error handling for 501 (initialization), 409 (conflict), validation errors, and network failures.
- Provide typed results and errors for UI consumption, preparing optional integration with React Query.
- Update page component to consume the service layer; remove inline fetch logic.

**Deliverables**
- New API module with type exports placed under `apps/web/lib` or shared package.
- Unit tests covering success/failure branches including `suggestedSQL` propagation.
- Documentation snippet describing API usage patterns and error contracts.

**Acceptance Criteria**
- Page-level fetch logic fully delegates to the service module.
- Mocked Vitest tests validate error normalization, especially for initialization warnings.
- Manual regression confirms import/export and delete flows behave identically.

**Metrics & Validation**
- Duplicate fetch code reduced to zero; confirmed via `rg` search for removed inline endpoints.
- API helpers achieve >80% statement coverage.

### Phase 3 — Query Execution Abstraction (1 week)
**Objectives**
- Consolidate preview/execute/explain flows into a dedicated runner hook, ensuring consistent state and notifications.

**Key Tasks**
- Implement `useQueryRunner` managing execution state (loading flags, pagination, params, results, errors).
- Refactor `onPreview`, `onExecute`, `onExplain` to delegate to the runner; ensure cancellation and retry logic consistent.
- Extract shared UI notifications and confirmation helpers (`confirmAction`, `showNotification`).
- Validate dynamic variable substitution and missing-variable guard path.

**Deliverables**
- New hook exported (possibly from `apps/web/lib/query-runner.ts`) with accompanying typing.
- Tests for runner hook using Vitest + React Testing Library hooks to simulate success/failure.
- Updated notifications helper with coverage for toast types.

**Acceptance Criteria**
- Duplicate execution functions removed from the page component.
- QA verifies preview, execute, explain buttons share consistent behavior and messaging.
- Hook documents expected inputs/outputs and cancellation semantics.

**Metrics & Validation**
- Execution-related `useState` calls reduced by >60%, replaced by hook state.
- No regression in average execution latency (compare against Phase 0 baseline).

### Phase 4 — Component Decomposition & Dynamic Columns (1.5 weeks)
**Objectives**
- Restructure UI into focused components/contexts and confine dynamic column evaluation to safe boundaries.

**Key Tasks**
- Introduce `QueryEditorProvider` context providing editor state/actions to child components.
- Split Saved Queries page into container + `SavedQueriesSidebar`, `QueryEditorPanel`, `RunQueryPanel`, `ResultsPanel` with explicit props.
- Move dynamic column transformation into `ResultsPanel` helper; ensure `setRows` updates remain localized.
- Document component contract boundaries and data flow diagrams in docs.

**Deliverables**
- New component files with clear prop interfaces and minimal shared mutable state.
- Helper for dynamic column evaluation with defensive guards and tests covering failure cases.
- Updated Storybook (if available) or component-level visual regression harness.

**Acceptance Criteria**
- Component tree depth clarified; each major component under 300 LOC.
- Dynamic columns continue to work across manual scenarios (manual trigger, auto-run, error fallback).
- No inline `new Function` calls within page component; moved into isolated module with code comments on safety.

**Metrics & Validation**
- Rerun React Profiler to confirm re-render count reduced for sidebar interactions (>20% improvement target).
- Unit/integration tests added for context provider and dynamic column helper (>80% coverage on helper module).

### Phase 5 — Testing, Docs & Launch Readiness (1 week)
**Objectives**
- Harden coverage, finalize documentation, and complete rollout checklist.

**Key Tasks**
- Expand Vitest suites for persistence, API module, runner hook, dynamic columns, and confirm regression scripts.
- Update developer docs: add migration guide for new hooks, note shared usage for desktop app.
- Perform manual regression across browsers (Chrome, Firefox) and desktop wrapper.
- Prepare rollout plan, feature flag (if needed), and communication email/changelog.

**Deliverables**
- Test report summarizing automated coverage and manual regression outcome.
- Updated docs under `docs/desktop/` and `docs/web/` describing new architecture.
- Go/no-go checklist for release with owners.

**Acceptance Criteria**
- All automated tests green in CI; minimum coverage thresholds met.
- Regression checklist signed off by QA/product.
- Feature flag strategy documented; rollout approved.

**Metrics & Validation**
- Unit/integration test coverage above 70% for new modules.
- Zero open P0/P1 bugs related to the feature.

### Phase 6 — Optional Enhancements (post-launch, 1+ week as needed)
**Objectives**
- Pursue stretch goals once core refactor stabilizes.

**Key Tasks**
- Evaluate adopting `@tanstack/react-query`; define query keys and cache invalidation rules.
- Consider extracting shared saved queries package for desktop reuse.
- Profile bundle size and lazy-load heavy dependencies if beneficial.

**Acceptance Criteria**
- Stretch items only proceed after monitoring period (≥2 weeks) shows stable metrics.
- Additional work tracked as separate stories with dedicated acceptance tests.

## Cross-Phase Considerations
- **Risk Management**: monitor for API call regressions, especially bulk export/import; add throttling or batching if API indicates rate limits.
- **Security & Compliance**: ensure no new DB write paths introduced; continue using read-only sessions and encrypted DSN handling.
- **Coordination**: sync weekly with desktop team to confirm shared hook compatibility and highlight upcoming breaking changes.
- **Instrumentation**: add logging around API services and runner hook for error diagnosis, respecting PII constraints.

## Validation & Rollout Checklist
- Manual regression checklist executed at the end of Phase 5 and post-launch monitoring for two weeks.
- Optional feature flag or staged rollout (10% → 50% → 100%) depending on risk appetite.
- Post-launch retrospective capturing lessons learned and backlog adjustments.

## Timeline & Ownership
- Recommended total duration: ~6 weeks (excluding optional enhancements) with week-level checkpoints.
- Assign phase owners before Phase 1; ensure handoffs documented and code reviews scheduled in advance.
- Keep project board updated; flag blockers within 24 hours during stand-ups.
