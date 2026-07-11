# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Order App (订货配送系统) is the front-end for a restaurant ordering & distribution
system: stores place orders, a central kitchen makes/buys and dispatches them,
and a driver delivers. It is an independent Vite/React SPA that shares its
Supabase project with a separate "recipe app" — all of this app's tables live
in the non-default `ordering` Postgres schema so the two apps don't collide.

This is a v1 scaffold: ordering + kitchen processing + dispatch + procurement +
inventory + catalog/location/supplier/user admin. History rollups and cost
reports are basic; deeper reporting comes later.

## Commands

```bash
npm install
cp .env.example .env.local   # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev                  # Vite dev server
npm run build                # production build
npm run preview              # preview the production build
npm test                     # vitest run (all tests, once)
npx vitest                   # watch mode
npx vitest run src/lib/kitchen.test.js   # single test file
npx vitest run -t "some test name"       # single test by name
```

There is no lint/format script and no CI config — this repo relies on tests
plus manual review.

### Supabase setup (one-time, per project)

1. Run `supabase/schema.sql` in the SQL Editor to create the `ordering` schema
   (tables, enums, RLS policies). `ordering_system_init.sql` is the original
   v1 scaffold script kept for history — `supabase/schema.sql` is the
   authoritative, current dump of the live schema; prefer it.
2. Project Settings → API → Exposed schemas → add `ordering`.
3. Deploy the `admin-create-user` edge function (`supabase/functions/`) — the
   Users admin page calls it to create/deactivate/delete auth users with the
   service-role key, which the browser client never holds.
4. Create the first user via Supabase Auth, then set their role/location in
   `ordering.profiles` directly (later users go through the Users admin page).

## Architecture

### Stack

Vite + React 18 + React Router 6 + `@supabase/supabase-js` + vite-plugin-pwa.
Plain CSS (`src/index.css`), no CSS framework, no TypeScript, no state
management library — page-local `useState`/`useEffect` plus the shared
`ordering` Postgres schema as the source of truth. All Supabase reads/writes
happen directly from page components or the `src/lib/*` helpers; there is no
separate backend/API layer beyond the one edge function.

### Data flow: schema, RLS, and the frontend client

`src/lib/supabase.js` creates the single Supabase client, pinned to
`db: { schema: 'ordering' }` — every `supabase.from('table')` call anywhere in
the app implicitly targets `ordering.table`. Access control is enforced by
Postgres RLS policies (see `supabase/schema.sql`), keyed off
`ordering.profiles.role` and `location_id` — the frontend's route guards
(below) are a UX convenience, not the security boundary.

Core tables: `profiles` (role + location), `locations`, `categories` /
`catalog_items` (with `default_fulfillment`: make vs. purchase),
`suppliers` / `item_prices`, `orders` / `order_items`, `order_templates` /
`order_template_items` (saved weekly orders), `procurement_tasks` (buyer
queue), `location_stock` / `stock_batches` / `stock_moves` / `stock_returns`
(inventory), `user_favorites` / `location_favorites`, `app_settings`
(currently just the order cutoff config), `audit_log`.

`order_items.catalog_item_id` may be null for ad-hoc lines — those rows carry
their own `item_name_snapshot`/`unit_snapshot` instead of joining the catalog.
Every order line snapshots name/unit at creation time so later catalog edits
don't rewrite historical orders.

### Auth, roles, and routing

`AuthProvider` (`src/lib/AuthProvider.jsx`) wraps the app, tracks the Supabase
session, and loads the matching `ordering.profiles` row into `role` /
`locationId`. Roles: `restaurant_orderer`, `store_manager`, `kitchen_manager`,
`admin`, `driver`, `bar_staff`. `App.jsx` defines per-route `allow` lists
(arrays of roles) and wraps each `<Route>` in `RequireAuth` — an unauthenticated
user is bounced to `/login`, a signed-in user without a matching role is
bounced to `/`. `Home` (in `App.jsx`) redirects each role to its default
landing page. `/trace/:id` (QR traceability) is public/unauthenticated by
design; `/label/:id` and `/labels` are staff-only.

### Order/item/procurement lifecycle — the state machine

