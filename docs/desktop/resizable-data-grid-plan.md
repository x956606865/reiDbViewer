# Resizable Data Grid Plan

## Overview
We will introduce a new Mantine React Table (MRT) based grid component for query results that preserves the current visual style and feature set of `DataGrid`, while adding Excel-like column resizing. The component will eventually supersede `DataGrid` in both the desktop and web query results views, with a controlled rollout path.

## Goals
- Keep the existing query results UX (actions column, row drawer, monospace cells, borders) unchanged from the user's perspective.
- Enable interactive column resizing with persisted widths during a session.
- Maintain parity with the current column rendering (text, JSON, timestamps) and the fallback table layout when no rows exist.
- Provide an extensible configuration surface for future enhancements (sorting, filtering, virtualization) that can be toggled per usage site.

## Non-Goals
- Replacing the `SmartGrid` used in the Browse page.
- Introducing new sorting or filtering behaviour for query results (manual modes remain disabled for now).
- Changing database interaction or backend APIs.

## Current State Summary
- `DataGrid` is a custom table (`<table>` + `<colgroup>`) with heuristic column widths (`apps/desktop/src/components/DataGrid.tsx:31`).
- The grid auto-adds an "actions" column with `RowViewButton` to open a JSON drawer (`RowViewButton.tsx:18`).
- Styles include fixed border radius, striped rows, monospace body cells, and sticky action column.
- No column resizing, virtualization, or built-in MRT features.

## Proposed Component
- Create `ResizableDataGrid` (desktop first) that wraps `mantine-react-table` with:
  - Column definitions generated from `columns` props, mirroring cell rendering logic from `DataGrid`.
  - Optional injected columns (default actions column) via props to keep extension points clean.
  - Default column sizes derived from existing heuristics; MRT `columnResizeMode="onEnd"` and `enableColumnResizing=true`.
  - `enableSorting`, `enableColumnFilters`, and `enableColumnDragging` turned off by default, but overridable through props for future use.
  - Table container styles tuned to match the current card layout, including header typography, row striping, hover, sticky action column, and scroll behaviour.
  - Optional persistence hook for column widths (local component state first; follow-up to share across sessions if needed).
- Exported from `apps/desktop/src/components/ResizableDataGrid.tsx` (and analogue under `apps/web/components/`).

## UI / UX Parity Checklist
- [x] Header font weight, spacing, and background colour mirror `DataGrid`.
- [x] Body cells stay monospace with ellipsis overflow.
- [x] Sticky action column retains width (default 120px) and drawer behaviour.
- [x] "No data" row layout preserved.
- [x] Container respects parent `height` prop and existing padding.
- [x] Column resizing widths persist per Saved Query (column-name keyed).

## Implementation Steps
1. **Component Scaffolding (desktop)**
   - Copy heuristics from `DataGrid` into a shared utility (e.g. `lib/column-width.ts`).
   - Build initial MRT configuration with resizing enabled and other interactive features disabled.
   - Port cell renderers (TextCell, JsonCell, TimezoneCell, RowViewButton) into MRT column definitions.
   - Ensure actions column is appended when not supplied.
2. **Styling Adjustments**
   - Customize MRT Mantine props to match header/body styling and sticky action column.
   - Add tests or story capture (optional) to prevent regressions.
3. **Integration (desktop)**
   - Replace the legacy `DataGrid` usage in query results view (`apps/desktop/src/components/queries/ResultsPanel.tsx`).
   - Validate with realistic data (large result set, JSON columns, empty state).
4. **Column Width Persistence**
   - Store per-query column widths in local sqlite (`saved_sql_column_widths`).
   - Load/persist widths by column name when executing Saved Queries; clear on deletion.
5. **Web Port**
   - Mirror the component under `apps/web/components/ResizableDataGrid.tsx`.
   - Swap into `apps/web/components/queries/ResultsPanel.tsx` once desktop parity confirmed.
6. **Cleanup**
   - Remove old `DataGrid` once both query results and ops pages migrate, or keep temporarily for legacy fallback.
   - Update docs referencing `DataGrid` usage.

## Testing Strategy
- Unit-level rendering tests with React Testing Library (desktop) to verify:
  - Columns render expected cells based on data types.
  - Actions column is sticky and contains `RowViewButton`.
  - "No data" message appears when rows array is empty.
- Manual regression checklist:
  - Column resizing works for various column types and persists while component mounted.
  - Drawer opens, copy buttons work.
  - Width heuristics align with previous layout.
  - Scrollbars behave on large datasets (horizontal + vertical).

## Rollout Considerations
- Document fallback path so we can revert to `DataGrid` quickly if issues出现.
- Communicate the change in desktop release notes once stable.

## Open Questions
- Do we need session-level persistence for column widths? (LocalStorage would mirror Excel behaviour.)
- Should ops pages share the same component immediately or after query page rollout?
- Any accessibility updates required (draggable handles focus states)?

## Next Actions
1. Confirm acceptance of component API surface (props signature, feature toggles).
2. Implement desktop component and swap into query results with feature flag.
3. Conduct regression pass, then proceed with web implementation.
4. Plan follow-up ticket for width persistence if desired.
