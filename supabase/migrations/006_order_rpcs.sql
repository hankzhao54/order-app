-- ============================================================
-- 006 — Transactional order & procurement RPCs  (P1-7, P1-10, P0-1)
-- Safe to re-run.
--
--  * submit_order: order + items (+ buy-list tasks for procurement orders)
--    created in ONE transaction; weekly merge locks the target order and
--    uses atomic quantity increments — no lost updates, no empty orders.
--  * set_procurement_task_status / delete_procurement_task: task change,
--    order-line cascade and parent-order recompute in ONE transaction.
--    'unavailable' now cascades to the order line (was stuck in
--    'procuring' forever before).
-- ============================================================

-- ---- keep a procurement order's status in sync with its lines ----
create or replace function ordering.sync_procurement_order(p_order uuid)
returns void
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare o record; v_resolved boolean;
begin
  select * into o from ordering.orders where id = p_order for update;
  if not found or o.order_type <> 'procurement' or o.status in ('cancelled','archived') then
    return;
  end if;
  v_resolved := exists (select 1 from ordering.order_items where order_id = p_order)
    and not exists (select 1 from ordering.order_items
                     where order_id = p_order and dispatch_status in ('pending','procuring'));
  if v_resolved and o.status <> 'completed' then
    if o.status = 'submitted' then
      update ordering.orders set status = 'in_progress' where id = p_order;
    end if;
    update ordering.orders set status = 'completed', completed_at = now() where id = p_order;
  elsif not v_resolved and o.status = 'completed' then
    update ordering.orders set status = 'in_progress', completed_at = null where id = p_order;
  end if;
end $$;

-- ---- create / merge an order, atomically ----
-- p_lines: [{"id":"<catalog uuid>","qty":3}, ...]   (snapshots come from the DB)
-- p_adhoc: [{"name":"Anything","qty":2,"unit":"box"}, ...]
create or replace function ordering.submit_order(
  p_location uuid,
  p_type text,
  p_lines jsonb default '[]',
  p_adhoc jsonb default '[]',
  p_parent uuid default null,
  p_production_week date default null,
  p_event_name text default null,
  p_event_date date default null)
returns jsonb
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare
  v_role ordering.user_role := ordering.my_role();
  v_type ordering.order_type;
  v_order uuid; v_item record; v_target uuid; v_existing uuid;
  l record; v_count int := 0; v_new_item uuid;
