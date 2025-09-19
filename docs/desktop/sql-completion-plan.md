# Monaco SQL Completion Plan

## Current Development Plan

- **Schema metadata snapshot**: Reuse the captured DDL to build an in-memory snapshot shaped as `schema -> table -> columns`, enriched with column type, nullability, and key flags. Refresh the snapshot whenever the user switches connections.
- **Connection-aware sync**: When a connection is selected, push the corresponding metadata into a shared store (for example `SchemaMetadataStore`) so completion providers can resolve the active schema context. Handle schema refreshes by invalidating the cache and rehydrating from the latest DDL.
- **SQL completion provider**: Register `monaco.languages.registerCompletionItemProvider('sql', …)` and surface completions for table names, columns, and aliases. Trigger on `[' ', '.', '"']`, classify items with `CompletionItemKind.Table`/`Field`/`Keyword`, and populate documentation with column types.
- **Context analyzer**: Implement a lightweight analyzer that scans the current model for `FROM`/`JOIN` clauses, tracks alias-to-table mappings, detects CTE names, and infers visible columns. Fall back to broad suggestions when the analyzer cannot confidently identify the context.
- **Monaco wiring**: Extend `configureMonaco` in `apps/desktop/src/lib/monaco.ts` to call the SQL completion setup after `loader.init()`. Expose update hooks so the provider reacts to connection changes without re-registering.
- **Deliverable**: Ship a first-pass autocomplete that covers table lookup and column suggestions, plus basic alias handling, and document the behavior in the desktop integration notes.

## Future Enhancements

- **Richer parsing**: Replace the regex-based analyzer with a proper SQL AST (e.g., leveraging `packages/query-engine` or a dedicated PostgreSQL parser) to improve accuracy for nested queries, CTE chains, and complex joins.
- **Hover and signature help**: Add hover providers that surface column metadata, table descriptions, and function signatures, and integrate snippet completions for common SQL templates.
- **Diagnostics**: Surface read-only validation or lint feedback (missing semicolons, disallowed statements) by reusing server-side checks or embedding a WASM parser.
- **LSP bridge**: Evaluate running a PostgreSQL-aware language server in a background worker or Tauri sidecar for full IntelliSense, schema validation, and formatting support.
- **Performance polish**: Profile bundle size and worker startup cost; prune unused Monaco languages or adopt lazy loading strategies if required.
- **User feedback loop**: Instrument the editor to capture autocomplete usage metrics and errors, and feed insights back into prioritizing future improvements.

## Implementation Notes (2025-09-18)

- Added `apps/desktop/src/lib/schema-metadata-store.ts` to hydrate an in-memory snapshot (`schema -> table -> columns`) from the local schema cache. The store listens for connection changes, exposes `subscribeSchemaMetadata`, and can be refreshed via `ensureSchemaMetadataForConnection` or `applySchemaMetadataPayload` after manual introspection.
- Hooked `/schema` refreshes into the store so that newly introspected metadata is immediately reflected in completion results without reloading the editor (`applySchemaMetadataPayload` invoked after both cache reads and writes).
- Created `apps/desktop/src/lib/sql-completion.ts`, registering a Monaco completion provider for `sql` with trigger characters `[' ', '.', '"']`. The provider maps aliases from `FROM`/`JOIN` clauses, understands schema-qualified table names, and suggests tables, scoped columns (`alias.column`), and SQL keywords with column documentation sourced from introspection metadata.
- Extended `configureMonaco` (`apps/desktop/src/lib/monaco.ts`) to initialize the SQL completion provider once Monaco is loaded.
- Updated `SqlEditor` to request schema metadata for the active connection on mount/change, ensuring the completion provider always has the latest snapshot.
- Type-checking via `pnpm --filter @rei-db-view/desktop typecheck` currently fails in this environment because the sandboxed Node runtime rejects Corepack's use of the `??=` operator. Run the script locally with Node ≥ 16 and Corepack enabled to validate the build.

