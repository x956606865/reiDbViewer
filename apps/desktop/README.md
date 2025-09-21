# Rei DbView Desktop (Tauri v2, Plan A)

This package contains the Tauri v2 desktop edition scaffold reusing the existing React components.

- Frontend: Vite + React + Mantine
- Backend: Tauri v2 (Rust) with `tauri-plugin-sql` (sqlite + postgres)

Dev (after installing deps):

```
pnpm -w install
pnpm --filter @rei-db-view/desktop dev:tauri
```

Notes:

- SQL plugin capabilities: `load`, `select`, and `execute` are enabled for the main window. We require `execute` for local SQLite migrations/writes; PostgreSQL access remains read-only at the app layer (see `src/lib/dbClient.ts`).
- Local sqlite database: `sqlite:rdv_local.db` with basic tables created via migrations.
- Env defaults live in `src/lib/env.ts` and can be overridden with `VITE_*` vars.

M1 status (as of 2025-09-15):

- Secrets now rely on encrypted SQLite (`app_prefs`) with AES-GCM; legacy keyring commands have been removed.
- Connection management page supports add, test, set current, and edit flows against the encrypted store.
- DSN validation covered by unit test; assistant secret storage tests ensure encrypted preferences work as expected.
