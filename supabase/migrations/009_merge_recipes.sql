-- ============================================================
-- 009 — Merge the recipes app into the ordering system
-- Run AFTER 008. Safe to re-run.
--
-- Before: the recipes app kept its tables in `public` (recipes,
-- recipe_versions, categories, profiles, audit_log) with its own roles
-- (admin / chef / staff); the order app kept everything in `ordering`.
-- Same Supabase project, two systems.
--
-- After:
--   * recipes, recipe_versions and recipe_categories live in `ordering`
--   * one set of users and roles: ordering.profiles (recipes-app users are
--     carried over: admin→admin, chef→chef, staff→kitchen_staff)
--   * one audit log: ordering.audit_log (old entries copied over)
--   * catalog items can point at the recipe that makes them
--   * every recipe write goes through a transactional RPC that also keeps
--     the version history and the audit log
--
-- The OLD recipes app keeps working during the switch-over: `public.recipes`,
-- `public.recipe_versions` and `public.categories` become views onto the
-- moved tables, and its users / audit entries are mirrored automatically.
-- ============================================================

-- ---------------------------------------------------------------
-- 1. Move the tables
-- ---------------------------------------------------------------
do $$
begin
  if to_regclass('ordering.recipes') is null then
    if to_regclass('public.recipes') is null then
      raise exception 'public.recipes not found — is this the right database?';
    end if;
    alter table public.recipes set schema ordering;
  end if;

  if to_regclass('ordering.recipe_versions') is null and to_regclass('public.recipe_versions') is not null then
    alter table public.recipe_versions set schema ordering;
  end if;

  if to_regclass('ordering.recipe_categories') is null and to_regclass('public.categories') is not null
     and (select relkind from pg_class where oid = 'public.categories'::regclass) = 'r' then
    alter table public.categories rename to recipe_categories;
    -- ordering.categories (catalog categories) already owns the name categories_pkey
    if exists (select 1 from pg_constraint where conname = 'categories_pkey' and conrelid = 'public.recipe_categories'::regclass) then
      alter table public.recipe_categories rename constraint categories_pkey to recipe_categories_pkey;
    end if;
    alter table public.recipe_categories set schema ordering;
  end if;
end $$;

-- tables that may be missing on a database that never ran the recipe batches
create table if not exists ordering.recipe_versions (
  id             bigserial primary key,
  recipe_id      text not null,
  snapshot       jsonb not null,
  edited_by      uuid,
  edited_by_name text,
  created_at     timestamptz default now()
);
create index if not exists idx_versions_recipe on ordering.recipe_versions(recipe_id, created_at desc);

create table if not exists ordering.recipe_categories (
  id         int primary key,
  name_en    text not null,
  name_hu    text not null,
  color      text not null default '#a8833f',
  sort_order int not null default 0,
  created_at timestamptz default now()
);

alter table ordering.recipes add column if not exists pack_spec    text default '';
alter table ordering.recipes add column if not exists shelf_life   text default '';
alter table ordering.recipes add column if not exists vacuum_level text default '';
alter table ordering.recipes add column if not exists status       text not null default 'published';
alter table ordering.recipes add column if not exists allergens    text[] default '{}';

-- authors / editors now come from auth.users, not the old public.profiles
alter table ordering.recipes drop constraint if exists recipes_author_id_fkey;
alter table ordering.recipe_versions drop constraint if exists recipe_versions_edited_by_fkey;
do $$ begin
  alter table ordering.recipes add constraint recipes_author_id_fkey
    foreign key (author_id) references auth.users(id) on delete set null not valid;
exception when duplicate_object then null; end $$;

-- version trimming, schema-qualified (the old function resolved names via search_path)
create or replace function ordering.trim_recipe_versions()
returns trigger language plpgsql
as $$
begin
  delete from ordering.recipe_versions
   where recipe_id = new.recipe_id
     and id not in (select id from ordering.recipe_versions
                     where recipe_id = new.recipe_id
                     order by created_at desc, id desc limit 30);
  return new;
