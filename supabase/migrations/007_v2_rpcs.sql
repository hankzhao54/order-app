-- ============================================================
-- 007 — v2 frontend: remaining multi-step writes as transactional RPCs
-- Safe to re-run. Additive only: the v1 frontend keeps working.
--
-- v1 still did a few multi-step or unlogged writes from the browser:
--   * store "receive delivery" = status flip + add_batch as two calls
--     (a failure in between lost the stock or double-counted it)
--   * the dispatch desk could mark a MAKE line ready without producing it,
--     so the later dispatch failed for lack of stock
--   * "procuring -> ready" at the dispatch desk bypassed the buy-list task
--   * editing / deleting a batch changed stock without a stock_moves entry
--   * order status changes were compare-and-swap from the client with the
--     business rules ("all lines handled before complete") only in React
-- Every one of these is now a single SECURITY DEFINER function that checks
-- the caller's role itself.
-- ============================================================

-- ---- helpers -------------------------------------------------------------
create or replace function ordering.central_location()
returns uuid
language sql stable security definer set search_path to 'ordering','public'
as $$
  select id from ordering.locations where is_central and is_active order by created_at limit 1;
$$;

-- ---- purchase lines on kitchen orders: bought at the dispatch desk -------
-- pending  -> ready          (bought directly)
-- procuring-> ready          (resolves the linked buy-list task too)
create or replace function ordering.mark_item_bought(p_item uuid)
returns jsonb
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare it record; v_task uuid;
begin
  if not (ordering.is_staff() or ordering.my_role() = 'driver') then
    raise exception 'Only kitchen staff or the driver can mark items bought';
  end if;
  select * into it from ordering.order_items where id = p_item for update;
  if not found then raise exception 'Order line no longer exists'; end if;

  if it.dispatch_status = 'procuring' then
    select id into v_task from ordering.procurement_tasks
     where source_order_item_id = it.id and status = 'pending' limit 1;
    if v_task is not null then
      return ordering.set_procurement_task_status(v_task, 'bought', null);
    end if;
  elsif it.dispatch_status <> 'pending' then
    raise exception '"%": already handled (now %) — reload', it.item_name_snapshot, it.dispatch_status;
  end if;

  if coalesce(it.fulfillment_type, 'purchase') = 'make' and it.dispatch_status = 'pending' then
    raise exception '"%" is made by the kitchen — confirm it on the Kitchen page', it.item_name_snapshot;
  end if;

  update ordering.order_items
     set dispatch_status = 'ready', status = 'done', fulfilled_qty = it.quantity,
         unavail_reason = null, handled_by = auth.uid()
   where id = it.id;
  return jsonb_build_object('status', 'ready');
end $$;

