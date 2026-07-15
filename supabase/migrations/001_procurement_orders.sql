-- ============================================================
-- 001 — Procurement orders (enum + RLS)
-- Same content as the root-level supabase-procurement-orders.sql.
-- If you already ran that file, running this again is safe (idempotent).
-- ============================================================

alter type ordering.order_type add value if not exists 'procurement';

drop policy if exists procurement_insert on ordering.procurement_tasks;
create policy procurement_insert on ordering.procurement_tasks
  as permissive for insert to public
  with check (
    ordering.my_role() in ('restaurant_orderer','store_manager','kitchen_manager','admin')
    and created_by = auth.uid()
  );

drop policy if exists orders_driver_update on ordering.orders;
create policy orders_driver_update on ordering.orders
  as permissive for update to public
  using (ordering.my_role() = 'driver')
  with check (ordering.my_role() = 'driver');
