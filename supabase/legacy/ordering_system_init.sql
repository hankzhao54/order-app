-- ============================================================
-- 订货配送系统 — 建库 SQL  (Ordering & Distribution System)
-- Target: shared Supabase / Postgres project (lives alongside the recipe app)
-- Everything is namespaced under schema "ordering" to avoid clashing with
-- the recipe app's tables (e.g. its own "orders"/"profiles").
--
-- HOW TO RUN
--   1. Paste this whole file into the Supabase SQL Editor and run once.
--   2. Dashboard > Project Settings > API > "Exposed schemas":
--        add  ordering   (so PostgREST / supabase-js can see these tables).
--   3. Create your first admin: sign a user up, grab their auth user id, then
--        insert into ordering.profiles (user_id, role) values ('<uuid>','admin');
-- ============================================================

create schema if not exists ordering;
create extension if not exists "pgcrypto";    -- gen_random_uuid()
create extension if not exists moddatetime;   -- auto updated_at

-- ============================================================
-- SECTION 1 — ENUMS
-- ============================================================
do $$ begin
  create type ordering.user_role        as enum ('restaurant_orderer','kitchen_manager','admin');
exception when duplicate_object then null; end $$;
do $$ begin
  create type ordering.fulfillment_type as enum ('make','purchase');
exception when duplicate_object then null; end $$;
do $$ begin
  create type ordering.order_type       as enum ('weekly','urgent');
