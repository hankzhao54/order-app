-- ============================================================
-- 005 — Transactional stock RPCs  (P0-2, P0-3, P0-4, P1-9)
-- Safe to re-run.
--
--  * Production batches are linked to the order line (source_order_item_id)
--    so confirming production can be undone exactly once, transactionally.
--  * "Use stock" now creates a DB reservation instead of a React-only
--    subtraction, so two terminals can't promise the same stock twice.
--  * Dispatch checks stock, consumes FIFO with row locks, writes the stock
--    move and flips the status in ONE transaction — all-or-nothing.
-- ============================================================

-- ---- schema additions ----
alter table ordering.stock_batches
  add column if not exists source_order_item_id uuid references ordering.order_items(id) on delete set null;
create index if not exists sb_source_item_idx
  on ordering.stock_batches (source_order_item_id) where source_order_item_id is not null;

create table if not exists ordering.stock_reservations (
  order_item_id   uuid primary key references ordering.order_items(id) on delete cascade,
  location_id     uuid not null references ordering.locations(id),
  catalog_item_id uuid not null references ordering.catalog_items(id),
  qty             numeric not null check (qty > 0),
  created_by      uuid,
  created_at      timestamptz not null default now()
);
alter table ordering.stock_reservations enable row level security;
drop policy if exists resv_read on ordering.stock_reservations;
create policy resv_read on ordering.stock_reservations
  for select to public using (auth.role() = 'authenticated');
-- no insert/update/delete policies: writes only happen inside the
-- security-definer RPCs below.
grant select on ordering.stock_reservations to authenticated;

-- ---- available = physical batches minus everyone else's reservations ----
create or replace function ordering.available_stock(p_loc uuid, p_item uuid, p_exclude_item uuid default null)
returns numeric
language sql stable security definer set search_path to 'ordering','public'
as $$
  select coalesce((select sum(qty) from ordering.stock_batches
                    where location_id = p_loc and catalog_item_id = p_item and qty > 0), 0)
       - coalesce((select sum(qty) from ordering.stock_reservations
                    where location_id = p_loc and catalog_item_id = p_item
                      and (p_exclude_item is null or order_item_id <> p_exclude_item)), 0);
$$;

