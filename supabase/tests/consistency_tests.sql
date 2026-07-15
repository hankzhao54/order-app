-- ============================================================
-- Integration tests for the consistency migrations (001–006).
--
-- HOW TO RUN: paste the whole file into the Supabase SQL editor and run it
-- AFTER applying supabase/migrations/001..006. Everything happens inside a
-- transaction that ends with ROLLBACK — no data is left behind.
-- Every check RAISES EXCEPTION on failure; success prints NOTICEs.
--
-- Runs as postgres (RLS-bypassing) for RPC logic; signed-in users are
-- simulated via request.jwt.claims wherever auth.uid() matters. Expected
-- failures are wrapped in sub-blocks so only the failing statement rolls
-- back, never the fixtures.
-- ============================================================

begin;

do $body$
declare
  u_orderer uuid := gen_random_uuid();
  u_driver  uuid := gen_random_uuid();
  u_staff   uuid := gen_random_uuid();
  loc_store uuid; loc_central uuid; cat_make uuid; cat_buy uuid;
  v_order uuid; v_item uuid; v_task uuid;
  v jsonb; v_qty numeric; v_status text;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, email) values
    (u_orderer, 'test-orderer@example.com'),
    (u_driver,  'test-driver@example.com'),
    (u_staff,   'test-staff@example.com');
  insert into ordering.locations (code, name_en, is_central)
    values ('TST', 'Test Store', false) returning id into loc_store;
  insert into ordering.locations (code, name_en, is_central)
    values ('TCK', 'Test Central', true) returning id into loc_central;
  insert into ordering.profiles (user_id, role, location_id) values
    (u_orderer, 'restaurant_orderer', loc_store),
    (u_driver,  'driver', null),
    (u_staff,   'kitchen_manager', null);
  insert into ordering.catalog_items (name_en, default_fulfillment, order_unit)
    values ('Test Noodles', 'make', 'kg') returning id into cat_make;
  insert into ordering.catalog_items (name_en, default_fulfillment, order_unit)
    values ('Test Soy Sauce', 'purchase', 'btl') returning id into cat_buy;

  -- ---------- T1: created_by stamped from auth.uid() (P0-1) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_orderer, 'role', 'authenticated')::text, true);
  v := ordering.submit_order(loc_store, 'weekly',
        jsonb_build_array(jsonb_build_object('id', cat_make, 'qty', 10)),
        '[]'::jsonb, null, '2026-07-20'::date, null, null);
  v_order := (v->>'orderId')::uuid;
  if (select created_by from ordering.orders where id = v_order) is distinct from u_orderer then
    raise exception 'T1 FAIL: created_by not stamped from auth.uid()';
  end if;
  -- a forged client value must be overwritten by the trigger
  insert into ordering.orders (location_id, order_type, status, created_by)
    values (loc_store, 'weekly', 'submitted', u_staff) returning id into v_item;
  if (select created_by from ordering.orders where id = v_item) is distinct from u_orderer then
    raise exception 'T1 FAIL: forged created_by was not overwritten';
  end if;
  delete from ordering.orders where id = v_item;
  raise notice 'T1 PASS: created_by stamped server-side';

  -- ---------- T2: weekly merge is atomic + increments quantities (P1-7) ----------
  v := ordering.submit_order(loc_store, 'weekly',
        jsonb_build_array(jsonb_build_object('id', cat_make, 'qty', 5)),
        '[]'::jsonb, null, '2026-07-20'::date, null, null);
  if not (v->>'merged')::boolean then raise exception 'T2 FAIL: weekly order did not merge'; end if;
  select quantity into v_qty from ordering.order_items
   where order_id = v_order and catalog_item_id = cat_make;
  if v_qty <> 15 then raise exception 'T2 FAIL: merged quantity is % (want 15)', v_qty; end if;
  raise notice 'T2 PASS: weekly merge increments atomically';

  -- ---------- T3: quantity constraints (P1-8) ----------
  begin
    perform ordering.submit_order(loc_store, 'weekly',
      jsonb_build_array(jsonb_build_object('id', cat_make, 'qty', 0)),
      '[]'::jsonb, null, null, null, null);
    raise exception 'T3 FAIL: qty 0 was accepted';
  exception when others then
    if sqlerrm like 'T3 FAIL%' then raise; end if;
  end;
  raise notice 'T3 PASS: zero/negative quantities rejected';

  -- ---------- T4: illegal transitions rejected by the DB (P0-5) ----------
  select id into v_item from ordering.order_items
   where order_id = v_order and catalog_item_id = cat_make;
  begin
    update ordering.order_items set dispatch_status = 'received' where id = v_item;
    raise exception 'T4 FAIL: pending -> received was accepted';
  exception when check_violation then null;
  end;
  begin
    update ordering.orders set status = 'completed' where id = v_order;  -- submitted -> completed
    raise exception 'T4 FAIL: submitted -> completed was accepted';
  exception when check_violation then null;
  end;
  raise notice 'T4 PASS: DB rejects illegal jumps';

  -- ---------- T5: production idempotent; undo restores stock (P0-2) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff, 'role', 'authenticated')::text, true);
  perform ordering.kitchen_set_produced(jsonb_build_array(jsonb_build_object('id', v_item, 'fulfilled', 15)));
  select coalesce(sum(qty),0) into v_qty from ordering.stock_batches
   where location_id = loc_central and catalog_item_id = cat_make;
  if v_qty <> 15 then raise exception 'T5 FAIL: stock after produce is % (want 15)', v_qty; end if;
  begin  -- double click must not double-add
    perform ordering.kitchen_set_produced(jsonb_build_array(jsonb_build_object('id', v_item, 'fulfilled', 15)));
    raise exception 'T5 FAIL: double production accepted';
  exception when others then
    if sqlerrm like 'T5 FAIL%' then raise; end if;
  end;
  select coalesce(sum(qty),0) into v_qty from ordering.stock_batches
   where location_id = loc_central and catalog_item_id = cat_make;
  if v_qty <> 15 then raise exception 'T5 FAIL: stock changed on repeat click (% not 15)', v_qty; end if;
  perform ordering.kitchen_reset_item(v_item);   -- undo production
  select coalesce(sum(qty),0) into v_qty from ordering.stock_batches
   where location_id = loc_central and catalog_item_id = cat_make;
  if v_qty <> 0 then raise exception 'T5 FAIL: undo left % in stock (want 0)', v_qty; end if;
  raise notice 'T5 PASS: produce -> repeat-click blocked -> undo restores stock';

  -- ---------- T6: reservations stop double-promising stock (P0-4) ----------
  perform ordering.add_batch(loc_central, cat_make, 10);
  begin  -- item wants 15, only 10 available -> must fail
    perform ordering.kitchen_use_stock(v_item);
    raise exception 'T6 FAIL: reserved more than available';
  exception when others then
    if sqlerrm like 'T6 FAIL%' then raise; end if;
  end;
  -- shrink the line to 6 and reserve for real
  update ordering.order_items set quantity = 6 where id = v_item;
  perform ordering.kitchen_use_stock(v_item);    -- reserves 6 of 10
  if (select count(*) from ordering.stock_reservations where order_item_id = v_item) <> 1 then
    raise exception 'T6 FAIL: reservation row missing';
  end if;
  if ordering.available_stock(loc_central, cat_make) <> 4 then
    raise exception 'T6 FAIL: available should be 4, is %', ordering.available_stock(loc_central, cat_make);
  end if;
  begin  -- repeat click: idempotent, no second reservation
    perform ordering.kitchen_use_stock(v_item);
    raise exception 'T6 FAIL: use-stock on a non-pending line accepted';
  exception when others then
    if sqlerrm like 'T6 FAIL%' then raise; end if;
  end;
  raise notice 'T6 PASS: DB reservation blocks double-promising';

  -- ---------- T7: dispatch is atomic (P0-3) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_driver, 'role', 'authenticated')::text, true);
  perform ordering.dispatch_items(array[v_item]);   -- consumes the 6 reserved
  if (select dispatch_status::text from ordering.order_items where id = v_item) <> 'dispatched' then
    raise exception 'T7 FAIL: item not dispatched';
  end if;
  if (select coalesce(sum(qty),0) from ordering.stock_batches
       where location_id = loc_central and catalog_item_id = cat_make) <> 4 then
    raise exception 'T7 FAIL: stock after dispatch wrong';
  end if;
  if exists (select 1 from ordering.stock_reservations where order_item_id = v_item) then
    raise exception 'T7 FAIL: reservation not consumed on dispatch';
  end if;
  begin  -- re-dispatch must fail and change nothing
    perform ordering.dispatch_items(array[v_item]);
    raise exception 'T7 FAIL: re-dispatch accepted';
  exception when others then
    if sqlerrm like 'T7 FAIL%' then raise; end if;
  end;
  raise notice 'T7 PASS: dispatch consumes reservation + stock atomically; re-dispatch rejected';

  -- ---------- T8: procurement cascade + parent-order sync (P1-10) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_orderer, 'role', 'authenticated')::text, true);
  v := ordering.submit_order(loc_store, 'procurement',
        jsonb_build_array(jsonb_build_object('id', cat_buy, 'qty', 3)),
        jsonb_build_array(jsonb_build_object('name', 'Cleaning spray', 'qty', 2, 'unit', 'pcs')),
        null, null, null, null);
  v_order := (v->>'orderId')::uuid;
  if (select count(*) from ordering.procurement_tasks t
       join ordering.order_items i on i.id = t.source_order_item_id
      where i.order_id = v_order) <> 2 then
    raise exception 'T8 FAIL: expected 2 buy-list tasks for the procurement order';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', u_driver, 'role', 'authenticated')::text, true);
  select t.id into v_task from ordering.procurement_tasks t
    join ordering.order_items i on i.id = t.source_order_item_id
   where i.order_id = v_order and i.catalog_item_id = cat_buy;
  perform ordering.set_procurement_task_status(v_task, 'bought');
  select t.id into v_task from ordering.procurement_tasks t
    join ordering.order_items i on i.id = t.source_order_item_id
   where i.order_id = v_order and i.catalog_item_id is null;
  perform ordering.set_procurement_task_status(v_task, 'unavailable', 'Not found');

  if (select count(*) from ordering.order_items
       where order_id = v_order and dispatch_status in ('pending','procuring')) <> 0 then
    raise exception 'T8 FAIL: a line is still unresolved after bought+unavailable';
  end if;
  select status::text into v_status from ordering.orders where id = v_order;
  if v_status <> 'completed' then
    raise exception 'T8 FAIL: procurement order is % (want completed)', v_status;
  end if;
  perform ordering.set_procurement_task_status(v_task, 'pending');   -- reopen
  select status::text into v_status from ordering.orders where id = v_order;
  if v_status <> 'in_progress' then
    raise exception 'T8 FAIL: reopen left order as % (want in_progress)', v_status;
  end if;
  raise notice 'T8 PASS: procurement cascade + parent-order sync';

  -- ---------- T9: RPC role checks ----------
  begin  -- still "signed in" as the driver
    perform ordering.kitchen_set_produced(jsonb_build_array(jsonb_build_object('id', v_item, 'fulfilled', 1)));
    raise exception 'T9 FAIL: driver ran a kitchen RPC';
  exception when others then
    if sqlerrm like 'T9 FAIL%' then raise; end if;
  end;
  begin  -- orderer cannot mark tasks bought
    perform set_config('request.jwt.claims', json_build_object('sub', u_orderer, 'role', 'authenticated')::text, true);
    perform ordering.set_procurement_task_status(v_task, 'bought');
    raise exception 'T9 FAIL: orderer marked a task bought';
  exception when others then
    if sqlerrm like 'T9 FAIL%' then raise; end if;
  end;
  raise notice 'T9 PASS: RPC role checks hold';

  raise notice 'ALL TESTS PASSED (transaction will be rolled back — no data left behind)';
end $body$;

rollback;