-- ---- any pending line: can't be supplied ---------------------------------
create or replace function ordering.mark_item_unavailable(p_item uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare it record;
begin
  if not (ordering.is_staff() or ordering.my_role() = 'driver') then
    raise exception 'Only kitchen staff or the driver can mark items unavailable';
  end if;
  select * into it from ordering.order_items where id = p_item for update;
  if not found then raise exception 'Order line no longer exists'; end if;
  if it.dispatch_status <> 'pending' then
    raise exception '"%": already handled (now %) — reload', it.item_name_snapshot, it.dispatch_status;
  end if;
  update ordering.order_items
     set dispatch_status = 'unavailable', status = 'done', fulfilled_qty = 0,
         unavail_reason = coalesce(nullif(trim(p_reason), ''), 'not available'),
         handled_by = auth.uid()
   where id = it.id;
  return jsonb_build_object('status', 'unavailable');
end $$;

-- ---- hand a pending line to the driver's buy list -------------------------
create or replace function ordering.send_item_to_buyer(p_item uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare it record; v_loc uuid; v_task uuid;
begin
  if not ordering.is_staff() then
    raise exception 'Only kitchen staff can send lines to the buy list';
  end if;
  select i.*, o.location_id as order_loc into it
    from ordering.order_items i join ordering.orders o on o.id = i.order_id
   where i.id = p_item for update of i;
  if not found then raise exception 'Order line no longer exists'; end if;
  if it.dispatch_status <> 'pending' then
    raise exception '"%": already handled (now %) — reload', it.item_name_snapshot, it.dispatch_status;
  end if;

  update ordering.order_items
     set dispatch_status = 'procuring', status = 'done', handled_by = auth.uid()
   where id = it.id;
  insert into ordering.procurement_tasks
    (item_name, catalog_item_id, quantity, unit, target_location_id, source_order_item_id, note, created_by)
  values
    (it.item_name_snapshot, it.catalog_item_id, it.quantity, it.unit_snapshot, it.order_loc, it.id,
     coalesce(nullif(trim(p_note), ''), 'from kitchen order'), auth.uid())
  returning id into v_task;
  return jsonb_build_object('taskId', v_task);
end $$;

-- ---- store confirms a delivery: status + stock in ONE transaction --------
create or replace function ordering.receive_items(p_item_ids uuid[])
returns jsonb
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare
  it record; v_role ordering.user_role := ordering.my_role(); v_my uuid := ordering.my_location();
  v_qty numeric; v_life int; v_count int := 0;
begin
  if v_role is null then raise exception 'Not signed in'; end if;

  for it in
    select i.*, o.location_id as order_loc
      from ordering.order_items i join ordering.orders o on o.id = i.order_id
     where i.id = any(p_item_ids)
     order by i.id
       for update of i
  loop
    if not (v_role in ('kitchen_manager','admin') or it.order_loc = v_my) then
      raise exception 'You can only receive deliveries for your own store';
    end if;
    if it.dispatch_status <> 'dispatched' then
      raise exception '"%": not out for delivery (now %) — nothing was received',
        it.item_name_snapshot, it.dispatch_status;
    end if;

    update ordering.order_items set dispatch_status = 'received', status = 'done' where id = it.id;

    v_qty := coalesce(it.fulfilled_qty, it.quantity);
    if it.catalog_item_id is not null and v_qty > 0 then
      select shelf_life_days into v_life from ordering.catalog_items where id = it.catalog_item_id;
      insert into ordering.stock_batches (location_id, catalog_item_id, qty, produced_on, expires_on, note, source_order_item_id)
      values (it.order_loc, it.catalog_item_id, v_qty, current_date,
              case when v_life is not null then current_date + v_life end, 'received', null);
      insert into ordering.stock_moves (catalog_item_id, delta, reason, order_item_id, created_by, location_id)
      values (it.catalog_item_id, v_qty, 'received', it.id, auth.uid(), it.order_loc);
      perform ordering.sync_loc_qty(it.order_loc, it.catalog_item_id);
    end if;
    v_count := v_count + 1;
  end loop;

  if v_count < coalesce(array_length(p_item_ids, 1), 0) then
    raise exception 'Some lines no longer exist — reload and retry. Nothing was received.';
  end if;
  return jsonb_build_object('received', v_count);
end $$;

-- ---- order status changes with the business rules in the database --------
-- complete : staff; every line handled (not pending)
-- reopen   : staff; completed -> in_progress
-- cancel   : staff any open order; store roles their own untouched order
-- restore  : staff; back to in_progress if any line was touched, else submitted
-- archive  : staff; every line terminal (dispatched/received/unavailable,
--            or ready/short/procuring-resolved for procurement orders)
-- start    : staff; submitted -> in_progress
create or replace function ordering.set_orders_status(p_ids uuid[], p_action text)
returns jsonb
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare
  o record; v_role ordering.user_role := ordering.my_role(); v_staff boolean := ordering.is_staff();
  v_to ordering.order_status; v_count int := 0; v_loc text;
begin
  if v_role is null then raise exception 'Not signed in'; end if;
  if p_action not in ('complete','reopen','cancel','restore','archive','start') then
    raise exception 'Unknown action %', p_action;
  end if;

  for o in select * from ordering.orders where id = any(p_ids) order by id for update
  loop
    select name_en into v_loc from ordering.locations where id = o.location_id;

    if p_action = 'cancel' then
      if not v_staff then
        if not (v_role in ('restaurant_orderer','store_manager') and o.location_id = ordering.my_location()
                and o.status = 'submitted'
                and not exists (select 1 from ordering.order_items where order_id = o.id and dispatch_status <> 'pending'))
        then
          raise exception 'Only the kitchen can cancel an order it has started';
        end if;
      end if;
      if o.status not in ('submitted','in_progress') then
        raise exception '% order is % — cannot cancel', v_loc, o.status;
      end if;
      -- release reservations held by this order's lines
      delete from ordering.stock_reservations r using ordering.order_items i
       where r.order_item_id = i.id and i.order_id = o.id;
      update ordering.orders set status = 'cancelled' where id = o.id;
      perform ordering.log_audit('order.cancel', v_loc || ' · ' || o.order_type, jsonb_build_object('order_id', o.id));

    elsif not v_staff then
      raise exception 'Only kitchen staff can change order status';

    elsif p_action = 'start' then
      if o.status = 'submitted' then
        update ordering.orders set status = 'in_progress' where id = o.id;
      end if;

    elsif p_action = 'complete' then
      if exists (select 1 from ordering.order_items where order_id = o.id and dispatch_status = 'pending') then
        raise exception '% still has unhandled lines — nothing was completed', v_loc;
      end if;
      if o.status = 'submitted' then
        update ordering.orders set status = 'in_progress' where id = o.id;
      elsif o.status <> 'in_progress' then
        raise exception '% order is % — cannot complete', v_loc, o.status;
      end if;
      update ordering.orders set status = 'completed', completed_at = now() where id = o.id;

    elsif p_action = 'reopen' then
      if o.status <> 'completed' then raise exception 'Only completed orders can be reopened'; end if;
      update ordering.orders set status = 'in_progress', completed_at = null where id = o.id;

    elsif p_action = 'restore' then
      if o.status <> 'cancelled' then raise exception 'Only cancelled orders can be restored'; end if;
      v_to := case when exists (select 1 from ordering.order_items where order_id = o.id and dispatch_status <> 'pending')
                   then 'in_progress'::ordering.order_status else 'submitted'::ordering.order_status end;
      update ordering.orders set status = v_to where id = o.id;

    elsif p_action = 'archive' then
      if exists (select 1 from ordering.order_items
                  where order_id = o.id
                    and dispatch_status not in ('dispatched','received','unavailable')
                    and not (o.order_type = 'procurement' and dispatch_status in ('ready','short'))) then
        raise exception '% has lines not yet delivered or resolved — nothing was archived', v_loc;
      end if;
      if o.status = 'submitted' then
        update ordering.orders set status = 'in_progress' where id = o.id;
        update ordering.orders set status = 'completed', completed_at = coalesce(o.completed_at, now()) where id = o.id;
      elsif o.status = 'in_progress' then
        update ordering.orders set status = 'completed', completed_at = coalesce(o.completed_at, now()) where id = o.id;
      elsif o.status not in ('completed') then
        raise exception '% order is % — cannot archive', v_loc, o.status;
      end if;
      update ordering.orders set status = 'archived' where id = o.id;
    end if;
    v_count := v_count + 1;
  end loop;

  if v_count < coalesce(array_length(p_ids, 1), 0) then
    raise exception 'Some orders no longer exist — reload and retry. Nothing was changed.';
  end if;
  return jsonb_build_object('updated', v_count);
end $$;

-- ---- kitchen edits an ordered quantity / removes a line --------------------
create or replace function ordering.update_order_line(p_item uuid, p_qty numeric)
returns jsonb
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare it record;
begin
  if not ordering.is_staff() then raise exception 'Only kitchen staff can edit order lines'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be > 0 (remove the line instead)'; end if;
  select * into it from ordering.order_items where id = p_item for update;
  if not found then raise exception 'Order line no longer exists'; end if;
  if it.dispatch_status not in ('pending','unavailable') then
    raise exception '"%": already % — undo it first to change the quantity', it.item_name_snapshot, it.dispatch_status;
  end if;
  update ordering.order_items set quantity = p_qty where id = it.id;
  return jsonb_build_object('quantity', p_qty);
end $$;

create or replace function ordering.delete_order_line(p_item uuid)
returns jsonb
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare it record;
begin
  if not ordering.is_staff() then raise exception 'Only kitchen staff can remove order lines'; end if;
  select * into it from ordering.order_items where id = p_item for update;
  if not found then return jsonb_build_object('deleted', false); end if;
  if it.dispatch_status not in ('pending','unavailable') then
    raise exception '"%": already % — undo it first to remove it', it.item_name_snapshot, it.dispatch_status;
  end if;
  delete from ordering.order_items where id = it.id;
  return jsonb_build_object('deleted', true);
end $$;

-- ---- batch corrections, always logged -------------------------------------
create or replace function ordering.edit_batch(p_batch uuid, p_qty numeric, p_note text default 'batch correction')
returns numeric
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare b record; v_delta numeric;
begin
  if p_qty is null or p_qty < 0 then raise exception 'Quantity must be ≥ 0'; end if;
  select * into b from ordering.stock_batches where id = p_batch for update;
  if not found then raise exception 'Batch no longer exists'; end if;
  if not (ordering.my_role() in ('kitchen_manager','admin') or b.location_id = ordering.my_location()) then
    raise exception 'You can only edit batches at your own location';
  end if;
  v_delta := p_qty - b.qty;
  if v_delta = 0 then return b.qty; end if;
  if p_qty = 0 then
    delete from ordering.stock_batches where id = b.id;
  else
    update ordering.stock_batches set qty = p_qty where id = b.id;
  end if;
  insert into ordering.stock_moves (catalog_item_id, delta, reason, note, created_by, location_id)
  values (b.catalog_item_id, v_delta, 'manual', p_note, auth.uid(), b.location_id);
  perform ordering.sync_loc_qty(b.location_id, b.catalog_item_id);
  return p_qty;
end $$;

grant execute on function
  ordering.central_location(),
  ordering.mark_item_bought(uuid),
  ordering.mark_item_unavailable(uuid, text),
  ordering.send_item_to_buyer(uuid, text),
  ordering.receive_items(uuid[]),
  ordering.set_orders_status(uuid[], text),
  ordering.update_order_line(uuid, numeric),
  ordering.delete_order_line(uuid),
  ordering.edit_batch(uuid, numeric, text)
to authenticated;

-- ---- realtime: make sure the tables the v2 UI listens to are published ----
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['orders','order_items','procurement_tasks','stock_batches','stock_returns','location_stock']
    loop
      begin
        execute format('alter publication supabase_realtime add table ordering.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;
