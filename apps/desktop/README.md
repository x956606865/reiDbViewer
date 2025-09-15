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
- SQL plugin permissions are restricted to `load` and `select` only.
- Local sqlite database: `sqlite:rdv_local.db` with basic tables created via migrations.
- Env defaults live in `src/lib/env.ts` and can be overridden with `VITE_*` vars.
