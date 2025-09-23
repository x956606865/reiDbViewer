# Saved Queries API Service Layer

The saved queries page now delegates all HTTP interactions for `/api/user/saved-sql` to `apps/web/lib/saved-queries-api.ts`. This module exposes a Fetch-agnostic client that the web page (and prospective desktop consumers) can reuse without duplicating request code.

## Exposed helpers

- `createSavedQueriesApi(fetchImpl?: FetchLike)` → factory returning a stable client with `list`, `get`, `create`, `update`, and `archive` methods.
- `useSavedQueriesApi(fetchImpl?: FetchLike)` → React hook wrapper used by `apps/web/app/queries/page.tsx`.
- `isSavedQueriesApiError(error)` / `SavedQueriesApiError` → guards for normalized error handling.

### Method contracts

| Method | HTTP call | Success payload | Notes |
| --- | --- | --- | --- |
| `list()` | `GET /api/user/saved-sql` | `SavedQueryListItem[]` | Normalizes timestamps to ISO strings and arrays to `[]`. |
| `get(id)` | `GET /api/user/saved-sql/:id` | `SavedQueryDetail` | Includes `sql`, `dynamicColumns`, and `calcItems`.
| `create(input)` | `POST /api/user/saved-sql` | `{ id: string \| null }` | Returns newly-created id when available.
| `update(id, patch)` | `PATCH /api/user/saved-sql/:id` | `void` | Accepts partial payload; omits undefined fields.
| `archive(id)` | `PATCH /api/user/saved-sql/:id` | `void` | Sends `{ isArchived: true }`.

## Error normalization

All non-OK responses (and network failures) become `SavedQueriesApiError` instances with a typed `error.type` field:

| Type | Conditions | Additional data |
| --- | --- | --- |
| `not_initialized` | HTTP 501 with `feature_not_initialized` | `suggestedSQL` (if provided). |
| `app_db_not_configured` | HTTP 501 with `app_db_not_configured` | – |
| `conflict` | HTTP 409 `name_exists` | `existingId` of the conflicting record. |
| `validation` | HTTP 400 or `vars_missing` | `detail` (zod errors) and optional `missing` variable list. |
| `not_found` | HTTP 404 | – |
| `unauthorized` | HTTP 401 or payload `unauthorized` | – |
| `network` | Fetch rejection | Original error surfaced via `cause`. |
| `unknown` | Any other status | Includes raw `error` code when available. |

Consumers use `isSavedQueriesApiError` to branch on these cases and drive UI (e.g., show `suggestedSQL` or prompt for overwrite). The web page keeps user-facing messaging inside the component, while the service guarantees consistent semantics for both web and desktop surfaces.

## Usage example

```ts
import { useSavedQueriesApi, isSavedQueriesApiError } from '@/lib/saved-queries-api';

const api = useSavedQueriesApi();

try {
  const items = await api.list();
  setItems(items.map(toSavedItem));
} catch (err) {
  if (isSavedQueriesApiError(err) && err.type === 'not_initialized') {
    setSuggestedSQL(err.suggestedSQL ?? null);
  }
  setError(err instanceof Error ? err.message : String(err));
}
```
