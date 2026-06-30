-- Schema dump of the `ordering` schema from the live Supabase project
-- (101 Recipe Book / order-app, project ref fuqkjwfbwtnkukxoytfj)
-- Generated via the Supabase Management API SQL endpoint on 2026-06-30
-- (supabase db dump was unavailable: no Docker in this environment).

SET check_function_bodies = off;

CREATE SCHEMA IF NOT EXISTS "ordering";

-- Enum types
CREATE TYPE "ordering"."fulfillment_type" AS ENUM ('make', 'purchase');
CREATE TYPE "ordering"."item_dispatch_status" AS ENUM ('pending', 'ready', 'short', 'unavailable', 'dispatched', 'procuring', 'received');
CREATE TYPE "ordering"."order_item_status" AS ENUM ('pending', 'done');
CREATE TYPE "ordering"."order_status" AS ENUM ('draft', 'submitted', 'in_progress', 'completed', 'cancelled', 'archived');
CREATE TYPE "ordering"."order_type" AS ENUM ('weekly', 'urgent', 'event');
CREATE TYPE "ordering"."procurement_status" AS ENUM ('pending', 'bought', 'unavailable');
CREATE TYPE "ordering"."user_role" AS ENUM ('restaurant_orderer', 'kitchen_manager', 'admin', 'driver', 'store_manager', 'bar_staff');

-- Tables
CREATE TABLE "ordering"."app_settings" (
    "key" text NOT NULL,
    "value" jsonb NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ordering"."audit_log" (
    "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "actor_id" uuid,
    "actor_name" text,
    "action" text NOT NULL,
    "target" text,
    "detail" jsonb
);

CREATE TABLE "ordering"."catalog_items" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "name_en" text NOT NULL,
    "name_hu" text,
    "category_id" uuid,
    "default_fulfillment" ordering.fulfillment_type,
    "order_unit" text,
    "batch_yield_qty" numeric,
    "batch_yield_unit" text,
    "recipe_id" uuid,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "stock_qty" numeric DEFAULT 0 NOT NULL,
    "stock_unit" text,
    "pack_note" text,
    "unit_weight" numeric,
    "weight_unit" text,
    "storage_location" text,
    "shelf_life_days" integer,
    "reorder_level" numeric,
    "vacuum_level" text
);

CREATE TABLE "ordering"."categories" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "name_en" text NOT NULL,
    "name_hu" text,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ordering"."item_prices" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "catalog_item_id" uuid NOT NULL,
    "supplier_id" uuid,
    "price" numeric NOT NULL,
    "currency" text DEFAULT 'HUF'::text NOT NULL,
    "pack_qty" numeric,
    "pack_unit" text,
    "effective_date" date DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ordering"."location_favorites" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "location_id" uuid NOT NULL,
    "catalog_item_id" uuid NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ordering"."location_stock" (
    "location_id" uuid NOT NULL,
    "catalog_item_id" uuid NOT NULL,
    "qty" numeric DEFAULT 0 NOT NULL,
    "storage_location" text,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "reorder_level" numeric
);

CREATE TABLE "ordering"."locations" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "code" text NOT NULL,
    "name_en" text NOT NULL,
    "name_hu" text,
    "is_central" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ordering"."order_items" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "order_id" uuid NOT NULL,
    "catalog_item_id" uuid,
    "item_name_snapshot" text NOT NULL,
    "unit_snapshot" text,
    "quantity" numeric DEFAULT 1 NOT NULL,
    "fulfillment_type" ordering.fulfillment_type,
    "status" ordering.order_item_status DEFAULT 'pending'::ordering.order_item_status NOT NULL,
    "note" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "completed_at" timestamp with time zone,
    "dispatch_status" ordering.item_dispatch_status DEFAULT 'pending'::ordering.item_dispatch_status NOT NULL,
    "fulfilled_qty" numeric,
    "unavail_reason" text,
    "handled_by" uuid,
    "dispatched_at" timestamp with time zone
);

CREATE TABLE "ordering"."order_template_items" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "template_id" uuid NOT NULL,
    "catalog_item_id" uuid,
    "item_name_snapshot" text NOT NULL,
    "unit_snapshot" text,
    "default_qty" numeric DEFAULT 1 NOT NULL
);

CREATE TABLE "ordering"."order_templates" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "location_id" uuid NOT NULL,
    "name" text NOT NULL,
    "order_type" ordering.order_type DEFAULT 'weekly'::ordering.order_type NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ordering"."orders" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "location_id" uuid NOT NULL,
    "created_by" uuid,
    "order_type" ordering.order_type DEFAULT 'weekly'::ordering.order_type NOT NULL,
    "status" ordering.order_status DEFAULT 'draft'::ordering.order_status NOT NULL,
    "week_of" date,
    "note" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "submitted_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "parent_order_id" uuid,
    "production_week" date,
    "event_name" text,
    "event_date" date
);

CREATE TABLE "ordering"."procurement_tasks" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "catalog_item_id" uuid,
    "item_name" text NOT NULL,
    "quantity" numeric DEFAULT 1 NOT NULL,
    "unit" text,
    "target_location_id" uuid,
    "source_order_item_id" uuid,
    "status" ordering.procurement_status DEFAULT 'pending'::ordering.procurement_status NOT NULL,
    "note" text,
    "unavail_reason" text,
    "created_by" uuid,
    "bought_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "bought_at" timestamp with time zone
);

