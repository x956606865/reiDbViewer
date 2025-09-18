# Monaco Editor Integration Plan (Desktop App)

## Current State
- SQL editing (`SqlEditor.tsx`) and calculated field scripting (`CalcItemsEditor.tsx`) use Mantine `Textarea`, providing no syntax services.
- Variable detection, validation, and saved SQL templating run on the backend; the UI cannot surface inline feedback.
- User roadmap (`docs/desktop/开发计划.md`) calls out "sql 编辑时，应该有代码提示" and "优化编辑体验"; Monaco aligns with that goal.

## Library Evaluation
### Monaco Editor Core (`monaco-editor`)
- Provides the VS Code editing surface, APIs for models, themes, commands, and language services.
- Ships SQL and JavaScript language definitions via `monaco-editor/esm/vs/basic-languages/*` contributions.
- Supports custom completion and hover providers (`monaco.languages.registerCompletionItemProvider`) to surface Saved SQL variables and helper snippets.(Reference: Monaco Editor README API section)

### React Wrapper (`@monaco-editor/react`)
- Officially maintained wrapper that works with React 19 via the `@next` tag.(Reference: @monaco-editor/react README)
- Exposes `beforeMount`, `onMount`, and `onChange(value)` callbacks, letting us reuse existing state handlers and register Monaco services.(Reference: @monaco-editor/react README lifecycle callbacks)
- Provides Vite-specific worker bootstrapping guidance; no extra webpack-specific tooling required.(Reference: @monaco-editor/react README Vite worker setup)

### Alternatives Considered
- `@monaco-editor/loader` without the React wrapper: more manual lifecycle management, no benefit for our simple use-cases.
- `monaco-editor-wrapper` / `monaco-languageclient`: unnecessary until we pursue full LSP integration.
- CodeMirror: lighter bundle, but poorer SQL ecosystem and no drop-in parity with VS Code keybindings.

## Feasibility in Tauri + Vite
- Vite 5 supports bundling web workers via the `?worker` suffix, matching Monaco's ESM entrypoints.(Reference: @monaco-editor/react README Vite worker setup)
- Tauri WebView loads assets from the app bundle; relying on CDN is discouraged. We can configure `loader.config({ monaco })` to use locally bundled files and lazy-initialize Monaco only when an editor mounts.
- Monaco's footprint (~2.5 MB minified) is acceptable; we can defer loading with `React.lazy` to avoid slowing the main window bootstrap.

## Proposed Architecture
1. **Shared `CodeEditor` Wrapper**
   - Place in `apps/desktop/src/components/code/CodeEditor.tsx`.
   - Encapsulate Monaco mounting, theming, resize handling (`automaticLayout`), and optional status bar slots.
   - Props: `language`, `value`, `onChange`, `height`, `options`, `onMountExtensions` (async callback for language services).
   - Export lazy-loaded version to avoid inflating the main bundle: `const CodeEditor = lazy(() => import('./CodeEditor'))`.

2. **SQL Editor Usage**
   - Replace `Textarea` inside `SqlEditor.tsx` with `CodeEditor`.
   - Load SQL syntax: `import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution'` inside the wrapper to ensure tree-shaking keeps only required language assets.
   - Register completion provider that surfaces `{{variable}}` snippets, schema keywords, and templating helpers.
   - Expose `Ctrl/Cmd+Enter` command that triggers the existing "run/preview" logic via Monaco's `addCommand` API.

3. **JS Editor Usage (Calc Items)**
   - Use `language="javascript"` and import `'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution'`.
   - Configure TypeScript defaults for better JS intellisense: `monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false })` and attach a `helpers` ambient type definition to improve autocompletion for `(vars, rows, helpers)`.
   - Provide lint-like markers for missing `return` using Monaco's diagnostics API (optional enhancement phase).

4. **Theme & Mantine Integration**
   - Map Mantine color scheme to Monaco themes (`vs` / `vs-dark`).
   - Optionally define a custom theme to match existing DataGrid palette via `monaco.editor.defineTheme`.

5. **Fallback Mode**
   - Keep a lightweight `Textarea` fallback (rendered while Monaco chunk loads or when initialization fails) to ensure editing remains possible in degraded environments.