begin
  if v_role is null or v_role not in ('restaurant_orderer','store_manager','kitchen_manager','admin') then
    raise exception 'Your account cannot submit orders';
  end if;
  if v_role in ('restaurant_orderer','store_manager') and p_location is distinct from ordering.my_location() then
    raise exception 'You can only order for your own store';
  end if;

  v_type := case when p_parent is not null then 'urgent'::ordering.order_type
                 else p_type::ordering.order_type end;

  if jsonb_array_length(coalesce(p_lines,'[]')) = 0
     and not exists (select 1 from jsonb_array_elements(coalesce(p_adhoc,'[]')) a
                      where coalesce(a->>'name','') <> '') then
    raise exception 'Order is empty';
  end if;

  -- weekly orders merge into an untouched submitted order for the same week
  if v_type = 'weekly' and p_production_week is not null and p_parent is null then
    select o.id into v_target
      from ordering.orders o
     where o.location_id = p_location and o.order_type = 'weekly'
       and o.production_week = p_production_week and o.status = 'submitted'
       and exists (select 1 from ordering.order_items i where i.order_id = o.id)
       and not exists (select 1 from ordering.order_items i
                        where i.order_id = o.id and i.dispatch_status <> 'pending')
     order by o.created_at
     limit 1
       for update of o;

    if v_target is not null then
      for l in select (x->>'id')::uuid as cid, (x->>'qty')::numeric as qty
                 from jsonb_array_elements(coalesce(p_lines,'[]')) x
      loop
        if l.qty is null or l.qty <= 0 then raise exception 'Quantities must be > 0'; end if;
        select i.id into v_existing from ordering.order_items i
         where i.order_id = v_target and i.catalog_item_id = l.cid
         limit 1 for update;
        if v_existing is not null then
          update ordering.order_items set quantity = quantity + l.qty where id = v_existing;
          v_existing := null;
        else
          insert into ordering.order_items (order_id, catalog_item_id, quantity)
          values (v_target, l.cid, l.qty);
        end if;
        v_count := v_count + 1;
      end loop;
      for l in select x->>'name' as name, x->>'unit' as unit, (x->>'qty')::numeric as qty
                 from jsonb_array_elements(coalesce(p_adhoc,'[]')) x
                where coalesce(x->>'name','') <> ''
      loop
        insert into ordering.order_items (order_id, catalog_item_id, item_name_snapshot, unit_snapshot, quantity)
        values (v_target, null, l.name, nullif(l.unit,''), greatest(coalesce(l.qty,1), 0.01));
        v_count := v_count + 1;
      end loop;
      update ordering.orders set submitted_at = now() where id = v_target;
      return jsonb_build_object('orderId', v_target, 'count', v_count, 'merged', true);
    end if;
  end if;

  -- new order + items (+ buy-list tasks) in this same transaction
  insert into ordering.orders
    (location_id, created_by, order_type, status, submitted_at, parent_order_id,
     production_week, event_name, event_date)
  values
    (p_location, auth.uid(), v_type, 'submitted', now(), p_parent,
     case when v_type = 'weekly' then p_production_week end,
     case when v_type = 'event' then p_event_name end,
     case when v_type = 'event' then p_event_date end)
  returning id into v_order;

  for l in select (x->>'id')::uuid as cid, (x->>'qty')::numeric as qty
             from jsonb_array_elements(coalesce(p_lines,'[]')) x
  loop
    if l.qty is null or l.qty <= 0 then raise exception 'Quantities must be > 0'; end if;
    insert into ordering.order_items
      (order_id, catalog_item_id, quantity, dispatch_status, status)
    values
      (v_order, l.cid, l.qty,
       case when v_type = 'procurement' then 'procuring'::ordering.item_dispatch_status
            else 'pending'::ordering.item_dispatch_status end,
       case when v_type = 'procurement' then 'done'::ordering.order_item_status
            else 'pending'::ordering.order_item_status end)
    returning id into v_new_item;

    if v_type = 'procurement' then
      insert into ordering.procurement_tasks
        (item_name, catalog_item_id, quantity, unit, target_location_id,
         source_order_item_id, note, created_by)
      select i.item_name_snapshot, i.catalog_item_id, i.quantity, i.unit_snapshot,
             p_location, i.id, 'store procurement order', auth.uid()
        from ordering.order_items i where i.id = v_new_item;
    end if;
    v_count := v_count + 1;
  end loop;

  for l in select x->>'name' as name, x->>'unit' as unit, (x->>'qty')::numeric as qty
             from jsonb_array_elements(coalesce(p_adhoc,'[]')) x
            where coalesce(x->>'name','') <> ''
  loop
    insert into ordering.order_items
      (order_id, catalog_item_id, item_name_snapshot, unit_snapshot, quantity, dispatch_status, status)
    values
      (v_order, null, l.name, nullif(l.unit,''), greatest(coalesce(l.qty,1), 0.01),
       case when v_type = 'procurement' then 'procuring'::ordering.item_dispatch_status
            else 'pending'::ordering.item_dispatch_status end,
       case when v_type = 'procurement' then 'done'::ordering.order_item_status
            else 'pending'::ordering.order_item_status end)
    returning id into v_new_item;

    if v_type = 'procurement' then
      insert into ordering.procurement_tasks
        (item_name, catalog_item_id, quantity, unit, target_location_id,
         source_order_item_id, note, created_by)
      select i.item_name_snapshot, null, i.quantity, i.unit_snapshot,
             p_location, i.id, 'store procurement order', auth.uid()
        from ordering.order_items i where i.id = v_new_item;
    end if;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('orderId', v_order, 'count', v_count, 'merged', false);
end $$;

