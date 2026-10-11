-- ============================================================
-- Integration tests for migration 009 (recipes merged into ordering).
-- Run after 008 + 009. Everything is rolled back at the end.
-- RLS is exercised by switching to the `authenticated` role.
-- ============================================================
begin;

do $body$
declare
  u_admin uuid := gen_random_uuid();
  u_chef  uuid := gen_random_uuid();
  u_chef2 uuid := gen_random_uuid();
  u_staff uuid := gen_random_uuid();
  v jsonb; v_id text; v_ver bigint; n int; s text;
begin
  insert into auth.users (id, email) values
    (u_admin, 'm-admin@x'), (u_chef, 'm-chef@x'), (u_chef2, 'm-chef2@x'), (u_staff, 'm-staff@x');
  insert into ordering.profiles (user_id, role, full_name) values
    (u_admin, 'kitchen_manager', 'Boss'), (u_chef, 'chef', 'Chef A'),
    (u_chef2, 'chef', 'Chef B'), (u_staff, 'kitchen_staff', 'Staff');

  -- ---------- R1: staff cannot write, chef can ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff, 'role', 'authenticated')::text, true);
  begin
    perform ordering.save_recipe('{"en_name":"Nope"}'::jsonb);
    raise exception 'R1 FAIL: staff saved a recipe';
  exception when others then
    if sqlerrm like 'R1 FAIL%' then raise; end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_chef, 'role', 'authenticated')::text, true);
  v := ordering.save_recipe(jsonb_build_object(
         'hu_name', 'Teszt leves', 'en_name', '', 'category', 2, 'serves', 10,
         'allergens', jsonb_build_array('celery', 'gluten'),
         'ingredients', jsonb_build_array(jsonb_build_object('id','i1','name','víz','enName','water','qty','5 l')),
         'steps', jsonb_build_array(jsonb_build_object('id','s1','desc','Főzd','enDesc','Boil'))));
  v_id := v->>'id';
  if not (v->>'created')::boolean then raise exception 'R1 FAIL: not created'; end if;
  if (select en_name from ordering.recipes where id = v_id) <> 'Teszt leves' then raise exception 'R1 FAIL: name fallback'; end if;
  if (select author_id from ordering.recipes where id = v_id) <> u_chef then raise exception 'R1 FAIL: author'; end if;
  if (select allergens from ordering.recipes where id = v_id) <> array['celery','gluten'] then raise exception 'R1 FAIL: allergens'; end if;
  raise notice 'R1 PASS: role checks + create';

  -- ---------- R2: edit snapshots the previous version, keeps the author ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_chef2, 'role', 'authenticated')::text, true);
  perform ordering.save_recipe(jsonb_build_object('id', v_id, 'hu_name', 'Teszt leves 2', 'en_name', 'Test soup', 'category', 2,
     'ingredients', '[]'::jsonb, 'steps', '[]'::jsonb));
  select count(*) into n from ordering.recipe_versions where recipe_id = v_id;
  if n <> 1 then raise exception 'R2 FAIL: % versions', n; end if;
  if (select snapshot->>'hu_name' from ordering.recipe_versions where recipe_id = v_id) <> 'Teszt leves' then raise exception 'R2 FAIL: snapshot'; end if;
  if (select edited_by_name from ordering.recipe_versions where recipe_id = v_id) <> 'Chef B' then raise exception 'R2 FAIL: editor'; end if;
  if (select author_id from ordering.recipes where id = v_id) <> u_chef then raise exception 'R2 FAIL: author overwritten'; end if;
  if not exists (select 1 from ordering.audit_log where action = 'recipe.edit' and detail->>'recipe_id' = v_id) then raise exception 'R2 FAIL: audit'; end if;
  raise notice 'R2 PASS: versions + audit';

  -- ---------- R3: restore ----------
  select id into v_ver from ordering.recipe_versions where recipe_id = v_id;
  perform ordering.restore_recipe_version(v_ver);
  if (select hu_name from ordering.recipes where id = v_id) <> 'Teszt leves' then raise exception 'R3 FAIL: not restored'; end if;
  if jsonb_array_length((select ingredients from ordering.recipes where id = v_id)) <> 1 then raise exception 'R3 FAIL: ingredients'; end if;
  if (select count(*) from ordering.recipe_versions where recipe_id = v_id) <> 2 then raise exception 'R3 FAIL: restore did not snapshot'; end if;
  raise notice 'R3 PASS: restore';

  -- ---------- R4: delete only by author or manager ----------
  begin
    perform ordering.delete_recipe(v_id);   -- chef B is not the author
    raise exception 'R4 FAIL: non-author deleted';
  exception when others then
    if sqlerrm like 'R4 FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  perform ordering.delete_recipe(v_id);
  if exists (select 1 from ordering.recipes where id = v_id) then raise exception 'R4 FAIL: still there'; end if;
  if not exists (select 1 from ordering.recipe_versions where recipe_id = v_id and snapshot->>'deleted' = 'true') then raise exception 'R4 FAIL: no tombstone'; end if;
  raise notice 'R4 PASS: delete rules';

  -- ---------- R5: the OLD app still works through the public views (RLS on) ----------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_chef, 'role', 'authenticated')::text, true);
  insert into public.recipes (id, hu_name, en_name, category, ingredients, steps, author_id, author_name)
  values ('u-legacy-1', 'Régi', 'Old', 0, '[]', '[]', u_chef, 'Chef A')
  on conflict (id) do update set hu_name = excluded.hu_name;
  insert into public.recipes (id, hu_name, en_name, category, ingredients, steps)
  values ('u-legacy-1', 'Régi 2', 'Old', 0, '[]', '[]')
  on conflict (id) do update set hu_name = excluded.hu_name;
  select hu_name into s from ordering.recipes where id = 'u-legacy-1';
  if s <> 'Régi 2' then raise exception 'R5 FAIL: upsert through view: %', s; end if;
  insert into public.recipe_versions (recipe_id, snapshot, edited_by_name) values ('u-legacy-1', '{}'::jsonb, 'Chef A');
  select count(*) into n from public.categories;
  if n < 1 then raise exception 'R5 FAIL: categories view empty'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_staff, 'role', 'authenticated')::text, true);
  begin
    insert into public.recipes (id, hu_name, en_name) values ('u-legacy-2', 'x', 'x');
    raise exception 'R5 FAIL: staff wrote through the view';
  exception when others then
    if sqlerrm like 'R5 FAIL%' then raise; end if;
  end;
  select count(*) into n from public.recipes;   -- staff can still read
  if n < 1 then raise exception 'R5 FAIL: staff cannot read'; end if;
  reset role;
  raise notice 'R5 PASS: legacy views honour the unified roles';

  -- ---------- R6: legacy users + audit entries are mirrored ----------
  if to_regclass('public.profiles') is not null then
    insert into auth.users (id, email) values ('99999999-9999-9999-9999-999999999999', 'late@x');
    insert into public.profiles (id, username, display_name, role) values ('99999999-9999-9999-9999-999999999999', 'late', 'Late Chef', 'chef');
    if (select role::text from ordering.profiles where user_id = '99999999-9999-9999-9999-999999999999') <> 'chef' then
      raise exception 'R6 FAIL: profile not mirrored';
    end if;
    insert into public.audit_log (user_id, user_name, action, recipe_id, recipe_name) values ('99999999-9999-9999-9999-999999999999', 'Late Chef', 'create', 'u-legacy-1', 'Old');
    if not exists (select 1 from ordering.audit_log where action = 'recipe.create' and detail->>'source' = 'recipes-app' and detail->>'recipe_id' = 'u-legacy-1') then
      raise exception 'R6 FAIL: audit not mirrored';
    end if;
  end if;
  raise notice 'R6 PASS: legacy profiles + audit mirrored';

  -- ---------- R7: favourites are private ----------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_chef, 'role', 'authenticated')::text, true);
  insert into ordering.recipe_favorites (user_id, recipe_id) values (u_chef, 'u-legacy-1');
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff, 'role', 'authenticated')::text, true);
  select count(*) into n from ordering.recipe_favorites;
  if n <> 0 then raise exception 'R7 FAIL: saw someone else''s favourites'; end if;
  begin
    insert into ordering.recipe_favorites (user_id, recipe_id) values (u_chef, 'u-legacy-1');
    raise exception 'R7 FAIL: wrote someone else''s favourite';
  exception when others then
    if sqlerrm like 'R7 FAIL%' then raise; end if;
  end;
  reset role;
  raise notice 'R7 PASS: favourites are per user';

  -- ---------- R8: catalog link ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_chef, 'role', 'authenticated')::text, true);
  begin
    perform ordering.link_recipe((select id from ordering.catalog_items limit 1), 'u-legacy-1');
    raise exception 'R8 FAIL: chef changed catalog link';
  exception when others then
    if sqlerrm like 'R8 FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_admin, 'role', 'authenticated')::text, true);
  perform ordering.link_recipe((select id from ordering.catalog_items order by name_en limit 1), 'u-legacy-1');
  if (select recipe_ref from ordering.catalog_items order by name_en limit 1) <> 'u-legacy-1' then raise exception 'R8 FAIL: link'; end if;
  raise notice 'R8 PASS: catalog link';

  raise notice 'ALL RECIPE MERGE TESTS PASSED (rolled back)';
end $body$;

rollback;
