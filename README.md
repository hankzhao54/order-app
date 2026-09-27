# Order App v2 — 订货配送系统

Ordering, central-kitchen production, dispatch, buy list, inventory and labels for the restaurant group.
Shares the Supabase project with the recipe app; everything lives in the `ordering` schema.

## Stack
Vite 7 · React 19 · TypeScript (strict) · React Router 7 · TanStack Query 5 · Supabase JS 2 · PWA.
No UI framework — a small design system in `src/ui` + `src/styles`. UI in English / Magyar / 中文.

## Run locally
```bash
npm install
cp .env.example .env.local   # Supabase URL + anon key (same project as the recipe app)
npm run dev
npm test          # unit tests (dates, permissions, kitchen grouping, translations…)
npm run build     # type-check + production build
```

## Database
The schema is unchanged from v1 — v2 only **adds** migration `007_v2_rpcs.sql`
(v1 keeps working against it, so both can run side by side during the switch).

1. Supabase → SQL Editor → run `supabase/migrations/007_v2_rpcs.sql` (safe to re-run).
2. Optional: run `supabase/tests/v2_rpc_tests.sql` and `supabase/tests/consistency_tests.sql`;
   both roll back and print `ALL … PASSED`.
3. Redeploy the `admin-create-user` Edge Function (it now accepts the `bar_staff` role):
   `npx supabase functions deploy admin-create-user --project-ref fuqkjwfbwtnkukxoytfj`

Fresh database from zero: `supabase/schema.sql`, then `supabase/migrations/001…007` in order.
(`supabase/legacy/` holds the original v1 bootstrap scripts, for reference only.)

### What 007 adds
Every multi-step write is one transactional, role-checked RPC — the browser never does two writes in a row:

| RPC | Replaces (v1) |
|---|---|
| `receive_items(ids)` | status flip + `add_batch` as two calls (could lose / double stock) |
| `mark_item_bought(id)` | dispatch desk writing `ready` directly — also resolves the linked buy-list task |
| `mark_item_unavailable(id, reason)` | direct status write |
| `send_item_to_buyer(id)` | *(new)* kitchen hands a purchase line to the driver's buy list |
| `set_orders_status(ids, action)` | client-side compare-and-swap; rules (all lines handled before complete, archive only when delivered, stores may cancel their own untouched order) now enforced in the DB |
| `update_order_line` / `delete_order_line` | direct table writes, now only while the line is pending |
| `edit_batch(id, qty)` | direct batch edit without a stock-move log |

## Structure
```
src/
  lib/        api.ts (every query/RPC), auth, permissions, i18n, dates, status, kitchen, inventory, csv
  lib/database.types.ts   generated from the schema (scripts/gen-db-types.py or `supabase gen types`)
  ui/         Button, Segmented, Stepper, Sheet, toasts & dialogs…
  layout/     AppShell — sidebar on desktop, bottom tab bar on phones
  features/   order · procurement · kitchen · dispatch · inventory · labels · history · reports · admin
```

## Roles
| Role | Can use |
|---|---|
| restaurant_orderer | Order, Buy list (requests), Receiving, History |
| store_manager | + Inventory, Catalog (no prices) |
| bar_staff | Inventory |
| driver | Dispatch, Buy list (buying), History (all stores) |
| kitchen_manager | Kitchen, Dispatch, Labels, Inventory (all sites), Receiving, Reports, Order for any store |
| admin | everything + Dashboard, Catalog prices, Suppliers, Locations, Users, Audit log, Settings |

v1 URLs (`/procurement`, `/admin/dashboard`) redirect to their v2 pages.