-- ---- buy-list task transitions with full cascade, one transaction ----
create or replace function ordering.set_procurement_task_status(
  p_task uuid, p_to text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare t record; it record; v_role ordering.user_role := ordering.my_role();
begin
  select * into t from ordering.procurement_tasks where id = p_task for update;
  if not found then raise exception 'Buy-list entry no longer exists'; end if;

  if p_to in ('bought','unavailable') then
    if v_role not in ('driver','kitchen_manager','admin') then
      raise exception 'Only the driver or kitchen staff can update buy-list entries';
    end if;
    if t.status <> 'pending' then
      raise exception 'Entry already marked % — reload', t.status;
    end if;
  elsif p_to = 'pending' then   -- reopen
    if not (v_role in ('driver','kitchen_manager','admin') or t.created_by = auth.uid()) then
      raise exception 'You cannot reopen this entry';
    end if;
    if t.status = 'pending' then
      return jsonb_build_object('status', 'pending');   -- idempotent
    end if;
  else
    raise exception 'Unknown target status %', p_to;
  end if;

  update ordering.procurement_tasks
     set status = p_to::ordering.procurement_status,
         unavail_reason = case when p_to = 'unavailable' then p_reason end,
         bought_by = case when p_to = 'pending' then null else auth.uid() end
   where id = t.id;

  if t.source_order_item_id is not null then
    select * into it from ordering.order_items
     where id = t.source_order_item_id for update;
    if found then
      if p_to = 'bought' and it.dispatch_status = 'procuring' then
        update ordering.order_items
           set dispatch_status = 'ready', status = 'done',
               fulfilled_qty = it.quantity, unavail_reason = null, handled_by = auth.uid()
         where id = it.id;
      elsif p_to = 'unavailable' and it.dispatch_status = 'procuring' then
        update ordering.order_items
           set dispatch_status = 'unavailable', status = 'done',
               fulfilled_qty = 0, unavail_reason = coalesce(p_reason, 'not available'),
               handled_by = auth.uid()
         where id = it.id;
      elsif p_to = 'pending' and it.dispatch_status in ('ready','unavailable') then
        update ordering.order_items
           set dispatch_status = 'procuring', status = 'done',
               fulfilled_qty = null, unavail_reason = null
         where id = it.id;
      end if;
      perform ordering.sync_procurement_order(it.order_id);
    end if;
  end if;

  return jsonb_build_object('status', p_to);
end $$;

-- ---- deleting a buy-list entry defines what happens to its order line ----
create or replace function ordering.delete_procurement_task(p_task uuid)
returns jsonb
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare t record; it record; v_parent_type ordering.order_type;
        v_role ordering.user_role := ordering.my_role();
begin
  select * into t from ordering.procurement_tasks where id = p_task for update;
  if not found then return jsonb_build_object('deleted', false); end if;

  if not (v_role = 'admin' or (t.created_by = auth.uid() and t.status = 'pending')) then
    raise exception 'Only the creator (while pending) or an admin can remove this entry';
  end if;

  if t.source_order_item_id is not null then
    select i.*, o.order_type as parent_type into it
      from ordering.order_items i join ordering.orders o on o.id = i.order_id
     where i.id = t.source_order_item_id for update of i;
    if found and it.dispatch_status = 'procuring' then
      if it.parent_type = 'procurement' then
        -- the line's only fulfilment path is this task: resolve it as unavailable
        update ordering.order_items
           set dispatch_status = 'unavailable', status = 'done',
               fulfilled_qty = 0, unavail_reason = 'removed from buy list'
         where id = it.id;
      else
        -- kitchen order: hand the line back to the kitchen
        update ordering.order_items
           set dispatch_status = 'pending', status = 'pending',
               fulfilled_qty = null, unavail_reason = null
         where id = it.id;
      end if;
      perform ordering.sync_procurement_order(it.order_id);
    end if;
  end if;

  delete from ordering.procurement_tasks where id = p_task;
  return jsonb_build_object('deleted', true);
end $$;

grant execute on function
  ordering.sync_procurement_order(uuid),
  ordering.submit_order(uuid, text, jsonb, jsonb, uuid, date, text, date),
  ordering.set_procurement_task_status(uuid, text, text),
  ordering.delete_procurement_task(uuid)
to authenticated;
