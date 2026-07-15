-- ============================================================
-- 003 — created_by from auth.uid() + quantity constraints  (P0-1, P1-8)
-- Safe to re-run.
--
-- Fixes:
--  * orders_orderer_insert RLS requires created_by = auth.uid(), but the
--    frontend never set it → restaurant_orderer inserts failed. The DB now
--    stamps created_by itself and never trusts a client-supplied user id.
--  * quantity / fulfilled_qty had no DB-level bounds.
-- ============================================================

-- ---- created_by is always set by the database ----
create or replace function ordering.force_created_by()
returns trigger
language plpgsql security definer set search_path to 'ordering','public'
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();          -- never trust a client-supplied id
  end if;
  return new;
end $$;

drop trigger if exists force_created_by on ordering.orders;
create trigger force_created_by before insert on ordering.orders
  for each row execute function ordering.force_created_by();

drop trigger if exists force_created_by on ordering.procurement_tasks;
create trigger force_created_by before insert on ordering.procurement_tasks
  for each row execute function ordering.force_created_by();

-- ---- quantity bounds (added NOT VALID so old rows don't block the deploy) ----
do $$ begin
  alter table ordering.order_items
    add constraint oi_quantity_positive check (quantity > 0) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table ordering.order_items
    add constraint oi_fulfilled_range
    check (fulfilled_qty is null or (fulfilled_qty >= 0 and fulfilled_qty <= quantity)) not valid;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table ordering.procurement_tasks
    add constraint pt_quantity_positive check (quantity > 0) not valid;
exception when duplicate_object then null; end $$;

-- Try to validate against existing data; if old rows violate, keep the
-- constraint NOT VALID (new writes are still checked) and tell the operator.
do $$ begin
  alter table ordering.order_items validate constraint oi_quantity_positive;
exception when others then
  raise notice 'order_items has legacy rows with quantity <= 0. Clean them up, then run: alter table ordering.order_items validate constraint oi_quantity_positive;';
end $$;

do $$ begin
  alter table ordering.order_items validate constraint oi_fulfilled_range;
exception when others then
  raise notice 'order_items has legacy rows with fulfilled_qty out of range. Clean them up, then run: alter table ordering.order_items validate constraint oi_fulfilled_range;';
end $$;

do $$ begin
  alter table ordering.procurement_tasks validate constraint pt_quantity_positive;
exception when others then
  raise notice 'procurement_tasks has legacy rows with quantity <= 0. Clean them up, then run: alter table ordering.procurement_tasks validate constraint pt_quantity_positive;';
end $$;
