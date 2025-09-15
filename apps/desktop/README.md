# reiDbView Desktop (Tauri v2, Plan A)

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
- Keyring integration (set/get/delete) wired via custom Tauri commands and used by connection storage.
- Connection management page supports add, test, and set current; edit flow to be added.
- DSN validation covered by unit test; keyring mock tests pending.