-- ---- confirm production (single or bulk) — idempotent, one transaction ----
-- p_rows: [{"id": "<order_item uuid>", "fulfilled": 12}, ...]
-- fulfilled >= quantity  -> ready (clamped to quantity)
-- 0 < fulfilled < qty    -> short
-- Repeat calls fail on the "not pending" check, so stock can never be
-- added twice for the same line.
create or replace function ordering.kitchen_set_produced(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare
  r record; it record; v_central uuid; v_fulfilled numeric;
  v_to ordering.item_dispatch_status; v_done int := 0;
begin
  if not ordering.is_staff() then
    raise exception 'Only kitchen staff can confirm production';
  end if;
  select id into v_central from ordering.locations where is_central and is_active limit 1;

  for r in
    select (x->>'id')::uuid as id, (x->>'fulfilled')::numeric as fulfilled
      from jsonb_array_elements(p_rows) x
     order by (x->>'id')            -- stable lock order across concurrent calls
  loop
    select * into it from ordering.order_items where id = r.id for update;
    if not found then raise exception 'Order line % no longer exists', r.id; end if;
    if it.dispatch_status <> 'pending' then
      raise exception '"%": already handled (now %) — reload and retry',
        it.item_name_snapshot, it.dispatch_status;
    end if;
    if r.fulfilled is null or r.fulfilled <= 0 then
      raise exception '"%": produced quantity must be > 0 (use "None" for zero)', it.item_name_snapshot;
    end if;

    v_fulfilled := least(r.fulfilled, it.quantity);
    v_to := case when v_fulfilled >= it.quantity then 'ready' else 'short' end;

    update ordering.order_items
       set dispatch_status = v_to, status = 'done',
           fulfilled_qty = v_fulfilled, unavail_reason = null, handled_by = auth.uid()
     where id = it.id;

    -- production adds stock at the central kitchen, linked to this line
    if it.catalog_item_id is not null and it.fulfillment_type = 'make' and v_central is not null then
      insert into ordering.stock_batches
        (location_id, catalog_item_id, qty, produced_on, expires_on, note, source_order_item_id)
      select v_central, it.catalog_item_id, v_fulfilled, current_date,
             case when c.shelf_life_days is not null then current_date + c.shelf_life_days end,
             'produced for order line', it.id
        from ordering.catalog_items c where c.id = it.catalog_item_id;
      insert into ordering.stock_moves (catalog_item_id, delta, reason, order_item_id, created_by, location_id)
      values (it.catalog_item_id, v_fulfilled, 'produced', it.id, auth.uid(), v_central);
      perform ordering.sync_loc_qty(v_central, it.catalog_item_id);
    end if;
    v_done := v_done + 1;
  end loop;

  return jsonb_build_object('updated', v_done);
end $$;

-- ---- fulfil from existing stock: reserve in the DB, not in React ----
create or replace function ordering.kitchen_use_stock(p_item uuid)
returns jsonb
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare it record; v_central uuid; v_avail numeric;
begin
  if not ordering.is_staff() then
    raise exception 'Only kitchen staff can fulfil from stock';
  end if;
  select id into v_central from ordering.locations where is_central and is_active limit 1;
  if v_central is null then raise exception 'No active central kitchen location'; end if;

  select * into it from ordering.order_items where id = p_item for update;
  if not found then raise exception 'Order line no longer exists'; end if;
  if it.dispatch_status <> 'pending' then
    raise exception '"%": already handled (now %) — reload and retry', it.item_name_snapshot, it.dispatch_status;
  end if;
  if it.catalog_item_id is null then raise exception 'Ad-hoc items have no stock to use'; end if;

  -- serialize concurrent reservations of the same product
  perform 1 from ordering.stock_batches
    where location_id = v_central and catalog_item_id = it.catalog_item_id and qty > 0
    for update;

  v_avail := ordering.available_stock(v_central, it.catalog_item_id, it.id);
  if v_avail < it.quantity then
    raise exception 'Not enough stock of "%": available %, need %',
      it.item_name_snapshot, v_avail, it.quantity;
  end if;

  insert into ordering.stock_reservations (order_item_id, location_id, catalog_item_id, qty, created_by)
  values (it.id, v_central, it.catalog_item_id, it.quantity, auth.uid())
  on conflict (order_item_id) do nothing;   -- idempotent

  update ordering.order_items
     set dispatch_status = 'ready', status = 'done',
         fulfilled_qty = it.quantity, unavail_reason = null, handled_by = auth.uid()
   where id = it.id;

  return jsonb_build_object('reserved', it.quantity);
end $$;

-- ---- undo a confirmed line: reverse the linked batch / release reservation ----
create or replace function ordering.kitchen_reset_item(p_item uuid)
returns jsonb
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare
  it record; v_net numeric; v_remaining numeric := 0; v_loc uuid; b record;
begin
  if not ordering.is_staff() then
    raise exception 'Only kitchen staff can reset order lines';
  end if;

  select * into it from ordering.order_items where id = p_item for update;
  if not found then raise exception 'Order line no longer exists'; end if;
  if it.dispatch_status not in ('ready','short','unavailable','procuring') then
    raise exception '"%": cannot reset from % (already left the kitchen)',
      it.item_name_snapshot, it.dispatch_status;
  end if;

  if it.dispatch_status in ('ready','short') then
    -- release a use-stock reservation, if any
    delete from ordering.stock_reservations where order_item_id = it.id;

    -- undo production stock still linked to this line
    for b in select * from ordering.stock_batches
              where source_order_item_id = it.id for update
    loop
      v_remaining := v_remaining + b.qty;
      v_loc := b.location_id;
    end loop;

    select coalesce(sum(delta), 0) into v_net
      from ordering.stock_moves
     where order_item_id = it.id and reason in ('produced','production undone');

    if v_net > 0 then
      if v_remaining < v_net then
        raise exception
          'Cannot undo "%": % of the produced stock was already used elsewhere',
          it.item_name_snapshot, v_net - v_remaining;
      end if;
      delete from ordering.stock_batches where source_order_item_id = it.id;
      insert into ordering.stock_moves (catalog_item_id, delta, reason, order_item_id, created_by, location_id)
      values (it.catalog_item_id, -v_net, 'production undone', it.id, auth.uid(), v_loc);
      perform ordering.sync_loc_qty(v_loc, it.catalog_item_id);
    end if;
  end if;

  if it.dispatch_status = 'procuring' then
    -- pull the still-pending buy-list entry back so it doesn't go orphan
    delete from ordering.procurement_tasks
     where source_order_item_id = it.id and status = 'pending';
  end if;

  update ordering.order_items
     set dispatch_status = 'pending', status = 'pending',
         fulfilled_qty = null, unavail_reason = null
   where id = it.id;

  return jsonb_build_object('reset', true);
end $$;

-- ---- atomic dispatch (single or bulk): all-or-nothing ----
create or replace function ordering.dispatch_items(p_item_ids uuid[])
returns jsonb
language plpgsql security definer set search_path to 'ordering','public'
as $$
declare
  it record; r record; v_central uuid; v_need numeric; v_avail numeric;
  v_take numeric; v_total numeric; v_count int := 0;
begin
  if not (ordering.is_staff() or ordering.my_role() = 'driver') then
    raise exception 'Only staff or the driver can dispatch';
  end if;
  select id into v_central from ordering.locations where is_central and is_active limit 1;

  for it in
    select * from ordering.order_items
     where id = any(p_item_ids)
     order by id                     -- stable lock order avoids deadlocks
       for update
  loop
    if it.dispatch_status not in ('ready','short') then
      raise exception '"%": not ready to dispatch (now %) — nothing was dispatched',
        it.item_name_snapshot, it.dispatch_status;
    end if;

    if it.catalog_item_id is not null and it.fulfillment_type = 'make' and v_central is not null then
      v_total := coalesce(it.fulfilled_qty, it.quantity);
      if v_total > 0 then
        -- this line's own reservation folds back into "available"
        delete from ordering.stock_reservations where order_item_id = it.id;

        -- lock every batch of the product, then check availability
        perform 1 from ordering.stock_batches
          where location_id = v_central and catalog_item_id = it.catalog_item_id and qty > 0
          for update;
        v_avail := ordering.available_stock(v_central, it.catalog_item_id, null);
        if v_avail < v_total then
          raise exception
            'Not enough stock to dispatch "%": available %, need %. Nothing was dispatched.',
            it.item_name_snapshot, v_avail, v_total;
        end if;

        -- FIFO consume
        v_need := v_total;
        for r in select id, qty from ordering.stock_batches
                  where location_id = v_central and catalog_item_id = it.catalog_item_id and qty > 0
                  order by expires_on nulls last, produced_on, created_at
        loop
          exit when v_need <= 0;
          v_take := least(r.qty, v_need);
          update ordering.stock_batches set qty = qty - v_take where id = r.id;
          v_need := v_need - v_take;
        end loop;
        delete from ordering.stock_batches
          where location_id = v_central and catalog_item_id = it.catalog_item_id and qty <= 0;

        insert into ordering.stock_moves (catalog_item_id, delta, reason, order_item_id, created_by, location_id)
        values (it.catalog_item_id, -v_total, 'dispatched', it.id, auth.uid(), v_central);
        perform ordering.sync_loc_qty(v_central, it.catalog_item_id);
      end if;
    else
      delete from ordering.stock_reservations where order_item_id = it.id;  -- safety
    end if;

    update ordering.order_items
       set dispatch_status = 'dispatched', status = 'done'
     where id = it.id;
    v_count := v_count + 1;
  end loop;

  if v_count < coalesce(array_length(p_item_ids, 1), 0) then
    raise exception 'Some lines no longer exist — reload and retry. Nothing was dispatched.';
  end if;

  return jsonb_build_object('dispatched', v_count);
end $$;

grant execute on function
  ordering.available_stock(uuid, uuid, uuid),
  ordering.kitchen_set_produced(jsonb),
  ordering.kitchen_use_stock(uuid),
  ordering.kitchen_reset_item(uuid),
  ordering.dispatch_items(uuid[])
to authenticated;