end $$;
drop trigger if exists trg_trim_versions on ordering.recipe_versions;
create trigger trg_trim_versions after insert on ordering.recipe_versions
  for each row execute function ordering.trim_recipe_versions();

create or replace function ordering.touch_recipe()
returns trigger language plpgsql
as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_recipes_updated_at on ordering.recipes;
create trigger trg_recipes_updated_at before update on ordering.recipes
  for each row execute function ordering.touch_recipe();

-- ---------------------------------------------------------------
-- 2. One permission model
-- ---------------------------------------------------------------
create or replace function ordering.can_edit_recipes()
returns boolean
language sql stable security definer set search_path to 'ordering','public'
as $$ select coalesce(ordering.my_role()::text in ('admin','kitchen_manager','chef'), false) $$;

create or replace function ordering.can_manage_recipes()
returns boolean
language sql stable security definer set search_path to 'ordering','public'
as $$ select coalesce(ordering.my_role()::text in ('admin','kitchen_manager'), false) $$;

alter table ordering.recipes enable row level security;
alter table ordering.recipe_versions enable row level security;
alter table ordering.recipe_categories enable row level security;

do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
            where schemaname = 'ordering' and tablename in ('recipes','recipe_versions','recipe_categories')
  loop
    execute format('drop policy %I on ordering.%I', p.policyname, p.tablename);
  end loop;
end $$;

create policy recipes_read on ordering.recipes for select to authenticated using (true);
create policy recipes_write on ordering.recipes for all to authenticated
  using (ordering.can_edit_recipes()) with check (ordering.can_edit_recipes());

create policy versions_read on ordering.recipe_versions for select to authenticated using (true);
create policy versions_insert on ordering.recipe_versions for insert to authenticated
  with check (ordering.can_edit_recipes());

create policy rcat_read on ordering.recipe_categories for select to authenticated using (true);
create policy rcat_write on ordering.recipe_categories for all to authenticated
  using (ordering.can_manage_recipes()) with check (ordering.can_manage_recipes());

grant select, insert, update, delete on ordering.recipes, ordering.recipe_versions, ordering.recipe_categories to authenticated;
grant all on ordering.recipes, ordering.recipe_versions, ordering.recipe_categories to service_role;
grant usage, select on sequence ordering.recipe_versions_id_seq to authenticated;

-- ---------------------------------------------------------------
-- 3. One set of users: carry recipes-app users into ordering.profiles
-- ---------------------------------------------------------------
create or replace function ordering.map_recipe_role(p text)
returns ordering.user_role
language sql immutable
as $$ select case p when 'admin' then 'admin' when 'chef' then 'chef' else 'kitchen_staff' end::ordering.user_role $$;

do $$
begin
  if to_regclass('public.profiles') is not null then
    insert into ordering.profiles (user_id, role, full_name)
    select p.id, ordering.map_recipe_role(p.role), coalesce(nullif(p.display_name, ''), p.username)
      from public.profiles p
      join auth.users u on u.id = p.id
     where not exists (select 1 from ordering.profiles o where o.user_id = p.id);
  end if;
end $$;

-- users created later by the OLD recipes app get an ordering profile too
create or replace function ordering.mirror_recipe_profile()
returns trigger
language plpgsql security definer set search_path to 'ordering','public'
as $$
begin
  insert into ordering.profiles (user_id, role, full_name)
  values (new.id, ordering.map_recipe_role(new.role), coalesce(nullif(new.display_name, ''), new.username))
  on conflict (user_id) do nothing;
  return new;
end $$;

do $$
begin
  if to_regclass('public.profiles') is not null then
    drop trigger if exists mirror_to_ordering on public.profiles;
    create trigger mirror_to_ordering after insert on public.profiles
      for each row execute function ordering.mirror_recipe_profile();
  end if;
end $$;

-- ---------------------------------------------------------------
-- 4. One audit log
-- ---------------------------------------------------------------
create or replace function ordering.map_recipe_action(p text)
returns text language sql immutable
as $$
  select case p
    when 'user-add' then 'user.create' when 'user-del' then 'user.delete' when 'pwd-change' then 'user.password'
    when 'bulk-edit' then 'recipe.bulk_edit'
    else 'recipe.' || p end