## Implementation Steps
1. **Dependencies (require approval before install)**
   - `pnpm add -F @rei-db-view/desktop monaco-editor @monaco-editor/react@next` (React 19 compatible).
2. **Vite Worker Configuration**
   - Create `apps/desktop/src/lib/monaco.ts`:
     ```ts
     import * as monaco from 'monaco-editor';
     import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
     import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
     import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
     import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
     import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

     self.MonacoEnvironment = {
       getWorker(_, label) {
         if (label === 'json') return new jsonWorker();
         if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
         if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
         if (label === 'typescript' || label === 'javascript') return new tsWorker();
         return new editorWorker();
       },
     } as any;

     export { monaco };
     ```
     Then call `loader.config({ monaco })` before rendering the editor.(Reference: @monaco-editor/react README loader configuration)
3. **Create `CodeEditor` Component**
   - Wrap `<Editor>` from `@monaco-editor/react`, forward props, connect Mantine theme, and expose imperative refs for commands.
   - Implement loading boundary with Mantine `Skeleton`.
4. **Update SQL Editor**
   - Inject `CodeEditor` and wire `onDetectVars`, `onAddVar` buttons to Monaco commands (e.g., status bar actions or toolbar buttons).
   - Provide `keybindingService.addDynamicKeybinding` for `Ctrl/Cmd+Shift+F` to trigger formatting (optional future use).
5. **Update Calc Items Editor**
   - Replace `Textarea` per-row with `CodeEditor` collapsed inside table rows (consider modal or accordion to avoid cramped layout).
   - Provide `language` switch (`sql` vs `javascript`) based on row type.
6. **Type Definitions**
   - Add `.d.ts` ambient declaration describing helper signatures injected into JS editors.
7. **Testing & QA**
   - Add Vitest component tests using `@testing-library/react` + `@monaco-editor/react` test utilities (or mock loader) to ensure we pass value/onChange correctly.
   - Manual QA checklist: theme switching, keyboard shortcuts, large SQL files, offline start within packaged Tauri app.

## Performance Considerations
- Lazy-load Monaco chunk and show spinner to avoid blocking initial render.
- Dispose editor models when panels unmount to release memory (`editorRef.current?.dispose()`).
- Restrict bundled languages to SQL, JavaScript, JSON to keep worker size manageable.

## Risk & Mitigation
- **Worker path issues in production build**: verify Tauri bundle loads workers by running `pnpm build:ui` + `tauri dev --release`, adjust `MonacoEnvironment.getWorkerUrl` if packaging path differs.
- **Large bundle footprint**: monitor Vite bundle report; consider `vite-plugin-monaco-editor` later if we need finer pruning.
- **Accessibility regression**: keep toolbar buttons accessible, provide high-contrast theme using Monaco's HC theme when Mantine switches to color-scheme `auto`.
- **Undo stack reset on external updates**: use Monaco's `applyEdits` instead of `setValue` when syncing server-driven changes to preserve undo history.

## Rollout Checklist
1. Prototype within feature flag to allow fallback to `Textarea`.
2. Dogfood with Saved SQL workflows and calculate items.
3. Update desktop docs and onboarding notes, mentioning offline packaging.
4. Capture user feedback, iterate on completion sources, then remove fallback toggle.

## Future Enhancements
- Wire PostgreSQL metadata (column names, table signatures) into completion provider.
- Add SQL linting by embedding `pg_query` WASM or hooking to the backend preview endpoint.
- Explore Monaco diff editor for Saved SQL history comparisons.

## Implementation Notes (2025-09-18)
- Added `apps/desktop/src/lib/monaco.ts` to centralize worker wiring, language contributions, and shared Monaco defaults.
- Implemented a reusable `CodeEditor` wrapper at `apps/desktop/src/components/code/CodeEditor.tsx`, providing lazy loading, Mantine theme sync, and graceful fallback to `Textarea` on initialization failure.
- Replaced Mantine `Textarea` instances in `SqlEditor`, `DynamicColumnsEditor`, `CalcItemsEditor`, and enum option SQL inputs within `VariablesEditor` to leverage the shared Monaco editor.
- Pending: install `monaco-editor` and `@monaco-editor/react` in the desktop workspace (`pnpm add -F @rei-db-view/desktop @monaco-editor/react@next monaco-editor`) and run `pnpm --filter @rei-db-view/desktop typecheck` after dependency installation.
