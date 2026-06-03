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
2. Project Settings → API → Exposed schemas → add `ordering`.
3. Create users via Supabase Auth, then assign role/location in the Users admin
   page (or directly: `insert into ordering.profiles (user_id, role) ...`).

## Roles & routing
- `restaurant_orderer` → /order (own location only; enforced by RLS)
- `kitchen_manager`    → /kitchen (sees all, sets 🍳/🛒 per line, completes)
- `admin`              → /admin/* (catalog / locations / users) + everything above

## Notes
- `default_fulfillment` on a catalog item is only a suggestion; the kitchen sets
  the real make/buy per line on the order, so "sometimes make, sometimes buy"
  items just get toggled at order time.
- Add app icons at `public/icon-192.png` and `public/icon-512.png` for the PWA.
- This is a v1 scaffold: ordering + kitchen processing + catalog/location/user
  admin. History rollups, cost reports and printing come later.
