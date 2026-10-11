-- ============================================================
-- Let store managers manage the catalog (add/edit items & categories)
-- so stores can add products that aren't in the order list yet.
-- Supplier prices stay admin-only.
-- Run once in the Supabase SQL editor.
-- ============================================================

drop policy if exists catalog_admin_write on ordering.catalog_items;
create policy catalog_admin_write on ordering.catalog_items
  as permissive for all to public
  using (ordering.my_role() in ('admin','store_manager'))
  with check (ordering.my_role() in ('admin','store_manager'));

drop policy if exists categories_admin_write on ordering.categories;
create policy categories_admin_write on ordering.categories
  as permissive for all to public
  using (ordering.my_role() in ('admin','store_manager'))
  with check (ordering.my_role() in ('admin','store_manager'));