CREATE TABLE "ordering"."profiles" (
    "user_id" uuid NOT NULL,
    "role" ordering.user_role DEFAULT 'restaurant_orderer'::ordering.user_role NOT NULL,
    "location_id" uuid,
    "full_name" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ordering"."stock_batches" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "location_id" uuid NOT NULL,
    "catalog_item_id" uuid NOT NULL,
    "qty" numeric DEFAULT 0 NOT NULL,
    "produced_on" date DEFAULT CURRENT_DATE NOT NULL,
    "expires_on" date,
    "note" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ordering"."stock_moves" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "catalog_item_id" uuid NOT NULL,
    "delta" numeric NOT NULL,
    "reason" text NOT NULL,
    "note" text,
    "order_item_id" uuid,
    "created_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "location_id" uuid
);

CREATE TABLE "ordering"."stock_returns" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "from_location" uuid NOT NULL,
    "to_location" uuid NOT NULL,
    "catalog_item_id" uuid NOT NULL,
    "qty" numeric NOT NULL,
    "expires_on" date,
    "status" text DEFAULT 'pending'::text NOT NULL,
    "note" text,
    "created_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "received_by" uuid,
    "received_at" timestamp with time zone
);

CREATE TABLE "ordering"."suppliers" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "contact" text,
    "note" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "ordering"."user_favorites" (
    "user_id" uuid NOT NULL,
    "catalog_item_id" uuid NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Primary keys, unique and check constraints
ALTER TABLE "ordering"."app_settings" ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY (key);
ALTER TABLE "ordering"."audit_log" ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY (id);
ALTER TABLE "ordering"."catalog_items" ADD CONSTRAINT "catalog_items_pkey" PRIMARY KEY (id);
ALTER TABLE "ordering"."catalog_items" ADD CONSTRAINT "catalog_items_name_en_key" UNIQUE (name_en);
ALTER TABLE "ordering"."categories" ADD CONSTRAINT "categories_pkey" PRIMARY KEY (id);
ALTER TABLE "ordering"."categories" ADD CONSTRAINT "categories_name_en_key" UNIQUE (name_en);
ALTER TABLE "ordering"."item_prices" ADD CONSTRAINT "item_prices_pkey" PRIMARY KEY (id);
ALTER TABLE "ordering"."location_favorites" ADD CONSTRAINT "location_favorites_pkey" PRIMARY KEY (id);
ALTER TABLE "ordering"."location_favorites" ADD CONSTRAINT "location_favorites_location_id_catalog_item_id_key" UNIQUE (location_id, catalog_item_id);
ALTER TABLE "ordering"."location_stock" ADD CONSTRAINT "location_stock_pkey" PRIMARY KEY (location_id, catalog_item_id);
ALTER TABLE "ordering"."locations" ADD CONSTRAINT "locations_pkey" PRIMARY KEY (id);
ALTER TABLE "ordering"."locations" ADD CONSTRAINT "locations_code_key" UNIQUE (code);
ALTER TABLE "ordering"."order_items" ADD CONSTRAINT "order_items_pkey" PRIMARY KEY (id);
ALTER TABLE "ordering"."order_items" ADD CONSTRAINT "adhoc_needs_name" CHECK (((catalog_item_id IS NOT NULL) OR (item_name_snapshot IS NOT NULL)));
ALTER TABLE "ordering"."order_template_items" ADD CONSTRAINT "order_template_items_pkey" PRIMARY KEY (id);
ALTER TABLE "ordering"."order_templates" ADD CONSTRAINT "order_templates_pkey" PRIMARY KEY (id);
ALTER TABLE "ordering"."orders" ADD CONSTRAINT "orders_pkey" PRIMARY KEY (id);
ALTER TABLE "ordering"."procurement_tasks" ADD CONSTRAINT "procurement_tasks_pkey" PRIMARY KEY (id);
ALTER TABLE "ordering"."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY (user_id);
ALTER TABLE "ordering"."profiles" ADD CONSTRAINT "orderer_needs_location" CHECK (((role <> 'restaurant_orderer'::ordering.user_role) OR (location_id IS NOT NULL)));
ALTER TABLE "ordering"."stock_batches" ADD CONSTRAINT "stock_batches_pkey" PRIMARY KEY (id);
ALTER TABLE "ordering"."stock_moves" ADD CONSTRAINT "stock_moves_pkey" PRIMARY KEY (id);
ALTER TABLE "ordering"."stock_returns" ADD CONSTRAINT "stock_returns_pkey" PRIMARY KEY (id);
ALTER TABLE "ordering"."suppliers" ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY (id);
ALTER TABLE "ordering"."user_favorites" ADD CONSTRAINT "user_favorites_pkey" PRIMARY KEY (user_id, catalog_item_id);

-- Foreign keys
ALTER TABLE "ordering"."catalog_items" ADD CONSTRAINT "catalog_items_category_id_fkey" FOREIGN KEY (category_id) REFERENCES ordering.categories(id) ON DELETE SET NULL;
ALTER TABLE "ordering"."item_prices" ADD CONSTRAINT "item_prices_catalog_item_id_fkey" FOREIGN KEY (catalog_item_id) REFERENCES ordering.catalog_items(id) ON DELETE CASCADE;
ALTER TABLE "ordering"."item_prices" ADD CONSTRAINT "item_prices_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES ordering.suppliers(id) ON DELETE SET NULL;
ALTER TABLE "ordering"."location_favorites" ADD CONSTRAINT "location_favorites_catalog_item_id_fkey" FOREIGN KEY (catalog_item_id) REFERENCES ordering.catalog_items(id) ON DELETE CASCADE;
ALTER TABLE "ordering"."location_favorites" ADD CONSTRAINT "location_favorites_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE "ordering"."location_favorites" ADD CONSTRAINT "location_favorites_location_id_fkey" FOREIGN KEY (location_id) REFERENCES ordering.locations(id) ON DELETE CASCADE;
ALTER TABLE "ordering"."location_stock" ADD CONSTRAINT "location_stock_catalog_item_id_fkey" FOREIGN KEY (catalog_item_id) REFERENCES ordering.catalog_items(id) ON DELETE CASCADE;
ALTER TABLE "ordering"."location_stock" ADD CONSTRAINT "location_stock_location_id_fkey" FOREIGN KEY (location_id) REFERENCES ordering.locations(id) ON DELETE CASCADE;
ALTER TABLE "ordering"."order_items" ADD CONSTRAINT "order_items_catalog_item_id_fkey" FOREIGN KEY (catalog_item_id) REFERENCES ordering.catalog_items(id) ON DELETE SET NULL;
ALTER TABLE "ordering"."order_items" ADD CONSTRAINT "order_items_handled_by_fkey" FOREIGN KEY (handled_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE "ordering"."order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY (order_id) REFERENCES ordering.orders(id) ON DELETE CASCADE;
ALTER TABLE "ordering"."order_template_items" ADD CONSTRAINT "order_template_items_catalog_item_id_fkey" FOREIGN KEY (catalog_item_id) REFERENCES ordering.catalog_items(id) ON DELETE SET NULL;
ALTER TABLE "ordering"."order_template_items" ADD CONSTRAINT "order_template_items_template_id_fkey" FOREIGN KEY (template_id) REFERENCES ordering.order_templates(id) ON DELETE CASCADE;
ALTER TABLE "ordering"."order_templates" ADD CONSTRAINT "order_templates_location_id_fkey" FOREIGN KEY (location_id) REFERENCES ordering.locations(id) ON DELETE CASCADE;
ALTER TABLE "ordering"."orders" ADD CONSTRAINT "orders_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE "ordering"."orders" ADD CONSTRAINT "orders_location_id_fkey" FOREIGN KEY (location_id) REFERENCES ordering.locations(id);
ALTER TABLE "ordering"."orders" ADD CONSTRAINT "orders_parent_order_id_fkey" FOREIGN KEY (parent_order_id) REFERENCES ordering.orders(id) ON DELETE SET NULL;
ALTER TABLE "ordering"."procurement_tasks" ADD CONSTRAINT "procurement_tasks_bought_by_fkey" FOREIGN KEY (bought_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE "ordering"."procurement_tasks" ADD CONSTRAINT "procurement_tasks_catalog_item_id_fkey" FOREIGN KEY (catalog_item_id) REFERENCES ordering.catalog_items(id) ON DELETE SET NULL;
ALTER TABLE "ordering"."procurement_tasks" ADD CONSTRAINT "procurement_tasks_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE "ordering"."procurement_tasks" ADD CONSTRAINT "procurement_tasks_source_order_item_id_fkey" FOREIGN KEY (source_order_item_id) REFERENCES ordering.order_items(id) ON DELETE SET NULL;
ALTER TABLE "ordering"."procurement_tasks" ADD CONSTRAINT "procurement_tasks_target_location_id_fkey" FOREIGN KEY (target_location_id) REFERENCES ordering.locations(id) ON DELETE SET NULL;
ALTER TABLE "ordering"."profiles" ADD CONSTRAINT "profiles_location_id_fkey" FOREIGN KEY (location_id) REFERENCES ordering.locations(id) ON DELETE SET NULL;
ALTER TABLE "ordering"."profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE "ordering"."stock_batches" ADD CONSTRAINT "stock_batches_catalog_item_id_fkey" FOREIGN KEY (catalog_item_id) REFERENCES ordering.catalog_items(id) ON DELETE CASCADE;
ALTER TABLE "ordering"."stock_batches" ADD CONSTRAINT "stock_batches_location_id_fkey" FOREIGN KEY (location_id) REFERENCES ordering.locations(id) ON DELETE CASCADE;
ALTER TABLE "ordering"."stock_moves" ADD CONSTRAINT "stock_moves_catalog_item_id_fkey" FOREIGN KEY (catalog_item_id) REFERENCES ordering.catalog_items(id) ON DELETE CASCADE;
ALTER TABLE "ordering"."stock_moves" ADD CONSTRAINT "stock_moves_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE "ordering"."stock_moves" ADD CONSTRAINT "stock_moves_location_id_fkey" FOREIGN KEY (location_id) REFERENCES ordering.locations(id);
ALTER TABLE "ordering"."stock_returns" ADD CONSTRAINT "stock_returns_catalog_item_id_fkey" FOREIGN KEY (catalog_item_id) REFERENCES ordering.catalog_items(id);
ALTER TABLE "ordering"."stock_returns" ADD CONSTRAINT "stock_returns_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE "ordering"."stock_returns" ADD CONSTRAINT "stock_returns_from_location_fkey" FOREIGN KEY (from_location) REFERENCES ordering.locations(id);
ALTER TABLE "ordering"."stock_returns" ADD CONSTRAINT "stock_returns_received_by_fkey" FOREIGN KEY (received_by) REFERENCES auth.users(id);
ALTER TABLE "ordering"."stock_returns" ADD CONSTRAINT "stock_returns_to_location_fkey" FOREIGN KEY (to_location) REFERENCES ordering.locations(id);
ALTER TABLE "ordering"."user_favorites" ADD CONSTRAINT "user_favorites_catalog_item_id_fkey" FOREIGN KEY (catalog_item_id) REFERENCES ordering.catalog_items(id) ON DELETE CASCADE;
ALTER TABLE "ordering"."user_favorites" ADD CONSTRAINT "user_favorites_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Indexes
CREATE INDEX audit_log_action_idx ON ordering.audit_log USING btree (action);
CREATE INDEX audit_log_created_idx ON ordering.audit_log USING btree (created_at DESC);
CREATE INDEX item_prices_item_idx ON ordering.item_prices USING btree (catalog_item_id, effective_date DESC);
CREATE INDEX location_favorites_loc_idx ON ordering.location_favorites USING btree (location_id, sort_order);
CREATE INDEX location_stock_loc_idx ON ordering.location_stock USING btree (location_id);
CREATE INDEX order_items_order_idx ON ordering.order_items USING btree (order_id);
CREATE INDEX orders_location_idx ON ordering.orders USING btree (location_id, status);
CREATE INDEX orders_parent_idx ON ordering.orders USING btree (parent_order_id);
CREATE INDEX procurement_status_idx ON ordering.procurement_tasks USING btree (status, created_at);
CREATE INDEX stock_batches_loc_item_idx ON ordering.stock_batches USING btree (location_id, catalog_item_id, expires_on);
CREATE INDEX stock_moves_item_idx ON ordering.stock_moves USING btree (catalog_item_id, created_at DESC);
CREATE INDEX stock_returns_from_idx ON ordering.stock_returns USING btree (from_location, status);
CREATE INDEX stock_returns_to_idx ON ordering.stock_returns USING btree (to_location, status);

-- Functions
CREATE OR REPLACE FUNCTION ordering.add_batch(p_loc uuid, p_item uuid, p_qty numeric, p_produced date DEFAULT CURRENT_DATE, p_expires date DEFAULT NULL::date, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ordering', 'public'
AS $function$
declare bid uuid; life int; exp date;
begin
  select shelf_life_days into life from ordering.catalog_items where id = p_item;
  exp := coalesce(p_expires, case when life is not null then p_produced + life else null end);
  insert into ordering.stock_batches (location_id, catalog_item_id, qty, produced_on, expires_on, note)
  values (p_loc, p_item, greatest(0,p_qty), p_produced, exp, p_note)
  returning id into bid;

  insert into ordering.stock_moves (catalog_item_id, delta, reason, note, created_by, location_id)
  values (p_item, p_qty, 'produced', p_note, auth.uid(), p_loc);

  perform ordering.sync_loc_qty(p_loc, p_item);
  return bid;
end $function$;

CREATE OR REPLACE FUNCTION ordering.add_loc_item(p_loc uuid, p_item uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'ordering', 'public'
AS $function$
  insert into ordering.location_stock (location_id, catalog_item_id, qty)
  values (p_loc, p_item, 0)
  on conflict (location_id, catalog_item_id) do nothing;
$function$;

CREATE OR REPLACE FUNCTION ordering.adjust_loc_stock(p_loc uuid, p_item uuid, p_delta numeric, p_reason text, p_note text DEFAULT NULL::text, p_order_item uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ordering', 'public'
AS $function$
declare new_qty numeric;
begin
  insert into ordering.location_stock (location_id, catalog_item_id, qty, updated_at)
  values (p_loc, p_item, greatest(0, p_delta), now())
  on conflict (location_id, catalog_item_id)
    do update set qty = greatest(0, ordering.location_stock.qty + p_delta), updated_at = now()
  returning qty into new_qty;

  insert into ordering.stock_moves (catalog_item_id, delta, reason, note, order_item_id, created_by, location_id)
  values (p_item, p_delta, coalesce(p_reason,'manual'), p_note, p_order_item, auth.uid(), p_loc);

  return new_qty;
end $function$;

CREATE OR REPLACE FUNCTION ordering.adjust_stock(p_item uuid, p_delta numeric, p_reason text, p_note text DEFAULT NULL::text, p_order_item uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ordering', 'public'
AS $function$
declare new_qty numeric;
begin
  update ordering.catalog_items
     set stock_qty = greatest(0, stock_qty + p_delta)
   where id = p_item
   returning stock_qty into new_qty;

  insert into ordering.stock_moves (catalog_item_id, delta, reason, note, order_item_id, created_by)
  values (p_item, p_delta, coalesce(p_reason,'manual'), p_note, p_order_item, auth.uid());

  return new_qty;
end $function$;

CREATE OR REPLACE FUNCTION ordering.consume_fifo(p_loc uuid, p_item uuid, p_qty numeric, p_reason text DEFAULT 'dispatched'::text, p_order_item uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ordering', 'public'
AS $function$
declare need numeric := greatest(0,p_qty); r record; take numeric; took numeric := 0;
begin
  for r in select id, qty from ordering.stock_batches
            where location_id = p_loc and catalog_item_id = p_item and qty > 0
            order by expires_on nulls last, produced_on, created_at
  loop
    exit when need <= 0;
    take := least(r.qty, need);
    update ordering.stock_batches set qty = qty - take where id = r.id;
    need := need - take; took := took + take;
  end loop;
  delete from ordering.stock_batches
    where location_id = p_loc and catalog_item_id = p_item and qty <= 0;

  if took > 0 then
    insert into ordering.stock_moves (catalog_item_id, delta, reason, note, order_item_id, created_by, location_id)
    values (p_item, -took, coalesce(p_reason,'dispatched'), null, p_order_item, auth.uid(), p_loc);
  end if;
  perform ordering.sync_loc_qty(p_loc, p_item);
  return took;
end $function$;

CREATE OR REPLACE FUNCTION ordering.fill_order_item_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION ordering.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ordering', 'public'
AS $function$
  select coalesce(ordering.my_role() in ('kitchen_manager','admin'), false);
$function$;

CREATE OR REPLACE FUNCTION ordering.log_audit(p_action text, p_target text DEFAULT NULL::text, p_detail jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ordering', 'public'
AS $function$
declare v_name text;
begin
  select full_name into v_name from ordering.profiles where user_id = auth.uid();
  insert into ordering.audit_log (actor_id, actor_name, action, target, detail)
  values (auth.uid(), coalesce(v_name, 'unknown'), p_action, p_target, p_detail);
end;
$function$;

CREATE OR REPLACE FUNCTION ordering.my_location()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ordering', 'public'
AS $function$
  select location_id from ordering.profiles where user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION ordering.my_role()
 RETURNS ordering.user_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ordering', 'public'
AS $function$
  select role from ordering.profiles where user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION ordering.receive_return(p_return uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ordering', 'public'
AS $function$
declare r record;
begin
  select * into r from ordering.stock_returns where id = p_return and status = 'pending';
  if not found then return; end if;

  insert into ordering.stock_batches (location_id, catalog_item_id, qty, produced_on, expires_on, note)
  values (r.to_location, r.catalog_item_id, r.qty, current_date, r.expires_on, 'returned from store');
  insert into ordering.stock_moves (catalog_item_id, delta, reason, note, created_by, location_id)
  values (r.catalog_item_id, r.qty, 'return_in', 'store return', auth.uid(), r.to_location);
  perform ordering.sync_loc_qty(r.to_location, r.catalog_item_id);

  update ordering.stock_returns set status = 'received', received_by = auth.uid(), received_at = now()
   where id = p_return;
end $function$;

CREATE OR REPLACE FUNCTION ordering.scrap_batch(p_batch uuid, p_note text DEFAULT 'expired'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ordering', 'public'
AS $function$
declare b record;
begin
  select * into b from ordering.stock_batches where id = p_batch;
  if not found then return; end if;

  insert into ordering.stock_moves (catalog_item_id, delta, reason, note, created_by, location_id)
  values (b.catalog_item_id, -b.qty, 'scrap', p_note, auth.uid(), b.location_id);

  delete from ordering.stock_batches where id = p_batch;
  perform ordering.sync_loc_qty(b.location_id, b.catalog_item_id);
end $function$;

CREATE OR REPLACE FUNCTION ordering.send_back(p_from uuid, p_item uuid, p_qty numeric, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ordering', 'public'
AS $function$
declare central uuid; took numeric; earliest date; rid uuid;
begin
  select id into central from ordering.locations where is_central = true and is_active = true order by created_at limit 1;
  if central is null then raise exception 'No central kitchen'; end if;

  -- 记录被扣批次里最早的到期日(沿用给中厨)
  select min(expires_on) into earliest from (
    select expires_on from ordering.stock_batches
     where location_id = p_from and catalog_item_id = p_item and qty > 0
     order by expires_on nulls last, produced_on limit 1
  ) t;

  took := ordering.consume_fifo(p_from, p_item, p_qty, 'return_out', null);
  if took <= 0 then raise exception 'No stock to send back'; end if;

  insert into ordering.stock_returns (from_location, to_location, catalog_item_id, qty, expires_on, note, created_by)
  values (p_from, central, p_item, took, earliest, p_note, auth.uid())
  returning id into rid;
  return rid;
end $function$;

CREATE OR REPLACE FUNCTION ordering.set_loc_stock(p_loc uuid, p_item uuid, p_value numeric, p_note text DEFAULT 'stocktake'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ordering', 'public'
AS $function$
declare cur numeric;
begin
  select qty into cur from ordering.location_stock where location_id = p_loc and catalog_item_id = p_item;
  if cur is null then
    insert into ordering.location_stock (location_id, catalog_item_id, qty) values (p_loc, p_item, 0);
    cur := 0;
  end if;
  perform ordering.adjust_loc_stock(p_loc, p_item, p_value - cur, 'stocktake', p_note, null);
  return p_value;
end $function$;

CREATE OR REPLACE FUNCTION ordering.set_stock(p_item uuid, p_value numeric, p_note text DEFAULT 'count'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ordering', 'public'
AS $function$
declare cur numeric;
begin
  select stock_qty into cur from ordering.catalog_items where id = p_item;
  return ordering.adjust_stock(p_item, p_value - coalesce(cur,0), 'count', p_note, null);
end $function$;

CREATE OR REPLACE FUNCTION ordering.set_total_fifo(p_loc uuid, p_item uuid, p_target numeric, p_note text DEFAULT 'stocktake'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ordering', 'public'
AS $function$
declare cur numeric; diff numeric; life int;
begin
  select coalesce(sum(qty),0) into cur from ordering.stock_batches
   where location_id = p_loc and catalog_item_id = p_item and qty > 0;
  diff := p_target - cur;

  if diff = 0 then
    return cur;
  elsif diff < 0 then
    -- 少了:FIFO 扣(consume_fifo 自带流水 + 同步)
    perform ordering.consume_fifo(p_loc, p_item, -diff, 'stocktake', null);
  else
    -- 多了:新建一批(到期按保质期算)
    select shelf_life_days into life from ordering.catalog_items where id = p_item;
    insert into ordering.stock_batches (location_id, catalog_item_id, qty, produced_on, expires_on, note)
    values (p_loc, p_item, diff, current_date,
            case when life is not null then current_date + life else null end, p_note);
    insert into ordering.stock_moves (catalog_item_id, delta, reason, note, created_by, location_id)
    values (p_item, diff, 'stocktake', p_note, auth.uid(), p_loc);
    perform ordering.sync_loc_qty(p_loc, p_item);
  end if;

  return p_target;
end $function$;

CREATE OR REPLACE FUNCTION ordering.stamp_bought()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.status = 'bought' and (old.status is distinct from 'bought') then
    new.bought_at := now();
  elsif new.status = 'pending' then
    new.bought_at := null;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION ordering.stamp_dispatch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.dispatch_status = 'dispatched' and (old.dispatch_status is distinct from 'dispatched') then
    new.dispatched_at := now();
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION ordering.stamp_item_completed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.status = 'done' and (old.status is distinct from 'done') then
    new.completed_at := now();
  elsif new.status = 'pending' then
    new.completed_at := null;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION ordering.sync_loc_qty(p_loc uuid, p_item uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ordering', 'public'
AS $function$
declare s numeric;
begin
  select coalesce(sum(qty),0) into s from ordering.stock_batches
   where location_id = p_loc and catalog_item_id = p_item and qty > 0;
  insert into ordering.location_stock (location_id, catalog_item_id, qty, updated_at)
  values (p_loc, p_item, s, now())
  on conflict (location_id, catalog_item_id) do update set qty = s, updated_at = now();
  return s;
end $function$;

CREATE OR REPLACE FUNCTION ordering.trace_batch(p_batch uuid)
 RETURNS TABLE(batch_id uuid, name_en text, name_hu text, produced_on date, expires_on date, qty numeric, location text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'ordering', 'public'
AS $function$
  select b.id, c.name_en, c.name_hu, b.produced_on, b.expires_on, b.qty, l.name_en
  from ordering.stock_batches b
  join ordering.catalog_items c on c.id = b.catalog_item_id
  join ordering.locations l on l.id = b.location_id
  where b.id = p_batch
$function$;

-- Triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ordering.catalog_items FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ordering.categories FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ordering.locations FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');
CREATE TRIGGER fill_snapshot BEFORE INSERT ON ordering.order_items FOR EACH ROW EXECUTE FUNCTION ordering.fill_order_item_snapshot();
CREATE TRIGGER stamp_completed BEFORE UPDATE ON ordering.order_items FOR EACH ROW EXECUTE FUNCTION ordering.stamp_item_completed();
CREATE TRIGGER stamp_dispatch BEFORE UPDATE ON ordering.order_items FOR EACH ROW EXECUTE FUNCTION ordering.stamp_dispatch();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ordering.order_templates FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ordering.orders FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');
CREATE TRIGGER stamp_bought BEFORE UPDATE ON ordering.procurement_tasks FOR EACH ROW EXECUTE FUNCTION ordering.stamp_bought();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ordering.profiles FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ordering.suppliers FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');

-- Row level security
ALTER TABLE "ordering"."app_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."catalog_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."item_prices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."location_favorites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."location_stock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."order_template_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."order_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."procurement_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."stock_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."stock_moves" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."stock_returns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ordering"."user_favorites" ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "as_read" ON "ordering"."app_settings" AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() IS NOT NULL));
CREATE POLICY "as_write" ON "ordering"."app_settings" AS PERMISSIVE FOR ALL TO public
  USING ((ordering.my_role() = 'admin'::ordering.user_role))
  WITH CHECK ((ordering.my_role() = 'admin'::ordering.user_role));
CREATE POLICY "audit_read_admin" ON "ordering"."audit_log" AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM ordering.profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = 'admin'::ordering.user_role)))));
CREATE POLICY "catalog_admin_write" ON "ordering"."catalog_items" AS PERMISSIVE FOR ALL TO public
  USING ((ordering.my_role() = 'admin'::ordering.user_role))
  WITH CHECK ((ordering.my_role() = 'admin'::ordering.user_role));
CREATE POLICY "catalog_read" ON "ordering"."catalog_items" AS PERMISSIVE FOR SELECT TO public
  USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "categories_admin_write" ON "ordering"."categories" AS PERMISSIVE FOR ALL TO public
  USING ((ordering.my_role() = 'admin'::ordering.user_role))
  WITH CHECK ((ordering.my_role() = 'admin'::ordering.user_role));
CREATE POLICY "categories_read" ON "ordering"."categories" AS PERMISSIVE FOR SELECT TO public
  USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "prices_admin_write" ON "ordering"."item_prices" AS PERMISSIVE FOR ALL TO public
  USING ((ordering.my_role() = 'admin'::ordering.user_role))
  WITH CHECK ((ordering.my_role() = 'admin'::ordering.user_role));
CREATE POLICY "prices_staff_read" ON "ordering"."item_prices" AS PERMISSIVE FOR SELECT TO public
  USING (ordering.is_staff());
CREATE POLICY "favorites_read" ON "ordering"."location_favorites" AS PERMISSIVE FOR SELECT TO public
  USING ((ordering.is_staff() OR (location_id = ordering.my_location())));
CREATE POLICY "favorites_write" ON "ordering"."location_favorites" AS PERMISSIVE FOR ALL TO public
  USING ((ordering.is_staff() OR (location_id = ordering.my_location())))
  WITH CHECK ((ordering.is_staff() OR (location_id = ordering.my_location())));
CREATE POLICY "ls_select" ON "ordering"."location_stock" AS PERMISSIVE FOR SELECT TO public
  USING (((ordering.my_role() = ANY (ARRAY['kitchen_manager'::ordering.user_role, 'admin'::ordering.user_role])) OR (location_id = ordering.my_location())));
CREATE POLICY "ls_write" ON "ordering"."location_stock" AS PERMISSIVE FOR ALL TO public
  USING (((ordering.my_role() = ANY (ARRAY['kitchen_manager'::ordering.user_role, 'admin'::ordering.user_role])) OR (location_id = ordering.my_location())))
  WITH CHECK (((ordering.my_role() = ANY (ARRAY['kitchen_manager'::ordering.user_role, 'admin'::ordering.user_role])) OR (location_id = ordering.my_location())));
CREATE POLICY "locations_admin_write" ON "ordering"."locations" AS PERMISSIVE FOR ALL TO public
  USING ((ordering.my_role() = 'admin'::ordering.user_role))
  WITH CHECK ((ordering.my_role() = 'admin'::ordering.user_role));
CREATE POLICY "locations_read" ON "ordering"."locations" AS PERMISSIVE FOR SELECT TO public
  USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "order_items_driver_read" ON "ordering"."order_items" AS PERMISSIVE FOR SELECT TO public
  USING ((ordering.my_role() = 'driver'::ordering.user_role));
CREATE POLICY "order_items_driver_update" ON "ordering"."order_items" AS PERMISSIVE FOR UPDATE TO public
  USING ((ordering.my_role() = 'driver'::ordering.user_role))
  WITH CHECK ((ordering.my_role() = 'driver'::ordering.user_role));
CREATE POLICY "order_items_orderer_write" ON "ordering"."order_items" AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM ordering.orders o
  WHERE ((o.id = order_items.order_id) AND (NOT ordering.is_staff()) AND (o.location_id = ordering.my_location()) AND (o.status = 'submitted'::ordering.order_status)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM ordering.orders o
  WHERE ((o.id = order_items.order_id) AND (o.location_id = ordering.my_location()) AND (o.status = 'submitted'::ordering.order_status)))));
CREATE POLICY "order_items_read" ON "ordering"."order_items" AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM ordering.orders o
  WHERE ((o.id = order_items.order_id) AND (ordering.is_staff() OR (o.location_id = ordering.my_location()))))));
CREATE POLICY "order_items_staff_write" ON "ordering"."order_items" AS PERMISSIVE FOR ALL TO public
  USING (ordering.is_staff())
  WITH CHECK (ordering.is_staff());
CREATE POLICY "order_items_store_mgr" ON "ordering"."order_items" AS PERMISSIVE FOR ALL TO public
  USING (((ordering.my_role() = 'store_manager'::ordering.user_role) AND (EXISTS ( SELECT 1
   FROM ordering.orders o
  WHERE ((o.id = order_items.order_id) AND (o.location_id = ordering.my_location()))))))
  WITH CHECK (((ordering.my_role() = 'store_manager'::ordering.user_role) AND (EXISTS ( SELECT 1
   FROM ordering.orders o
  WHERE ((o.id = order_items.order_id) AND (o.location_id = ordering.my_location()))))));
CREATE POLICY "template_items_rw" ON "ordering"."order_template_items" AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM ordering.order_templates t
  WHERE ((t.id = order_template_items.template_id) AND (ordering.is_staff() OR (t.location_id = ordering.my_location()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM ordering.order_templates t
  WHERE ((t.id = order_template_items.template_id) AND (ordering.is_staff() OR (t.location_id = ordering.my_location()))))));
CREATE POLICY "templates_rw" ON "ordering"."order_templates" AS PERMISSIVE FOR ALL TO public
  USING ((ordering.is_staff() OR (location_id = ordering.my_location())))
  WITH CHECK ((ordering.is_staff() OR (location_id = ordering.my_location())));
CREATE POLICY "orders_admin_delete" ON "ordering"."orders" AS PERMISSIVE FOR DELETE TO public
  USING ((ordering.my_role() = 'admin'::ordering.user_role));
CREATE POLICY "orders_driver_read" ON "ordering"."orders" AS PERMISSIVE FOR SELECT TO public
  USING ((ordering.my_role() = 'driver'::ordering.user_role));
CREATE POLICY "orders_orderer_insert" ON "ordering"."orders" AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((ordering.is_staff() OR ((location_id = ordering.my_location()) AND (created_by = auth.uid()))));
CREATE POLICY "orders_orderer_update" ON "ordering"."orders" AS PERMISSIVE FOR UPDATE TO public
  USING (((NOT ordering.is_staff()) AND (location_id = ordering.my_location()) AND (status = 'submitted'::ordering.order_status)))
  WITH CHECK (((location_id = ordering.my_location()) AND (status = ANY (ARRAY['submitted'::ordering.order_status, 'draft'::ordering.order_status]))));
CREATE POLICY "orders_read" ON "ordering"."orders" AS PERMISSIVE FOR SELECT TO public
  USING ((ordering.is_staff() OR (location_id = ordering.my_location())));
CREATE POLICY "orders_staff_update" ON "ordering"."orders" AS PERMISSIVE FOR UPDATE TO public
  USING (ordering.is_staff())
  WITH CHECK (ordering.is_staff());
CREATE POLICY "orders_store_mgr" ON "ordering"."orders" AS PERMISSIVE FOR ALL TO public
  USING (((ordering.my_role() = 'store_manager'::ordering.user_role) AND (location_id = ordering.my_location())))
  WITH CHECK (((ordering.my_role() = 'store_manager'::ordering.user_role) AND (location_id = ordering.my_location())));
CREATE POLICY "procurement_delete" ON "ordering"."procurement_tasks" AS PERMISSIVE FOR DELETE TO public
  USING (((ordering.my_role() = 'admin'::ordering.user_role) OR ((created_by = auth.uid()) AND (status = 'pending'::ordering.procurement_status))));
CREATE POLICY "procurement_insert" ON "ordering"."procurement_tasks" AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((ordering.my_role() = ANY (ARRAY['restaurant_orderer'::ordering.user_role, 'kitchen_manager'::ordering.user_role, 'admin'::ordering.user_role])) AND (created_by = auth.uid())));
CREATE POLICY "procurement_read" ON "ordering"."procurement_tasks" AS PERMISSIVE FOR SELECT TO public
  USING ((auth.role() = 'authenticated'::text));
CREATE POLICY "procurement_update" ON "ordering"."procurement_tasks" AS PERMISSIVE FOR UPDATE TO public
  USING ((ordering.my_role() = ANY (ARRAY['driver'::ordering.user_role, 'kitchen_manager'::ordering.user_role, 'admin'::ordering.user_role])))
  WITH CHECK ((ordering.my_role() = ANY (ARRAY['driver'::ordering.user_role, 'kitchen_manager'::ordering.user_role, 'admin'::ordering.user_role])));
CREATE POLICY "profiles_admin_write" ON "ordering"."profiles" AS PERMISSIVE FOR ALL TO public
  USING ((ordering.my_role() = 'admin'::ordering.user_role))
  WITH CHECK ((ordering.my_role() = 'admin'::ordering.user_role));
CREATE POLICY "profiles_self_read" ON "ordering"."profiles" AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = user_id) OR (ordering.my_role() = 'admin'::ordering.user_role)));
CREATE POLICY "sb_select" ON "ordering"."stock_batches" AS PERMISSIVE FOR SELECT TO public
  USING (((ordering.my_role() = ANY (ARRAY['kitchen_manager'::ordering.user_role, 'admin'::ordering.user_role])) OR (location_id = ordering.my_location())));
CREATE POLICY "sb_write" ON "ordering"."stock_batches" AS PERMISSIVE FOR ALL TO public
  USING (((ordering.my_role() = ANY (ARRAY['kitchen_manager'::ordering.user_role, 'admin'::ordering.user_role])) OR (location_id = ordering.my_location())))
  WITH CHECK (((ordering.my_role() = ANY (ARRAY['kitchen_manager'::ordering.user_role, 'admin'::ordering.user_role])) OR (location_id = ordering.my_location())));
CREATE POLICY "sm_insert" ON "ordering"."stock_moves" AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (ordering.is_staff());
CREATE POLICY "sm_read" ON "ordering"."stock_moves" AS PERMISSIVE FOR SELECT TO public
  USING (ordering.is_staff());
CREATE POLICY "sr_select" ON "ordering"."stock_returns" AS PERMISSIVE FOR SELECT TO public
  USING (((ordering.my_role() = ANY (ARRAY['kitchen_manager'::ordering.user_role, 'admin'::ordering.user_role])) OR (from_location = ordering.my_location()) OR (to_location = ordering.my_location())));
CREATE POLICY "sr_write" ON "ordering"."stock_returns" AS PERMISSIVE FOR ALL TO public
  USING (((ordering.my_role() = ANY (ARRAY['kitchen_manager'::ordering.user_role, 'admin'::ordering.user_role])) OR (from_location = ordering.my_location()) OR (to_location = ordering.my_location())))
  WITH CHECK (((ordering.my_role() = ANY (ARRAY['kitchen_manager'::ordering.user_role, 'admin'::ordering.user_role])) OR (from_location = ordering.my_location()) OR (to_location = ordering.my_location())));
CREATE POLICY "suppliers_admin_write" ON "ordering"."suppliers" AS PERMISSIVE FOR ALL TO public
  USING ((ordering.my_role() = 'admin'::ordering.user_role))
  WITH CHECK ((ordering.my_role() = 'admin'::ordering.user_role));
CREATE POLICY "suppliers_staff_read" ON "ordering"."suppliers" AS PERMISSIVE FOR SELECT TO public
  USING (ordering.is_staff());
CREATE POLICY "uf_delete" ON "ordering"."user_favorites" AS PERMISSIVE FOR DELETE TO public
  USING ((user_id = auth.uid()));
CREATE POLICY "uf_insert" ON "ordering"."user_favorites" AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "uf_select" ON "ordering"."user_favorites" AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = auth.uid()));

-- Grants
GRANT USAGE ON SCHEMA "ordering" TO anon, authenticated, service_role;

GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."app_settings" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."app_settings" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."audit_log" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."audit_log" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."catalog_items" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."catalog_items" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."categories" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."categories" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."item_prices" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."item_prices" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."location_favorites" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."location_favorites" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."location_stock" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."location_stock" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."locations" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."locations" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."order_items" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."order_items" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."order_template_items" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."order_template_items" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."order_templates" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."order_templates" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."orders" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."orders" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."procurement_tasks" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."procurement_tasks" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."profiles" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."profiles" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."stock_batches" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."stock_batches" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."stock_moves" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."stock_moves" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."stock_returns" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."stock_returns" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."suppliers" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."suppliers" TO service_role;
GRANT DELETE, INSERT, SELECT, UPDATE ON "ordering"."user_favorites" TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON "ordering"."user_favorites" TO service_role;

GRANT USAGE ON SEQUENCE "ordering"."audit_log_id_seq" TO postgres, service_role;

GRANT EXECUTE ON FUNCTION "ordering"."add_batch"(p_loc uuid, p_item uuid, p_qty numeric, p_produced date, p_expires date, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION "ordering"."add_loc_item"(p_loc uuid, p_item uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION "ordering"."adjust_loc_stock"(p_loc uuid, p_item uuid, p_delta numeric, p_reason text, p_note text, p_order_item uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION "ordering"."adjust_stock"(p_item uuid, p_delta numeric, p_reason text, p_note text, p_order_item uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION "ordering"."consume_fifo"(p_loc uuid, p_item uuid, p_qty numeric, p_reason text, p_order_item uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION "ordering"."log_audit"(p_action text, p_target text, p_detail jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION "ordering"."receive_return"(p_return uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION "ordering"."scrap_batch"(p_batch uuid, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION "ordering"."send_back"(p_from uuid, p_item uuid, p_qty numeric, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION "ordering"."set_loc_stock"(p_loc uuid, p_item uuid, p_value numeric, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION "ordering"."set_stock"(p_item uuid, p_value numeric, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION "ordering"."set_total_fifo"(p_loc uuid, p_item uuid, p_target numeric, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION "ordering"."sync_loc_qty"(p_loc uuid, p_item uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION "ordering"."trace_batch"(p_batch uuid) TO anon;
GRANT EXECUTE ON FUNCTION "ordering"."trace_batch"(p_batch uuid) TO authenticated;
