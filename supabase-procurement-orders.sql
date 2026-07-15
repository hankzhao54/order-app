-- ============================================================
-- Procurement orders: stores send a dedicated "buy" order
-- straight to the driver's procurement list (kitchen skipped).
-- Run this once in the Supabase SQL editor.
-- ============================================================

-- 1) New order type
alter type ordering.order_type add value if not exists 'procurement';

-- 2) Store managers could not add procurement tasks before — now every
--    ordering role can (they create tasks when submitting a procurement order).
drop policy if exists procurement_insert on ordering.procurement_tasks;
create policy procurement_insert on ordering.procurement_tasks
  as permissive for insert to public
  with check (
    ordering.my_role() in ('restaurant_orderer','store_manager','kitchen_manager','admin')
    and created_by = auth.uid()
  );

-- 3) The driver auto-completes a procurement order once everything is bought,
--    which needs UPDATE on orders (driver previously had read-only).
drop policy if exists orders_driver_update on ordering.orders;
create policy orders_driver_update on ordering.orders
  as permissive for update to public
  using (ordering.my_role() = 'driver')
  with check (ordering.my_role() = 'driver');
