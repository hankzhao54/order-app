-- ============================================================
-- Integration tests for migration 007 (v2 RPCs).
-- Run AFTER migrations 001..007. Everything is rolled back at the end.
-- Every check RAISES EXCEPTION on failure; success prints NOTICEs.
-- ============================================================
begin;

do $body$
declare
  u_orderer uuid := gen_random_uuid();
  u_other   uuid := gen_random_uuid();
  u_driver  uuid := gen_random_uuid();
  u_staff   uuid := gen_random_uuid();
  loc_store uuid; loc_store2 uuid; loc_central uuid; cat_make uuid; cat_buy uuid;
  v jsonb; v_order uuid; v_make_line uuid; v_buy_line uuid; v_task uuid; v_batch uuid;
  v_qty numeric; v_n int; v_status text; ok boolean;

begin
  insert into auth.users (id, email) values
    (u_orderer, 't-orderer@x'), (u_other, 't-other@x'), (u_driver, 't-driver@x'), (u_staff, 't-staff@x');
  insert into ordering.locations (code, name_en, is_central) values ('V2S', 'V2 Store', false) returning id into loc_store;
  insert into ordering.locations (code, name_en, is_central) values ('V2T', 'V2 Store 2', false) returning id into loc_store2;
  -- the central kitchen must be the oldest active central location
  select id into loc_central from ordering.locations where is_central and is_active order by created_at limit 1;
  if loc_central is null then
    insert into ordering.locations (code, name_en, is_central) values ('V2C', 'V2 Central', true) returning id into loc_central;
  end if;
  insert into ordering.profiles (user_id, role, location_id) values
    (u_orderer, 'restaurant_orderer', loc_store),
    (u_other,   'restaurant_orderer', loc_store2),
    (u_driver,  'driver', null),
    (u_staff,   'kitchen_manager', null);
  insert into ordering.catalog_items (name_en, default_fulfillment, order_unit, shelf_life_days)
    values ('V2 Dumplings', 'make', 'bag', 5) returning id into cat_make;
  insert into ordering.catalog_items (name_en, default_fulfillment, order_unit)
    values ('V2 Oil', 'purchase', 'can') returning id into cat_buy;

  -- orderer submits an urgent order with one make + one buy line
  perform set_config('request.jwt.claims', json_build_object('sub', u_orderer, 'role', 'authenticated')::text, true);
  v := ordering.submit_order(loc_store, 'urgent',
        jsonb_build_array(jsonb_build_object('id', cat_make, 'qty', 4), jsonb_build_object('id', cat_buy, 'qty', 2)),
        '[]'::jsonb, null, null, null, null);
  v_order := (v->>'orderId')::uuid;
  select id into v_make_line from ordering.order_items where order_id = v_order and catalog_item_id = cat_make;
  select id into v_buy_line  from ordering.order_items where order_id = v_order and catalog_item_id = cat_buy;

  -- ---------- A: store roles may cancel only their own untouched order ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  begin
    perform ordering.set_orders_status(array[v_order], 'cancel');
    raise exception 'A FAIL: other store cancelled someone else''s order';
  exception when others then
    if sqlerrm like 'A FAIL%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_orderer, 'role', 'authenticated')::text, true);
  begin
    perform ordering.set_orders_status(array[v_order], 'complete');
    raise exception 'A FAIL: orderer completed an order';
  exception when others then
    if sqlerrm like 'A FAIL%' then raise; end if;
  end;
  perform ordering.set_orders_status(array[v_order], 'cancel');
  if (select status from ordering.orders where id = v_order) <> 'cancelled' then raise exception 'A FAIL: own cancel'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff, 'role', 'authenticated')::text, true);
  perform ordering.set_orders_status(array[v_order], 'restore');
  if (select status from ordering.orders where id = v_order) <> 'submitted' then raise exception 'A FAIL: restore of untouched order should land in submitted'; end if;
  raise notice 'A PASS: cancel / restore permissions';

  -- ---------- B: dispatch desk cannot fake-produce a MAKE line ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_driver, 'role', 'authenticated')::text, true);
  begin
    perform ordering.mark_item_bought(v_make_line);
    raise exception 'B FAIL: make line marked bought';
  exception when others then
    if sqlerrm like 'B FAIL%' then raise; end if;
  end;
  raise notice 'B PASS: make lines must go through the kitchen';

  -- ---------- C: complete blocked while lines are pending ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff, 'role', 'authenticated')::text, true);
  begin
    perform ordering.set_orders_status(array[v_order], 'complete');
    raise exception 'C FAIL: completed with pending lines';
  exception when others then
    if sqlerrm like 'C FAIL%' then raise; end if;
  end;
  raise notice 'C PASS: complete requires every line handled';

  -- ---------- D: send buy line to buyer, driver buys it via the line ----------
  v := ordering.send_item_to_buyer(v_buy_line, null);
  v_task := (v->>'taskId')::uuid;
  if (select dispatch_status from ordering.order_items where id = v_buy_line) <> 'procuring' then raise exception 'D FAIL: not procuring'; end if;
  if (select target_location_id from ordering.procurement_tasks where id = v_task) <> loc_store then raise exception 'D FAIL: task target'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_driver, 'role', 'authenticated')::text, true);
  perform ordering.mark_item_bought(v_buy_line);
  if (select status from ordering.procurement_tasks where id = v_task) <> 'bought' then raise exception 'D FAIL: task not resolved'; end if;
  if (select dispatch_status from ordering.order_items where id = v_buy_line) <> 'ready' then raise exception 'D FAIL: line not ready'; end if;
  raise notice 'D PASS: procuring line resolves through its buy-list task';

  -- ---------- E: produce, complete, dispatch, receive (stock lands at store) ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff, 'role', 'authenticated')::text, true);
  perform ordering.kitchen_set_produced(jsonb_build_array(jsonb_build_object('id', v_make_line, 'fulfilled', 4)));
  perform ordering.set_orders_status(array[v_order], 'complete');
  if (select status from ordering.orders where id = v_order) <> 'completed' then raise exception 'E FAIL: complete'; end if;
  perform ordering.dispatch_items(array[v_make_line, v_buy_line]);

  -- another store cannot receive it
  perform set_config('request.jwt.claims', json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  begin
    perform ordering.receive_items(array[v_make_line]);
    raise exception 'E FAIL: foreign store received';
  exception when others then
    if sqlerrm like 'E FAIL%' then raise; end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u_orderer, 'role', 'authenticated')::text, true);
  perform ordering.receive_items(array[v_make_line, v_buy_line]);
  select qty into v_qty from ordering.location_stock where location_id = loc_store and catalog_item_id = cat_make;
  if v_qty <> 4 then raise exception 'E FAIL: store stock %, expected 4', v_qty; end if;
  select qty into v_qty from ordering.location_stock where location_id = loc_store and catalog_item_id = cat_buy;
  if v_qty <> 2 then raise exception 'E FAIL: store stock (buy) %, expected 2', v_qty; end if;
  if (select expires_on from ordering.stock_batches where location_id = loc_store and catalog_item_id = cat_make limit 1)
     is distinct from current_date + 5 then raise exception 'E FAIL: expiry not from shelf life'; end if;
  if not exists (select 1 from ordering.stock_moves where order_item_id = v_make_line and reason = 'received' and delta = 4) then
    raise exception 'E FAIL: no received stock move';
  end if;
  -- receiving twice must fail and change nothing
  begin
    perform ordering.receive_items(array[v_make_line]);
    raise exception 'E FAIL: double receive';
  exception when others then
    if sqlerrm like 'E FAIL%' then raise; end if;
  end;
  select qty into v_qty from ordering.location_stock where location_id = loc_store and catalog_item_id = cat_make;
  if v_qty <> 4 then raise exception 'E FAIL: double receive changed stock'; end if;
  raise notice 'E PASS: receive is atomic, scoped and idempotent-safe';

  -- ---------- F: archive only when everything is delivered ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff, 'role', 'authenticated')::text, true);
  perform ordering.set_orders_status(array[v_order], 'archive');
  if (select status from ordering.orders where id = v_order) <> 'archived' then raise exception 'F FAIL: archive'; end if;
  raise notice 'F PASS: archive';

  -- ---------- G: edit_batch logs a manual move and resyncs ----------
  select id into v_batch from ordering.stock_batches where location_id = loc_store and catalog_item_id = cat_make limit 1;
  perform ordering.edit_batch(v_batch, 3, 'test');
  select qty into v_qty from ordering.location_stock where location_id = loc_store and catalog_item_id = cat_make;
  if v_qty <> 3 then raise exception 'G FAIL: stock after edit %', v_qty; end if;
  if not exists (select 1 from ordering.stock_moves where location_id = loc_store and catalog_item_id = cat_make and reason = 'manual' and delta = -1) then
    raise exception 'G FAIL: no manual move';
  end if;
  perform ordering.edit_batch(v_batch, 0, 'test');
  if exists (select 1 from ordering.stock_batches where id = v_batch) then raise exception 'G FAIL: zero batch not deleted'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u_other, 'role', 'authenticated')::text, true);
  select id into v_batch from ordering.stock_batches where location_id = loc_store and catalog_item_id = cat_buy limit 1;
  begin
    perform ordering.edit_batch(v_batch, 10, 'hack');
    raise exception 'G FAIL: foreign store edited a batch';
  exception when others then
    if sqlerrm like 'G FAIL%' then raise; end if;
  end;
  raise notice 'G PASS: batch edits logged and scoped';

  -- ---------- H: line edits only while pending ----------
  perform set_config('request.jwt.claims', json_build_object('sub', u_orderer, 'role', 'authenticated')::text, true);
  v := ordering.submit_order(loc_store, 'urgent',
        jsonb_build_array(jsonb_build_object('id', cat_make, 'qty', 2)), '[]'::jsonb, null, null, null, null);
  v_order := (v->>'orderId')::uuid;
  select id into v_make_line from ordering.order_items where order_id = v_order;
  perform set_config('request.jwt.claims', json_build_object('sub', u_staff, 'role', 'authenticated')::text, true);
  perform ordering.update_order_line(v_make_line, 6);
  if (select quantity from ordering.order_items where id = v_make_line) <> 6 then raise exception 'H FAIL: qty edit'; end if;
  perform ordering.kitchen_set_produced(jsonb_build_array(jsonb_build_object('id', v_make_line, 'fulfilled', 6)));
  begin
    perform ordering.update_order_line(v_make_line, 1);
    raise exception 'H FAIL: edited a ready line';
  exception when others then
    if sqlerrm like 'H FAIL%' then raise; end if;
  end;
  begin
    perform ordering.delete_order_line(v_make_line);
    raise exception 'H FAIL: deleted a ready line';
  exception when others then
    if sqlerrm like 'H FAIL%' then raise; end if;
  end;
  perform ordering.mark_item_unavailable(v_make_line, 'x') ;
  raise exception 'H FAIL: unavailable on a ready line';
exception when others then
  if sqlerrm like '%FAIL%' then raise; end if;
  if sqlerrm not like '%already handled%' then raise; end if;
  raise notice 'H PASS: line edits only while pending';
  raise notice 'ALL V2 TESTS PASSED (rolled back)';
end $body$;

rollback;
