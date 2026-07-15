# Order App — 订货配送系统 (frontend)

Independent front-end for the ordering & distribution system. Shares the same
Supabase project as the recipe app; all its tables live in the `ordering` schema.

## Stack
Vite + React + React Router + Supabase + PWA (matches the recipe app).

## Setup
```bash
npm install
cp .env.example .env.local   # fill in Supabase URL + anon key (same project as recipe app)
npm run dev
```

## Prerequisites in Supabase
1. Run `ordering_system_init.sql` once in the SQL Editor.
2. Apply the migrations in `supabase/migrations/` **in numeric order**
   (001 → 006). They are idempotent — re-running any of them is safe.
   001/002 duplicate the older root-level `supabase-procurement-orders.sql`
   and `supabase-store-manager-catalog.sql`; if you already ran those two,
   001/002 are no-ops.
3. Project Settings → API → Exposed schemas → add `ordering`.
4. Create users via Supabase Auth, then assign role/location in the Users admin
   page (or directly: `insert into ordering.profiles (user_id, role) ...`).
5. Optional: run `supabase/tests/consistency_tests.sql` in the SQL Editor to
   verify the RPCs / RLS / triggers (it rolls itself back, no data left).

## Roles & routing
- `restaurant_orderer` → /order, /procurement, /history. Orders + buy-list
  requests for their own location only (enforced by RLS).
- `store_manager`      → everything the orderer has, plus /inventory and
  /admin/catalog (add/edit products & categories; supplier prices stay
  admin-only).
- `kitchen_manager`    → /kitchen, /labels, /dispatch, /reports, /inventory.
  Confirms production, fulfils from stock, completes orders.
- `driver`             → /dispatch, /procurement. Works the buy list
  (bought / can't) and delivers; cannot create or delete other people's
  buy-list entries.
- `bar_staff`          → /inventory only (stocktake for their location).
- `admin`              → /admin/* (dashboard / catalog / suppliers /
  locations / users) + everything above.

## Data-consistency architecture (migrations 003–006)
- `created_by` on orders/procurement_tasks is stamped by a DB trigger from
  `auth.uid()` — client-supplied ids are ignored.
- Status transitions for orders, order lines and buy-list tasks are validated
  by DB triggers; the frontend state machine (`src/lib/orderLifecycle.js`) is
  a convenience layer and additionally uses compare-and-swap updates
  (`.eq(status, expected)`) so two clients can't overwrite each other.
- Multi-step flows run as transactional RPCs: `submit_order` (create/merge,
  incl. procurement orders + their buy-list tasks), `kitchen_set_produced` /
  `kitchen_reset_item` / `kitchen_use_stock` (production, undo, DB-level
  stock reservations), `dispatch_items` (stock check + FIFO consume + status,
  all-or-nothing), `set_procurement_task_status` / `delete_procurement_task`
  (task change + order-line cascade + parent-order recompute).

## Notes
- `default_fulfillment` on a catalog item decides make vs buy per line (a DB
  trigger copies it onto each order line at insert).
- Procurement orders (`order_type = 'procurement'`) skip the kitchen: lines go
  straight to the driver's buy list and the parent order auto-completes when
  every line is resolved.
- Add app icons at `public/icon-192.png` and `public/icon-512.png` for the PWA.