$$;

do $$
begin
  if to_regclass('public.audit_log') is not null then
    insert into ordering.audit_log (created_at, actor_id, actor_name, action, target, detail)
    select a.created_at, a.user_id, a.user_name, ordering.map_recipe_action(a.action),
           coalesce(a.recipe_name, a.recipe_id),
           coalesce(a.diff, '{}'::jsonb) || jsonb_build_object('recipe_id', a.recipe_id, 'legacy_id', a.id, 'source', 'recipes-app')
      from public.audit_log a
     where not exists (select 1 from ordering.audit_log o
                        where o.detail->>'source' = 'recipes-app' and (o.detail->>'legacy_id')::bigint = a.id);
  end if;
end $$;

create or replace function ordering.mirror_recipe_audit()
returns trigger
language plpgsql security definer set search_path to 'ordering','public'
as $$
begin
  insert into ordering.audit_log (created_at, actor_id, actor_name, action, target, detail)
  values (coalesce(new.created_at, now()), new.user_id, new.user_name, ordering.map_recipe_action(new.action),
          coalesce(new.recipe_name, new.recipe_id),
          coalesce(new.diff, '{}'::jsonb) || jsonb_build_object('recipe_id', new.recipe_id, 'legacy_id', new.id, 'source', 'recipes-app'));
  return new;
end $$;

do $$
begin
  if to_regclass('public.audit_log') is not null then
    drop trigger if exists mirror_to_ordering on public.audit_log;
    create trigger mirror_to_ordering after insert on public.audit_log
      for each row execute function ordering.mirror_recipe_audit();
  end if;
end $$;

-- ---------------------------------------------------------------
-- 5. Catalog items ↔ recipes
-- ---------------------------------------------------------------
alter table ordering.catalog_items add column if not exists recipe_ref text;
do $$ begin
  alter table ordering.catalog_items add constraint catalog_items_recipe_ref_fkey
    foreign key (recipe_ref) references ordering.recipes(id) on delete set null;
exception when duplicate_object then null; end $$;
create index if not exists catalog_items_recipe_ref_idx on ordering.catalog_items(recipe_ref) where recipe_ref is not null;

-- best-effort auto-link: same name (EN or HU), only where the match is unambiguous
with m as (
  select c.id as item_id, min(r.id) as recipe_id, count(*) as n
    from ordering.catalog_items c
    join ordering.recipes r
      on lower(trim(r.en_name)) = lower(trim(c.name_en))
      or (c.name_hu is not null and lower(trim(r.hu_name)) = lower(trim(c.name_hu)))
   where c.recipe_ref is null
   group by c.id
)
update ordering.catalog_items c set recipe_ref = m.recipe_id
  from m where m.item_id = c.id and m.n = 1;

-- ---------------------------------------------------------------
-- 6. Personal favourites (were browser-only before)
-- ---------------------------------------------------------------
create table if not exists ordering.recipe_favorites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  recipe_id  text not null references ordering.recipes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);
alter table ordering.recipe_favorites enable row level security;
drop policy if exists rfav_own on ordering.recipe_favorites;
create policy rfav_own on ordering.recipe_favorites for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, delete on ordering.recipe_favorites to authenticated;

-- ---------------------------------------------------------------
-- 7. Transactional recipe RPCs (snapshot + write + audit in one go)
-- ---------------------------------------------------------------
create or replace function ordering.my_display_name()
returns text language sql stable security definer set search_path to 'ordering','public'
as $$ select coalesce((select full_name from ordering.profiles where user_id = auth.uid()), 'unknown') $$;

-- p: { id?, hu_name, en_name, category, section, serves, prep_time, cook_time, pack_spec,
--      shelf_life, vacuum_level, status, allergens[], cover_image, ingredients[], steps[] }
create or replace function ordering.save_recipe(p jsonb, p_action text default null)
returns jsonb
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare
  v_id text := nullif(trim(p->>'id'), '');
  v_old ordering.recipes;
  v_hu text := trim(coalesce(p->>'hu_name', ''));
  v_en text := trim(coalesce(p->>'en_name', ''));
  v_status text := coalesce(nullif(p->>'status', ''), 'published');
  v_is_new boolean;
