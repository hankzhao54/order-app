# Order App v2 — 订货 + 菜谱 一体系统

Ordering, central-kitchen production, dispatch, buy list, inventory, labels **and recipes** for the restaurant group —
one app, one login, one database (everything in the `ordering` schema).

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
3. Run `supabase/migrations/008_recipe_roles.sql` **on its own** (adds the `chef` / `kitchen_staff` roles —
   Postgres needs this committed before 009 can use them).
4. Run `supabase/migrations/009_merge_recipes.sql` (safe to re-run). Read the NOTICE output: it lists any
   person whose recipe-app role differs from their ordering role (the ordering role wins).
5. Optional: run `supabase/tests/recipes_merge_tests.sql` — prints `ALL RECIPE MERGE TESTS PASSED`.
6. Redeploy the `admin-create-user` Edge Function (it now accepts `bar_staff`, `chef`, `kitchen_staff`):
   `npx supabase functions deploy admin-create-user --project-ref fuqkjwfbwtnkukxoytfj`

Fresh database from zero: `supabase/schema.sql`, then `supabase/migrations/001…009` in order.
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

### What 009 does (recipe merge)
- Moves the recipe app's tables into `ordering`: `recipes`, `recipe_versions`, `recipe_categories` (data kept as-is).
- One user list: recipe-app users get an `ordering.profiles` row (admin→admin, chef→chef, staff→kitchen_staff);
  people who already had an ordering account keep their ordering role.
- One audit log: the recipe app's history is copied into `ordering.audit_log` (tagged `source: recipes-app`).
- `catalog_items.recipe_ref` links an orderable product to its recipe (auto-linked where the name matches exactly;
  edit in Catalog). The kitchen ticket shows a recipe button on linked lines.
- Recipe writes go through RPCs: `save_recipe`, `delete_recipe`, `restore_recipe_version`, `link_recipe`
  (every save keeps a version, last 30 kept).
- **Compatibility views** `public.recipes / recipe_versions / categories` keep the old recipe app working
  against the same data until you switch it off.

### Cutover for the recipe app
1. Run 008 + 009, deploy this app. Both apps now show the same recipes — edits in either appear in the other.
2. Tell the kitchen to use the new app (`/recipes`). Old QR codes (`…/#recipe/<id>`) work if the old
   recipe domain redirects to this app — in Vercel, point `restaurant-recipes-indol` at a redirect to the
   order app URL, keeping the hash.
3. After a few quiet weeks: `drop view public.recipes, public.recipe_versions, public.categories;`
   and archive the old repo. The storage bucket `recipe-images` stays in use.

## Structure
```
src/
  lib/        api.ts (every query/RPC), auth, permissions, i18n, dates, status, kitchen, inventory, csv
  lib/database.types.ts   generated from the schema (scripts/gen-db-types.py or `supabase gen types`)
  ui/         Button, Segmented, Stepper, Sheet, toasts & dialogs…
  layout/     AppShell — sidebar on desktop, bottom tab bar on phones
  features/   order · procurement · kitchen · dispatch · inventory · labels · history · reports · recipes · admin
```

## Roles
| Role | Can use |
|---|---|
| restaurant_orderer | Order, Buy list (requests), Receiving, History, Recipes (view) |
| store_manager | + Inventory, Catalog (no prices) |
| bar_staff | Inventory |
| driver | Dispatch, Buy list (buying), History (all stores) |
| kitchen_manager | Recipes (full), Kitchen, Dispatch, Labels, Inventory (all sites), Receiving, Reports, Order for any store |
| chef | Recipes (view + create/edit) |
| kitchen_staff | Recipes (view only) |
| admin | everything + Dashboard, Catalog prices, Suppliers, Locations, Users, Audit log, Settings |

v1 URLs (`/procurement`, `/admin/dashboard`) redirect to their v2 pages.
