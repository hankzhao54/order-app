-- ============================================================
-- 004 — Database-enforced state machines  (P0-5, parts of P1-8/P1-10)
-- Safe to re-run.
--
-- The frontend's orderLifecycle.js validated transitions against its own
-- cached state, so two clients could overwrite each other and any client
-- could write an illegal jump. These triggers make the DATABASE reject
-- illegal transitions regardless of what the client sends.
--
-- New legal item transitions (needed by the procurement cascade):
--   procuring  -> unavailable   (buyer couldn't get it)
--   unavailable -> procuring    (buy-list entry reopened)
-- ============================================================

-- ---- orders.status ----
create or replace function ordering.validate_order_status()
returns trigger language plpgsql
as $$
begin
  if old.status = new.status then return new; end if;
  if not (case old.status
    when 'draft'       then new.status in ('submitted')
    when 'submitted'   then new.status in ('in_progress','cancelled')
    when 'in_progress' then new.status in ('completed','cancelled','archived')
    when 'completed'   then new.status in ('in_progress','archived')
    when 'cancelled'   then new.status in ('submitted','in_progress')
    else false end)
  then
    raise exception 'Illegal order status transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists validate_status on ordering.orders;
create trigger validate_status before update on ordering.orders
  for each row execute function ordering.validate_order_status();

-- ---- order_items.dispatch_status (+ fulfilled_qty consistency) ----
create or replace function ordering.validate_item_dispatch()
returns trigger language plpgsql
as $$
begin
  if old.dispatch_status is distinct from new.dispatch_status then
    if not (case old.dispatch_status
      when 'pending'     then new.dispatch_status in ('ready','short','unavailable','procuring')
      when 'ready'       then new.dispatch_status in ('pending','dispatched','procuring')
      when 'short'       then new.dispatch_status in ('pending','dispatched')
      when 'unavailable' then new.dispatch_status in ('pending','procuring')
      when 'procuring'   then new.dispatch_status in ('pending','ready','unavailable')
      when 'dispatched'  then new.dispatch_status in ('received')
      else false end)
    then
      raise exception 'Illegal item transition: % -> % (item %)',
        old.dispatch_status, new.dispatch_status, old.item_name_snapshot
        using errcode = 'check_violation';
    end if;

    -- keep the coarse status column in lockstep
    new.status := case when new.dispatch_status = 'pending'
                       then 'pending'::ordering.order_item_status
                       else 'done'::ordering.order_item_status end;

    -- fulfilled_qty consistency per target state
    if new.dispatch_status = 'ready' then
      if new.fulfilled_qty is null or new.fulfilled_qty <> new.quantity then
        raise exception 'ready requires fulfilled_qty = quantity (item %)', old.item_name_snapshot
          using errcode = 'check_violation';
      end if;
    elsif new.dispatch_status = 'short' then
      if new.fulfilled_qty is null or new.fulfilled_qty <= 0 or new.fulfilled_qty >= new.quantity then
        raise exception 'short requires 0 < fulfilled_qty < quantity (item %)', old.item_name_snapshot
          using errcode = 'check_violation';
      end if;
    elsif new.dispatch_status = 'unavailable' then
      new.fulfilled_qty := 0;
    elsif new.dispatch_status in ('pending','procuring') then
      new.fulfilled_qty := null;
      if new.dispatch_status = 'pending' then new.unavail_reason := null; end if;
    end if;
  end if;
  return new;
end $$;

-- BEFORE-triggers fire in name order; "aa_" makes validation/normalization
-- run before the stamp_* triggers so they see the corrected values.
drop trigger if exists validate_dispatch on ordering.order_items;
drop trigger if exists aa_validate_dispatch on ordering.order_items;
create trigger aa_validate_dispatch before update on ordering.order_items
  for each row execute function ordering.validate_item_dispatch();

-- ---- procurement_tasks.status ----
create or replace function ordering.validate_procurement_status()
returns trigger language plpgsql
as $$
begin
  if old.status = new.status then return new; end if;
  if not (case old.status
    when 'pending'     then new.status in ('bought','unavailable')
    when 'bought'      then new.status in ('pending')
    when 'unavailable' then new.status in ('pending')
    else false end)
  then
    raise exception 'Illegal procurement task transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists validate_status on ordering.procurement_tasks;
create trigger validate_status before update on ordering.procurement_tasks
  for each row execute function ordering.validate_procurement_status();
