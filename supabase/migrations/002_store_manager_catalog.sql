-- ============================================================
-- 002 — Store managers can manage catalog items & categories
-- Same content as the root-level supabase-store-manager-catalog.sql.
-- Safe to re-run.
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