begin
  if not ordering.can_edit_recipes() then
    raise exception 'Your account cannot edit recipes';
  end if;
  if v_hu = '' and v_en = '' then raise exception 'Recipe name is required'; end if;
  if v_status not in ('published','draft') then raise exception 'Bad status %', v_status; end if;
  if v_hu = '' then v_hu := v_en; end if;
  if v_en = '' then v_en := v_hu; end if;

  if v_id is not null then
    select * into v_old from ordering.recipes where id = v_id for update;
  end if;
  v_is_new := v_old.id is null;
  if v_id is null then
    v_id := 'r-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' || substr(md5(random()::text), 1, 4);
  end if;

  if not v_is_new then
    insert into ordering.recipe_versions (recipe_id, snapshot, edited_by, edited_by_name)
    values (v_id, to_jsonb(v_old), auth.uid(), ordering.my_display_name());

    update ordering.recipes set
      hu_name = v_hu, en_name = v_en,
      category = coalesce((p->>'category')::int, category),
      section = coalesce((p->>'section')::int, section),
      serves = case when p ? 'serves' then (p->>'serves')::int else serves end,
      prep_time = case when p ? 'prep_time' then (p->>'prep_time')::int else prep_time end,
      cook_time = case when p ? 'cook_time' then (p->>'cook_time')::int else cook_time end,
      pack_spec = coalesce(p->>'pack_spec', ''), shelf_life = coalesce(p->>'shelf_life', ''),
      vacuum_level = coalesce(p->>'vacuum_level', ''), status = v_status,
      allergens = coalesce((select array_agg(x) from jsonb_array_elements_text(p->'allergens') x), '{}'),
      cover_image = nullif(p->>'cover_image', ''),
      ingredients = coalesce(p->'ingredients', '[]'::jsonb),
      steps = coalesce(p->'steps', '[]'::jsonb)
    where id = v_id;
  else
    insert into ordering.recipes (id, hu_name, en_name, category, section, serves, prep_time, cook_time,
      pack_spec, shelf_life, vacuum_level, status, allergens, cover_image, ingredients, steps,
      author_id, author_name)
    values (v_id, v_hu, v_en, coalesce((p->>'category')::int, 0), coalesce((p->>'section')::int, 0),
      (p->>'serves')::int, (p->>'prep_time')::int, (p->>'cook_time')::int,
      coalesce(p->>'pack_spec', ''), coalesce(p->>'shelf_life', ''), coalesce(p->>'vacuum_level', ''), v_status,
      coalesce((select array_agg(x) from jsonb_array_elements_text(p->'allergens') x), '{}'),
      nullif(p->>'cover_image', ''), coalesce(p->'ingredients', '[]'::jsonb), coalesce(p->'steps', '[]'::jsonb),
      auth.uid(), ordering.my_display_name());
  end if;

  perform ordering.log_audit(
    coalesce(p_action, case when v_is_new then 'recipe.create' else 'recipe.edit' end),
    v_en,
    jsonb_build_object('recipe_id', v_id,
                       'ings', jsonb_array_length(coalesce(p->'ingredients', '[]'::jsonb)),
                       'steps', jsonb_array_length(coalesce(p->'steps', '[]'::jsonb))));
  return jsonb_build_object('id', v_id, 'created', v_is_new);
end $$;

create or replace function ordering.delete_recipe(p_id text)
returns jsonb
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare r ordering.recipes;
begin
  select * into r from ordering.recipes where id = p_id for update;
  if not found then return jsonb_build_object('deleted', false); end if;
  if not (ordering.can_manage_recipes() or (ordering.can_edit_recipes() and r.author_id = auth.uid())) then
    raise exception 'Only the author or a kitchen manager can delete this recipe';
  end if;
  -- keep a last snapshot so a deleted recipe can still be found in the history table
  insert into ordering.recipe_versions (recipe_id, snapshot, edited_by, edited_by_name)
  values (r.id, to_jsonb(r) || '{"deleted": true}'::jsonb, auth.uid(), ordering.my_display_name());
  delete from ordering.recipes where id = p_id;
  perform ordering.log_audit('recipe.delete', r.en_name, jsonb_build_object('recipe_id', r.id));
  return jsonb_build_object('deleted', true);