exception when duplicate_object then null; end $$;
do $$ begin
  create type ordering.order_status     as enum ('draft','submitted','in_progress','completed','cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type ordering.order_item_status as enum ('pending','done');
exception when duplicate_object then null; end $$;

-- ============================================================
-- SECTION 2 — TABLES
-- ============================================================

-- 2.1 Locations  (soft-delete via is_active; 5th restaurant added later)
create table if not exists ordering.locations (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  name_en     text not null,
  name_hu     text,
  is_central  boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2.2 Profiles  (app-specific; keyed to the shared auth.users)
--     restaurant_orderer MUST have a location_id; kitchen_manager/admin see all.
create table if not exists ordering.profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  role        ordering.user_role not null default 'restaurant_orderer',
  location_id uuid references ordering.locations(id) on delete set null,
  full_name   text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint orderer_needs_location
    check (role <> 'restaurant_orderer' or location_id is not null)
);

-- 2.3 Categories  (bilingual)
create table if not exists ordering.categories (
  id          uuid primary key default gen_random_uuid(),
  name_en     text unique not null,
  name_hu     text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2.4 Catalog items
--     default_fulfillment is only a SUGGESTION shown to the kitchen; it may be
--     NULL ("undecided / sometimes make, sometimes buy"). The real decision is
--     recorded per line on order_items.fulfillment_type and never written back.
--     recipe_id links a make-able item to the recipe app (FK added in 2.4a).
create table if not exists ordering.catalog_items (
  id                  uuid primary key default gen_random_uuid(),
  name_en             text unique not null,
  name_hu             text,
  category_id         uuid references ordering.categories(id) on delete set null,
  default_fulfillment ordering.fulfillment_type,            -- nullable on purpose
  order_unit          text,                                 -- unit restaurants order in (bottle/box/g…)
  batch_yield_qty     numeric,                              -- for make items: yield per batch
  batch_yield_unit    text,
  recipe_id           uuid,                                 -- -> recipe app (see 2.4a)
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 2.4a OPTIONAL: link to the recipe app's recipes table.
--      Uncomment after confirming the real table/column name in the shared DB.
-- alter table ordering.catalog_items
--   add constraint catalog_items_recipe_fk
--   foreign key (recipe_id) references public.recipes(id) on delete set null;

-- 2.5 Suppliers
create table if not exists ordering.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  contact     text,
  note        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2.6 Item prices  (purchase price history; backend computes cost later)
create table if not exists ordering.item_prices (
  id              uuid primary key default gen_random_uuid(),
  catalog_item_id uuid not null references ordering.catalog_items(id) on delete cascade,
  supplier_id     uuid references ordering.suppliers(id) on delete set null,
  price           numeric not null,
  currency        text not null default 'HUF',
  pack_qty        numeric,                 -- e.g. price is for this many units
  pack_unit       text,
  effective_date  date not null default current_date,
  created_at      timestamptz not null default now()
);
create index if not exists item_prices_item_idx
  on ordering.item_prices (catalog_item_id, effective_date desc);

-- 2.7 Orders
create table if not exists ordering.orders (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references ordering.locations(id),
  created_by   uuid references auth.users(id) on delete set null,
  order_type   ordering.order_type not null default 'weekly',
  status       ordering.order_status not null default 'draft',
  week_of      date,                         -- for weekly orders
  note         text,
  created_at   timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  updated_at   timestamptz not null default now()
);
create index if not exists orders_location_idx on ordering.orders (location_id, status);

-- 2.8 Order items
--     Catalog line  -> catalog_item_id set, snapshot filled from catalog on insert.
--     Ad-hoc line   -> catalog_item_id NULL, item_name_snapshot required (free text).
--     fulfillment_type + status are set/updated by the kitchen per line.
create table if not exists ordering.order_items (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references ordering.orders(id) on delete cascade,
  catalog_item_id    uuid references ordering.catalog_items(id) on delete set null,
  item_name_snapshot text not null,                 -- name as it was at order time
  unit_snapshot      text,
  quantity           numeric not null default 1,
  fulfillment_type   ordering.fulfillment_type,      -- kitchen sets 🍳/🛒 per line
  status             ordering.order_item_status not null default 'pending',
  note               text,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  constraint adhoc_needs_name
    check (catalog_item_id is not null or item_name_snapshot is not null)
);
create index if not exists order_items_order_idx on ordering.order_items (order_id);

-- 2.9 OPTIONAL — weekly fixed-order templates (reusable standing orders).
--     Safe to drop these two tables if you decide to re-enter weekly orders by hand.
create table if not exists ordering.order_templates (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references ordering.locations(id) on delete cascade,
  name        text not null,
  order_type  ordering.order_type not null default 'weekly',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists ordering.order_template_items (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references ordering.order_templates(id) on delete cascade,
  catalog_item_id uuid references ordering.catalog_items(id) on delete set null,
  item_name_snapshot text not null,
  unit_snapshot   text,
  default_qty     numeric not null default 1
);

-- ============================================================
-- SECTION 3 — TRIGGERS
-- ============================================================

-- 3.1 auto updated_at on all tables that have the column
do $$
declare t text;
begin
  foreach t in array array[
    'locations','profiles','categories','catalog_items','suppliers',
    'orders','order_templates'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on ordering.%I;
       create trigger set_updated_at before update on ordering.%I
       for each row execute procedure moddatetime(updated_at);', t, t);
  end loop;
end $$;

-- 3.2 fill order_items snapshot from catalog when not provided
create or replace function ordering.fill_order_item_snapshot()
returns trigger language plpgsql as $$
begin
  if new.catalog_item_id is not null then
    if new.item_name_snapshot is null then
      select name_en into new.item_name_snapshot
      from ordering.catalog_items where id = new.catalog_item_id;
    end if;
    if new.unit_snapshot is null then
      select order_unit into new.unit_snapshot
      from ordering.catalog_items where id = new.catalog_item_id;
    end if;
    if new.fulfillment_type is null then
      select default_fulfillment into new.fulfillment_type
      from ordering.catalog_items where id = new.catalog_item_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists fill_snapshot on ordering.order_items;
create trigger fill_snapshot before insert on ordering.order_items
for each row execute procedure ordering.fill_order_item_snapshot();

-- 3.3 stamp completed_at when a line flips to done
create or replace function ordering.stamp_item_completed()
returns trigger language plpgsql as $$
begin
  if new.status = 'done' and (old.status is distinct from 'done') then
    new.completed_at := now();
  elsif new.status = 'pending' then
    new.completed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists stamp_completed on ordering.order_items;
create trigger stamp_completed before update on ordering.order_items
for each row execute procedure ordering.stamp_item_completed();

-- ============================================================
-- SECTION 4 — RLS HELPERS  (SECURITY DEFINER → no recursion on profiles)
-- ============================================================
create or replace function ordering.my_role()
returns ordering.user_role language sql stable security definer
set search_path = ordering, public as $$
  select role from ordering.profiles where user_id = auth.uid();
$$;

create or replace function ordering.my_location()
returns uuid language sql stable security definer
set search_path = ordering, public as $$
  select location_id from ordering.profiles where user_id = auth.uid();
$$;

create or replace function ordering.is_staff()
returns boolean language sql stable security definer
set search_path = ordering, public as $$
  select coalesce(ordering.my_role() in ('kitchen_manager','admin'), false);
$$;

-- ============================================================
-- SECTION 5 — GRANTS  (RLS still filters rows; these just expose the schema)
-- ============================================================
grant usage on schema ordering to anon, authenticated;
grant select, insert, update, delete on all tables in schema ordering to authenticated;
grant usage, select on all sequences in schema ordering to authenticated;
alter default privileges in schema ordering
  grant select, insert, update, delete on tables to authenticated;

-- ============================================================
-- SECTION 6 — ROW LEVEL SECURITY
-- ============================================================
alter table ordering.locations            enable row level security;
alter table ordering.profiles             enable row level security;
alter table ordering.categories           enable row level security;
alter table ordering.catalog_items        enable row level security;
alter table ordering.suppliers            enable row level security;
alter table ordering.item_prices          enable row level security;
alter table ordering.orders               enable row level security;
alter table ordering.order_items          enable row level security;
alter table ordering.order_templates      enable row level security;
alter table ordering.order_template_items enable row level security;

-- 6.1 profiles: read own; admin manages all
create policy profiles_self_read on ordering.profiles
  for select using (auth.uid() = user_id or ordering.my_role() = 'admin');
create policy profiles_admin_write on ordering.profiles
  for all using (ordering.my_role() = 'admin') with check (ordering.my_role() = 'admin');

-- 6.2 locations: everyone reads; admin writes
create policy locations_read on ordering.locations
  for select using (auth.role() = 'authenticated');
create policy locations_admin_write on ordering.locations
  for all using (ordering.my_role() = 'admin') with check (ordering.my_role() = 'admin');

-- 6.3 categories & catalog: everyone reads; admin writes
create policy categories_read on ordering.categories
  for select using (auth.role() = 'authenticated');
create policy categories_admin_write on ordering.categories
  for all using (ordering.my_role() = 'admin') with check (ordering.my_role() = 'admin');

create policy catalog_read on ordering.catalog_items
  for select using (auth.role() = 'authenticated');
create policy catalog_admin_write on ordering.catalog_items
  for all using (ordering.my_role() = 'admin') with check (ordering.my_role() = 'admin');

-- 6.4 suppliers & prices: staff read; admin writes
create policy suppliers_staff_read on ordering.suppliers
  for select using (ordering.is_staff());
create policy suppliers_admin_write on ordering.suppliers
  for all using (ordering.my_role() = 'admin') with check (ordering.my_role() = 'admin');

create policy prices_staff_read on ordering.item_prices
  for select using (ordering.is_staff());
create policy prices_admin_write on ordering.item_prices
  for all using (ordering.my_role() = 'admin') with check (ordering.my_role() = 'admin');

-- 6.5 orders: orderer limited to own location; staff see/handle all
create policy orders_read on ordering.orders
  for select using (ordering.is_staff() or location_id = ordering.my_location());
create policy orders_orderer_insert on ordering.orders
  for insert with check (
    ordering.is_staff()
    or (location_id = ordering.my_location() and created_by = auth.uid()));
create policy orders_update on ordering.orders
  for update using (ordering.is_staff() or location_id = ordering.my_location())
  with check (ordering.is_staff() or location_id = ordering.my_location());
create policy orders_admin_delete on ordering.orders
  for delete using (ordering.my_role() = 'admin');

-- 6.6 order_items: follow parent order's visibility
create policy order_items_read on ordering.order_items
  for select using (exists (
    select 1 from ordering.orders o where o.id = order_id
      and (ordering.is_staff() or o.location_id = ordering.my_location())));
create policy order_items_write on ordering.order_items
  for all using (exists (
    select 1 from ordering.orders o where o.id = order_id
      and (ordering.is_staff() or o.location_id = ordering.my_location())))
  with check (exists (
    select 1 from ordering.orders o where o.id = order_id
      and (ordering.is_staff() or o.location_id = ordering.my_location())));

-- 6.7 templates: orderer manages own location; staff all
create policy templates_rw on ordering.order_templates
  for all using (ordering.is_staff() or location_id = ordering.my_location())
  with check (ordering.is_staff() or location_id = ordering.my_location());
create policy template_items_rw on ordering.order_template_items
  for all using (exists (
    select 1 from ordering.order_templates t where t.id = template_id
      and (ordering.is_staff() or t.location_id = ordering.my_location())))
  with check (exists (
    select 1 from ordering.order_templates t where t.id = template_id
      and (ordering.is_staff() or t.location_id = ordering.my_location())));

-- ============================================================
-- SECTION 7 — SEED DATA
-- ============================================================

-- 7.1 Locations (central kitchen + 4 known restaurants; 5th restaurant TBD — add later via admin)
insert into ordering.locations (code, name_en, name_hu, is_central) values
  ('CENTRAL','Central Kitchen','Központi konyha',true),
  ('BISTRO101','101 Bistro','101 Bistro',false),
  ('NEO101','101 Neo','101 Neo',false),
  ('TOM','Time Out Market','Time Out Market',false),
  ('CZAKO','Czako','Czako',false)
on conflict (code) do nothing;

-- 7.2 Categories
insert into ordering.categories (name_en, name_hu, sort_order) values
  ('Sauces & Pastes','Szószok és paszták',10),
  ('Stocks & Broths','Alaplevek',20),
  ('Dumplings & Buns','Gombóc és bao',30),
  ('Dough & Buns','Bao és kelt tészta',40),
  ('Prepared Items','Elkészített tételek',50),
  ('Fermented & Pickled','Fermentált és savanyított',60),
  ('Proteins (raw)','Nyers hús',70),
  ('Oils','Olajok',80),
  ('Seasonings & Spices','Fűszerek és ízesítők',90),
  ('Marinades & Brines','Pác és sólé',100),
  ('Packaging & Disposables','Csomagolás és eldobható',110),
  ('Grains & Rice','Gabona és rizs',120),
  ('Starches & Flours','Keményítők és lisztek',130),
  ('Equipment & Supplies','Felszerelés és kellék',140),
  ('Seafood','Tenger gyümölcsei',150),
  ('Vegetables & Fresh','Zöldség és friss áru',160),
  ('Desserts & Mooncake','Desszert és holdtorta',170),
  ('Noodles & Wrappers','Tészta és tekercslap',180),
  ('Dried Goods & Nuts','Szárazáru és magvak',190),
  ('Equipment & Tools','Eszköz és szerszám',200),
  ('Dairy & Eggs','Tejtermék és tojás',210),
  ('Tofu & Bean','Tofu és bab',220),
  ('Tea & Botanicals','Tea és növények',230)
on conflict (name_en) do nothing;

-- 7.3 Catalog items (176). default_fulfillment is only a suggestion;
--      the kitchen sets the real make/purchase per line on order_items.fulfillment_type.
insert into ordering.catalog_items
  (name_en, name_hu, category_id, default_fulfillment, order_unit, batch_yield_qty, batch_yield_unit)
values
  ('San Bei Sauce','San Bei Szósz',(select id from ordering.categories where name_en='Sauces & Pastes'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('Chicken Sauce','Csirke Szósz',(select id from ordering.categories where name_en='Sauces & Pastes'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('Luro Sauce','Luro Szósz',(select id from ordering.categories where name_en='Sauces & Pastes'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('Consommé','Erőleves',(select id from ordering.categories where name_en='Stocks & Broths'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('Xiao Long Pork','Xiao Long Sertés',(select id from ordering.categories where name_en='Dumplings & Buns'),'make'::ordering.fulfillment_type,'db',90,'db'),
  ('Xiao Long Veg','Xiao Long Vega',(select id from ordering.categories where name_en='Dumplings & Buns'),'make'::ordering.fulfillment_type,'db',90,'db'),
  ('Mantao Bao 42g','Mantao Bao 42g',(select id from ordering.categories where name_en='Dough & Buns'),'make'::ordering.fulfillment_type,'db',54,'db'),
  ('Gua Bao 42g','Gua Bao 42g',(select id from ordering.categories where name_en='Dough & Buns'),'make'::ordering.fulfillment_type,'db',54,'db'),
  ('Luro Portions','Luro Porciók',(select id from ordering.categories where name_en='Prepared Items'),'make'::ordering.fulfillment_type,'db',12,'db'),
  ('Beef Portions','Marha Porciók',(select id from ordering.categories where name_en='Prepared Items'),'make'::ordering.fulfillment_type,'db',15,'db'),
  ('Pulled Beef','Tépett Marha',(select id from ordering.categories where name_en='Prepared Items'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('Crispy Chicken Skin','Csirke Bőr Ropogós',(select id from ordering.categories where name_en='Prepared Items'),'make'::ordering.fulfillment_type,'g',3500,'g'),
  ('Crispy Shiitake','Shiitake Ropogós',(select id from ordering.categories where name_en='Prepared Items'),'make'::ordering.fulfillment_type,'db',16,'db'),
  ('Koji Rice','Koji Rízs',(select id from ordering.categories where name_en='Fermented & Pickled'),'make'::ordering.fulfillment_type,'g',2000,'g'),
  ('Sliced Guanciale','Szeletelt Guanciale',(select id from ordering.categories where name_en='Prepared Items'),'make'::ordering.fulfillment_type,'g',1000,'g'),
  ('Kimchi','Kimcsi',(select id from ordering.categories where name_en='Fermented & Pickled'),'make'::ordering.fulfillment_type,'g',1000,'g'),
  ('Pork Chuck','Tarja',(select id from ordering.categories where name_en='Proteins (raw)'),'purchase'::ordering.fulfillment_type,'g',2500,'g'),
  ('Beef Bones','Marha Csont',(select id from ordering.categories where name_en='Proteins (raw)'),'make'::ordering.fulfillment_type,'g',5000,'g'),
  ('Chicken Fat','Csirke Zsír',(select id from ordering.categories where name_en='Prepared Items'),'make'::ordering.fulfillment_type,'g',1000,'g'),
  ('Lard Dressing','Lard Dressing',(select id from ordering.categories where name_en='Sauces & Pastes'),'make'::ordering.fulfillment_type,'g',1000,'g'),
  ('Pumpkin Seed Nutella','Tökmag Nutella',(select id from ordering.categories where name_en='Sauces & Pastes'),'make'::ordering.fulfillment_type,'g',1500,'g'),
  ('Chilli Oil','Chilli Olaj',(select id from ordering.categories where name_en='Oils'),'make'::ordering.fulfillment_type,'g',1000,'g'),
  ('Chilli Crumbs','Chilli Morzsa',(select id from ordering.categories where name_en='Seasonings & Spices'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('Tare','Tare',(select id from ordering.categories where name_en='Sauces & Pastes'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('Chicken Marinade','Csirke Marinád',(select id from ordering.categories where name_en='Marinades & Brines'),'make'::ordering.fulfillment_type,'g',1500,'g'),
  ('Char Siu Marinade','Char Siu Marinád',(select id from ordering.categories where name_en='Marinades & Brines'),'make'::ordering.fulfillment_type,'g',5000,'g'),
  ('Fermented Kohlrabi (whole)','Fermentált Karalábé (egész)',(select id from ordering.categories where name_en='Fermented & Pickled'),'make'::ordering.fulfillment_type,'g',2000,'g'),
  ('Fermented Kohlrabi (sliced)','Fermentált Karalábé (szeletelt)',(select id from ordering.categories where name_en='Fermented & Pickled'),'make'::ordering.fulfillment_type,'g',2000,'g'),
  ('Red Braise','Red Braise',(select id from ordering.categories where name_en='Sauces & Pastes'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('Taiwanese Chicken','Taiwani Csirke',(select id from ordering.categories where name_en='Prepared Items'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('Chopsticks','Evőpálcika',(select id from ordering.categories where name_en='Packaging & Disposables'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Delivery box','Elviteles doboz',(select id from ordering.categories where name_en='Packaging & Disposables'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Rubberband','Befőttes gumi',(select id from ordering.categories where name_en='Packaging & Disposables'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Chicken Salt','Csirke Só',(select id from ordering.categories where name_en='Seasonings & Spices'),'make'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Pepper Sauce','Bors mártás',(select id from ordering.categories where name_en='Sauces & Pastes'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('Mirin','Mirin',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Soy Sauce','Szója Szósz',(select id from ordering.categories where name_en='Sauces & Pastes'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Rice','Rízs',(select id from ordering.categories where name_en='Grains & Rice'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Shaoxing Wine','Shaoxing Bor',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('MSG','MSG',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Hoisin Sauce','Hoisin Szósz',(select id from ordering.categories where name_en='Sauces & Pastes'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Sesame Oil','Szezám olaj',(select id from ordering.categories where name_en='Oils'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Sesame Seed','Szezám mag',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Rice Vinegar','Rizs ecet',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Tapioca Pearl','Tápióka gyöngy',(select id from ordering.categories where name_en='Starches & Flours'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Sticky Rice Flour','Ragacsos rizsliszt',(select id from ordering.categories where name_en='Starches & Flours'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Potato Starch','Burgonya keményítő',(select id from ordering.categories where name_en='Starches & Flours'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Corn Starch','Kukorica keményítő',(select id from ordering.categories where name_en='Starches & Flours'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Box Top (lid only)','Elviteles doboz tető (CSAK tető)',(select id from ordering.categories where name_en='Packaging & Disposables'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Fryer Oil','Fritu olaj',(select id from ordering.categories where name_en='Oils'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Baking Powder','Sütőpor',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Coal','Szén',(select id from ordering.categories where name_en='Equipment & Supplies'),'purchase'::ordering.fulfillment_type,'g',5000,'g'),
  ('Plum Salt','Szilva só',(select id from ordering.categories where name_en='Seasonings & Spices'),'make'::ordering.fulfillment_type,'g',1000,'g'),
  ('Oyster','Osztriga',(select id from ordering.categories where name_en='Seafood'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Cantonese Ham','Cantonese Sonka',(select id from ordering.categories where name_en='Proteins (raw)'),'purchase'::ordering.fulfillment_type,'g',1000,'g'),
  ('Devil Olives','Sárga Ördögbogyó',(select id from ordering.categories where name_en='Vegetables & Fresh'),'purchase'::ordering.fulfillment_type,'g',1000,'g'),
  ('Pork','Sertés',(select id from ordering.categories where name_en='Proteins (raw)'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Gloves (L)','Kesztyű (L)',(select id from ordering.categories where name_en='Packaging & Disposables'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Dan Dan Sauce','Dan dan szósz',(select id from ordering.categories where name_en='Sauces & Pastes'),'make'::ordering.fulfillment_type,'g',1000,'g'),
  ('Shio Koji','Shio Koji',(select id from ordering.categories where name_en='Fermented & Pickled'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('Chocolate Brownie Base','Csoki Mooncake alap',(select id from ordering.categories where name_en='Desserts & Mooncake'),'make'::ordering.fulfillment_type,'g',1000,'g'),
  ('Popcorn Salt','Popcorn Só',(select id from ordering.categories where name_en='Seasonings & Spices'),'make'::ordering.fulfillment_type,'g',1000,'g'),
  ('Beef Fat','Marha faggyú',(select id from ordering.categories where name_en='Prepared Items'),'purchase'::ordering.fulfillment_type,'g',1000,'g'),
  ('Calamari Toast Mix','Tintahal Toast Mix',(select id from ordering.categories where name_en='Prepared Items'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('Dan Dan Noodle','Dan dan tészta',(select id from ordering.categories where name_en='Noodles & Wrappers'),'make'::ordering.fulfillment_type,'g',10000,'g'),
  ('Ramen','Ramen tészta',(select id from ordering.categories where name_en='Noodles & Wrappers'),'make'::ordering.fulfillment_type,'g',10000,'g'),
  ('Beef Tongue','Marha nyelv',(select id from ordering.categories where name_en='Proteins (raw)'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('Wild Garlic Pesto','Medvehagyma pesto',(select id from ordering.categories where name_en='Sauces & Pastes'),'make'::ordering.fulfillment_type,'g',1000,'g'),
  ('Matcha Brownie Base','Matcha Mooncake alap',(select id from ordering.categories where name_en='Desserts & Mooncake'),'make'::ordering.fulfillment_type,'g',1000,'g'),
  ('Fresh Lotus Root','Friss Lótusz Gyökér',(select id from ordering.categories where name_en='Vegetables & Fresh'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Cashew','Kesudió',(select id from ordering.categories where name_en='Dried Goods & Nuts'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Mustard','Mustár',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Butternut Squash Ketchup','Vajtök ketchup',(select id from ordering.categories where name_en='Sauces & Pastes'),'make'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Chinese Chef''s Cleaver','Kínai szakács bárd',(select id from ordering.categories where name_en='Equipment & Tools'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Mapo Tofu','Mapo Tofu',(select id from ordering.categories where name_en='Prepared Items'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('Bao Burger','Bao Burger',(select id from ordering.categories where name_en='Dough & Buns'),'make'::ordering.fulfillment_type,'db',12,'db'),
  ('Mantao Bao 65g','Mantao Bao 65g',(select id from ordering.categories where name_en='Dough & Buns'),'make'::ordering.fulfillment_type,'db',20,'db'),
  ('Gua Bao 65g','Gua Bao 65g',(select id from ordering.categories where name_en='Dough & Buns'),'make'::ordering.fulfillment_type,'db',20,'db'),
  ('Daikon Cake','Jégcsapretek Cake',(select id from ordering.categories where name_en='Prepared Items'),'make'::ordering.fulfillment_type,'db',16,'db'),
  ('Sweet & Sour Sauce','Édes Savanyú Szósz',(select id from ordering.categories where name_en='Sauces & Pastes'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('Pork Popcorn','Sertés Popcorn',(select id from ordering.categories where name_en='Prepared Items'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('Raspberry Mooncake','Málna Mooncake',(select id from ordering.categories where name_en='Desserts & Mooncake'),'make'::ordering.fulfillment_type,'db',28,'db'),
  ('Lu Wei Duck','Lu Wei Kacsa',(select id from ordering.categories where name_en='Prepared Items'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('Lu Wei Sauce','Lu Wei Szósz',(select id from ordering.categories where name_en='Sauces & Pastes'),'make'::ordering.fulfillment_type,'g',2500,'g'),
  ('XO Sauce','XO mártás',(select id from ordering.categories where name_en='Sauces & Pastes'),'make'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Youtiao','Youtiao',(select id from ordering.categories where name_en='Dough & Buns'),'make'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Raspberry Salt','Málnasó',(select id from ordering.categories where name_en='Seasonings & Spices'),'make'::ordering.fulfillment_type,'g',200,'g'),
  ('Pork Bao Sauce','Sertés Bao Szósz',(select id from ordering.categories where name_en='Sauces & Pastes'),'make'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Duck Sauce','Kacsa Szósz',(select id from ordering.categories where name_en='Sauces & Pastes'),'make'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Tapioca Crisp','Tápióka Ropogós',(select id from ordering.categories where name_en='Prepared Items'),'make'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Pickled Pineapple','Savanyított Ananász',(select id from ordering.categories where name_en='Fermented & Pickled'),'make'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('American Cheese','Amerikai Sajt',(select id from ordering.categories where name_en='Dairy & Eggs'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Fermented Black Beans','Fermentált Feketebab',(select id from ordering.categories where name_en='Fermented & Pickled'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Chinkiang Vinegar','Chinkiang Ecet',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Lemongrass','Citromfű',(select id from ordering.categories where name_en='Vegetables & Fresh'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Whole Dried Chilli','Egész szárított chilli',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Wood Ear Mushroom','Fafül Gomba',(select id from ordering.categories where name_en='Dried Goods & Nuts'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Fermented Light Tofu','Fermentált Világos Tofu',(select id from ordering.categories where name_en='Tofu & Bean'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Fermented Red Tofu','Fermentált Vörös Tofu',(select id from ordering.categories where name_en='Tofu & Bean'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Mushroom Powder','Gombapor',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Hong Kong Maggi','Hong Kongi Maggi (piros csillagos fajta)',(select id from ordering.categories where name_en='Sauces & Pastes'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Knorr Chicken Powder','Knorr Csirkepor',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Kombu','Kombu',(select id from ordering.categories where name_en='Dried Goods & Nuts'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Chinese Baking Powder','Kínai sütőpor',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Lotus Root','Lótusz Gyökér',(select id from ordering.categories where name_en='Vegetables & Fresh'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Oyster Sauce','Osztriga Szósz',(select id from ordering.categories where name_en='Sauces & Pastes'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Rose Wine','Rózsabor',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Shiitake','Shiitake',(select id from ordering.categories where name_en='Vegetables & Fresh'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Shiso','Shiso',(select id from ordering.categories where name_en='Vegetables & Fresh'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Sichuan Pepper','Szecsuáni Bors',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Sichuan Pepper Oil','Szecsuáni Bors Olaj',(select id from ordering.categories where name_en='Oils'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Sesame Seed Paste','Szezámmag Paszta',(select id from ordering.categories where name_en='Sauces & Pastes'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Rock Sugar','Szikla Cukor',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Yellow Chilli Paste','Sárga Chilli Paszta',(select id from ordering.categories where name_en='Sauces & Pastes'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Yellow Bean Paste','Sárgabab Paszta',(select id from ordering.categories where name_en='Sauces & Pastes'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Dark Soy Sauce','Sötét szójaszósz',(select id from ordering.categories where name_en='Sauces & Pastes'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Taiwanese Brown Sugar','Taiwani Barna Cukor',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Taiwanese Soy Sauce','Taiwani Szójaszósz',(select id from ordering.categories where name_en='Sauces & Pastes'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Tamarind Paste','Tamarind Paszta',(select id from ordering.categories where name_en='Sauces & Pastes'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Thai Basil','Thai Bazsalikom',(select id from ordering.categories where name_en='Vegetables & Fresh'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Tobanjan (Doubanjiang)','Tobanjan',(select id from ordering.categories where name_en='Sauces & Pastes'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Tofu','Tofu',(select id from ordering.categories where name_en='Tofu & Bean'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Light Soy Sauce','Világos szójaszósz',(select id from ordering.categories where name_en='Sauces & Pastes'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Red Yeast Rice','Vörös Koji',(select id from ordering.categories where name_en='Fermented & Pickled'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Zha Cai','Zha Chai (fish brand)',(select id from ordering.categories where name_en='Fermented & Pickled'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Baking Paper','Sütőpapír',(select id from ordering.categories where name_en='Packaging & Disposables'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Foil Pack','Foilpack',(select id from ordering.categories where name_en='Packaging & Disposables'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Miso','Miso',(select id from ordering.categories where name_en='Fermented & Pickled'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Goji','Goji',(select id from ordering.categories where name_en='Dried Goods & Nuts'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Wonton Wrappers','Wonton',(select id from ordering.categories where name_en='Noodles & Wrappers'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Enoki','Enoki',(select id from ordering.categories where name_en='Vegetables & Fresh'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Tapioca Starch','Tápióka keményítő',(select id from ordering.categories where name_en='Starches & Flours'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Fish Sauce','Halszósz',(select id from ordering.categories where name_en='Sauces & Pastes'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Rice Flour','Sima Rízsliszt',(select id from ordering.categories where name_en='Starches & Flours'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Shin Cup','Shin Cup',(select id from ordering.categories where name_en='Noodles & Wrappers'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Maltose','Maltóz',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Natto','Natto',(select id from ordering.categories where name_en='Fermented & Pickled'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Assam Tea','Assam tea',(select id from ordering.categories where name_en='Tea & Botanicals'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Lemongrass Tea','Citromfű tea',(select id from ordering.categories where name_en='Tea & Botanicals'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Dried Bonito Flakes','Katsuobushi',(select id from ordering.categories where name_en='Dried Goods & Nuts'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Black Sesame Seeds','Fekete Szezámmag',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Red Sichuan Pepper','Vörös Szecsuáni bors',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Cinnamon (whole)','Fahéj egész',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Wumei (Smoked Plum)','Wumei',(select id from ordering.categories where name_en='Dried Goods & Nuts'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Hawthorn','Galagonya',(select id from ordering.categories where name_en='Dried Goods & Nuts'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Black Cardamom','Fekete Kardamom',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Star Anise','Csillag Ánizs',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Plain Greek Yogurt','Natúr görög joghurt',(select id from ordering.categories where name_en='Dairy & Eggs'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Licorice Root','Édesgyökér',(select id from ordering.categories where name_en='Tea & Botanicals'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Persian Rose Buds','Perzsa rózsabimbó',(select id from ordering.categories where name_en='Tea & Botanicals'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Cashew Nuts','Kesu dió',(select id from ordering.categories where name_en='Dried Goods & Nuts'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Meat Tenderiser','Hús puhító',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Salted Duck Egg','Sózott kacsatojás',(select id from ordering.categories where name_en='Dairy & Eggs'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Dried Shiitake','Shiitake szárított',(select id from ordering.categories where name_en='Dried Goods & Nuts'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Steaming Basket','Gőzölő kosár',(select id from ordering.categories where name_en='Equipment & Tools'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Silk Tofu','Selyem tofu',(select id from ordering.categories where name_en='Tofu & Bean'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Canola Oil','Repce olaj',(select id from ordering.categories where name_en='Oils'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Chrysanthemum','Krizantém',(select id from ordering.categories where name_en='Tea & Botanicals'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Mooncake Mold','Mooncake nyomó',(select id from ordering.categories where name_en='Equipment & Tools'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Dried Shrimps','Száritott Garnéla',(select id from ordering.categories where name_en='Dried Goods & Nuts'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Dried Scallops','Szárított Fésűkagyló',(select id from ordering.categories where name_en='Dried Goods & Nuts'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Fermented Shrimp Paste','Fermentált rákpaszta',(select id from ordering.categories where name_en='Sauces & Pastes'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Fried Tofu','Rántott Tofu',(select id from ordering.categories where name_en='Tofu & Bean'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Glass Noodle','Üvegtészta',(select id from ordering.categories where name_en='Noodles & Wrappers'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Nori Sheets','Nori lap',(select id from ordering.categories where name_en='Dried Goods & Nuts'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Oolong Tea (Tian Hu Shan)','Oolong tea (tian hu shan)',(select id from ordering.categories where name_en='Tea & Botanicals'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Lobster','Homár',(select id from ordering.categories where name_en='Seafood'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Spring Roll Pastry','Tavaszi tekercs tészta',(select id from ordering.categories where name_en='Noodles & Wrappers'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Taro Root','Taro gyökér',(select id from ordering.categories where name_en='Vegetables & Fresh'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Fennel Seeds','Ánizs mag',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Metal Tray','Fém tálca',(select id from ordering.categories where name_en='Equipment & Tools'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Gochugaru','Gochugaru',(select id from ordering.categories where name_en='Seasonings & Spices'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Yang Mei (Bayberry)','Yang mei',(select id from ordering.categories where name_en='Dried Goods & Nuts'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Soybean','Szójabab',(select id from ordering.categories where name_en='Tofu & Bean'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Garlic Chives','Metélő fokhagyma',(select id from ordering.categories where name_en='Vegetables & Fresh'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL),
  ('Naruto (Fish Cake)','Naruto maki',(select id from ordering.categories where name_en='Seafood'),'purchase'::ordering.fulfillment_type,NULL,NULL,NULL)
on conflict (name_en) do nothing;