`src/lib/orderLifecycle.js` is the single place that knows which status
transitions are legal for `orders.status`, `order_items.dispatch_status` (plus
the derived `order_items.status`), and `procurement_tasks.status`. Before this
module existed, every page wrote these columns directly and re-derived legal
jumps by hand; now `transitionOrder`/`transitionItem`/`transitionProcurementTask`
(and their `*Bulk`/`*Upsert` variants for multi-row writes) validate the
from→to jump and throw `LifecycleError` on an illegal one instead of silently
writing inconsistent state. **When changing how an order or item moves through
its lifecycle, edit the transition tables here — don't add ad-hoc status
writes in a page.** Side effects that accompany a transition (stock RPCs,
creating `procurement_tasks` rows, etc.) stay in the calling page.

Order statuses: `draft → submitted → in_progress → completed/cancelled →
archived` (cancelled can restart at submitted or in_progress). Item dispatch
statuses: `pending → ready/short/unavailable/procuring → dispatched →
received`. Procurement: `pending ⇄ bought/unavailable`.

### Data-access helpers vs. page-local queries

`src/lib/db.js` has three thin wrappers (`fetchList`, `patchRow`, `insertRow`)
used for simple single-table reads/writes with consistent error reporting.
Pages still write bespoke Supabase queries (joins, filters, RPCs) directly
when the wrappers don't fit — there's no ORM or query-builder layer beyond
supabase-js itself.

`src/lib/orderData.js` holds the ordering-page-specific data flows: loading
the catalog+categories+favorites together, `submitOrder` (which merges a new
weekly order into an existing untouched weekly order for the same
`production_week`/location rather than always creating a new one — see
`findMergeTarget`), and order templates/history.

### Realtime and other shared lib modules

- `useRealtimeReload(tables, reload, paused)` (`src/lib/useRealtimeReload.js`):
  subscribes to Postgres changefeeds on the given tables and calls `reload`
  (debounced 400ms) on any change, so Kitchen/Dispatch/etc. stay live across
  devices. `paused` suspends reloading while a user is mid-edit so the screen
  doesn't jump under their fingers.
- `cutoff.js`: weekly order-cutoff logic (`isCutoffPassed`, `productionWeek`) —
  a weekly order placed after the configured cutoff rolls to next week's
  Monday. Cutoff config is read from `app_settings`.
- `kitchen.js`: pure helpers for the Kitchen page — production-bucket
  sorting (urgent/event/this week/next week) and the by-item aggregation
  across stores. Kept free of Supabase/React so it's unit-testable.
- `inventory.js`: pure helpers for expiry/low-stock classification and weight
  formatting on the Inventory page.
- `username.js`: usernames without `@` get a synthetic
  `...@restaurant.local` email for Supabase Auth (staff log in with a
  username, not a real email).
- `csv.js`: CSV export used by history/reports pages.

Files ending in `.test.js` (`orderLifecycle.test.js`, `kitchen.test.js`,
`inventory.test.js`) cover exactly the pure-logic modules above by mocking
`./supabase` where needed (see `orderLifecycle.test.js` for the pattern) —
there is no integration/e2e test layer.

### Pages (`src/pages/`)

One file per route, matching `App.jsx`'s route list: `OrderingPage` (store
order placement + templates + history top-ups), `KitchenPage` (production
view, by-order and by-item), `DispatchPage`, `ProcurementPage` (buyer queue),
`InventoryPage`, `HistoryPage`, `ReportsPage`, `TracePage`/`LabelPage`/
`LabelsPage` (QR traceability labels, printable), and `admin/*`
(`Dashboard`, `CatalogAdmin`, `LocationsAdmin`, `SuppliersAdmin`,
`UsersAdmin`). Admin pages call the `admin-create-user` edge function for
anything requiring the service-role key (creating/banning/deleting auth
users); everything else goes straight through the anon-key client under RLS.

### PWA / bundled docs

`vite-plugin-pwa` is configured in `vite.config.js`. `public/user-guide.html`
and `public/user-guide-hu.html` are standalone bilingual (EN/HU) help pages
linked from the nav — they're excluded from the PWA's navigate-fallback
(`navigateFallbackDenylist`) so opening them doesn't fall back to the SPA
shell.

## Conventions

- UI strings and catalog data are bilingual EN/HU (`name_en`/`name_hu` columns
  throughout); don't assume English-only content when touching catalog/
  location/category display code.
- Snapshot fields (`item_name_snapshot`, `unit_snapshot`) on order/template
  items are intentional history, not denormalization to clean up.
- Bulk status writes should go through the `*Bulk`/`*Upsert` helpers in
  `orderLifecycle.js` (one batched query) rather than looping per-row updates.