end $$;

create or replace function ordering.restore_recipe_version(p_version bigint)
returns jsonb
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare v ordering.recipe_versions; s jsonb;
begin
  select * into v from ordering.recipe_versions where id = p_version;
  if not found then raise exception 'Version not found'; end if;
  s := v.snapshot;
  return ordering.save_recipe(jsonb_build_object(
    'id', v.recipe_id, 'hu_name', s->>'hu_name', 'en_name', s->>'en_name', 'category', s->'category',
    'section', s->'section', 'serves', s->'serves', 'prep_time', s->'prep_time', 'cook_time', s->'cook_time',
    'pack_spec', s->>'pack_spec', 'shelf_life', s->>'shelf_life', 'vacuum_level', s->>'vacuum_level',
    'status', coalesce(s->>'status', 'published'), 'allergens', coalesce(s->'allergens', '[]'::jsonb),
    'cover_image', s->>'cover_image', 'ingredients', s->'ingredients', 'steps', s->'steps'),
    'recipe.restore');
end $$;

-- link / unlink a catalog item and a recipe (kitchen managers and the catalog admins)
create or replace function ordering.link_recipe(p_item uuid, p_recipe text)
returns void
language plpgsql security definer set search_path to 'ordering','public'
as $$
begin
  if not (ordering.can_manage_recipes() or ordering.my_role() = 'store_manager') then
    raise exception 'Your account cannot change catalog links';
  end if;
  update ordering.catalog_items set recipe_ref = nullif(p_recipe, '') where id = p_item;
end $$;

grant execute on function
  ordering.can_edit_recipes(), ordering.can_manage_recipes(), ordering.my_display_name(),
  ordering.save_recipe(jsonb, text), ordering.delete_recipe(text), ordering.restore_recipe_version(bigint),
  ordering.link_recipe(uuid, text)
to authenticated;

-- ---------------------------------------------------------------
-- 8. Compatibility for the OLD recipes app during switch-over
--    (drop these three views once nobody uses the old app any more)
-- ---------------------------------------------------------------
create or replace view public.recipes with (security_invoker = true) as select * from ordering.recipes;
create or replace view public.recipe_versions with (security_invoker = true) as select * from ordering.recipe_versions;
create or replace view public.categories with (security_invoker = true) as select * from ordering.recipe_categories;
grant select, insert, update, delete on public.recipes, public.recipe_versions, public.categories to authenticated;

-- the old app's own helpers now read the unified roles
create or replace function public.current_user_role() returns text
language sql stable security definer set search_path to 'ordering','public'
as $$
  select case ordering.my_role()::text
           when 'admin' then 'admin'
           when 'kitchen_manager' then 'chef'
           when 'chef' then 'chef'
           else 'staff' end
$$;

-- ---------------------------------------------------------------
-- 9. Report users whose roles differ between the two old systems
-- ---------------------------------------------------------------
do $$
declare r record; n int := 0;
begin
  if to_regclass('public.profiles') is null then return; end if;
  for r in
    select p.username, p.role as recipe_role, o.role::text as order_role
      from public.profiles p join ordering.profiles o on o.user_id = p.id
     where p.role in ('admin','chef') and o.role::text not in ('admin','kitchen_manager','chef')
  loop
    n := n + 1;
    raise notice 'CHECK ROLE: % was "%" in the recipes app but is "%" in the order app — they can no longer edit recipes. Change it under Users if needed.',
      r.username, r.recipe_role, r.order_role;
  end loop;
  raise notice '009 done. % user(s) need a role check.', n;
end $$;

notify pgrst, 'reload schema';
