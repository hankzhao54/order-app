import { supabase } from './supabase'

// Catalog + categories + this location's favorites, in one place.
export async function loadCatalog(locationId) {
  const [{ data: cats }, { data: items }] = await Promise.all([
    supabase.from('categories').select('id,name_en,name_hu,sort_order').eq('is_active', true).order('sort_order'),
    supabase.from('catalog_items').select('id,name_en,name_hu,order_unit,stock_unit,category_id,default_fulfillment').eq('is_active', true).order('name_en')
  ])
  let favs = []
  const { data: u } = await supabase.auth.getUser()
  if (u?.user) {
    const { data } = await supabase.from('user_favorites')
      .select('catalog_item_id').eq('user_id', u.user.id)
    favs = data || []
  }
  return { cats: cats || [], items: items || [], favs }
}

export async function addFavorite(catalogItemId) {
  const { data: u } = await supabase.auth.getUser()
  if (!u?.user) return null
  const { data } = await supabase.from('user_favorites')
    .insert({ user_id: u.user.id, catalog_item_id: catalogItemId })
    .select('catalog_item_id').single()
  return data
}
export async function removeFavorite(catalogItemId) {
  const { data: u } = await supabase.auth.getUser()
  if (!u?.user) return
  await supabase.from('user_favorites').delete()
    .eq('user_id', u.user.id).eq('catalog_item_id', catalogItemId)
}

async function findMergeTarget(locationId, productionWeek) {
  // an existing weekly order for same location + production week that hasn't been started
  const { data: candidates } = await supabase.from('orders')
    .select('id, status, items:order_items(id, catalog_item_id, quantity, dispatch_status)')
    .eq('location_id', locationId).eq('order_type', 'weekly').eq('production_week', productionWeek)
    .not('status', 'in', '(completed,cancelled)')
    .order('created_at', { ascending: true })
  for (const o of candidates || []) {
    if (o.items.length > 0 && o.items.every(i => i.dispatch_status === 'pending')) return o
  }
  return null
}

export async function submitOrder({ locationId, orderType, lines, adhoc, parentOrderId, productionWeek }) {
  const finalType = parentOrderId ? 'urgent' : orderType

  // weekly orders (not top-ups) merge into an existing untouched order for the same production week
  if (finalType === 'weekly' && productionWeek && !parentOrderId) {
    const target = await findMergeTarget(locationId, productionWeek)
    if (target) {
      const existing = {}
      for (const it of target.items) if (it.catalog_item_id) existing[it.catalog_item_id] = it
      let added = 0
      for (const l of lines) {
        if (existing[l.id]) {
          await supabase.from('order_items').update({ quantity: Number(existing[l.id].quantity) + Number(l.qty) }).eq('id', existing[l.id].id)
        } else {
          await supabase.from('order_items').insert({ order_id: target.id, catalog_item_id: l.id, item_name_snapshot: l.name_en, unit_snapshot: l.order_unit, quantity: l.qty })
        }
        added++
      }
      for (const a of adhoc) if (a.name) {
        await supabase.from('order_items').insert({ order_id: target.id, catalog_item_id: null, item_name_snapshot: a.name, unit_snapshot: a.unit || null, quantity: Number(a.qty) || 1 })
        added++
      }
      await supabase.from('orders').update({ submitted_at: new Date().toISOString() }).eq('id', target.id)
      return { count: added, orderId: target.id, merged: true }
    }
  }

  const { data: order, error } = await supabase.from('orders')
    .insert({
      location_id: locationId,
      order_type: finalType,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      parent_order_id: parentOrderId || null,
      production_week: finalType === 'weekly' ? (productionWeek || null) : null
    })
    .select('id').single()
  if (error) throw error
  const rows = []
  for (const l of lines)
    rows.push({ order_id: order.id, catalog_item_id: l.id, item_name_snapshot: l.name_en, unit_snapshot: l.order_unit, quantity: l.qty })
  for (const a of adhoc)
    if (a.name) rows.push({ order_id: order.id, catalog_item_id: null, item_name_snapshot: a.name, unit_snapshot: a.unit || null, quantity: Number(a.qty) || 1 })
  const { error: e2 } = await supabase.from('order_items').insert(rows)
  if (e2) throw e2
  return { count: rows.length, orderId: order.id, merged: false }
}

// ---- templates (weekly fixed orders) ----
export async function loadTemplates(locationId) {
  const { data } = await supabase.from('order_templates')
    .select('id,name,order_type,items:order_template_items(id,catalog_item_id,item_name_snapshot,unit_snapshot,default_qty)')
    .eq('location_id', locationId).eq('is_active', true).order('created_at')
  return data || []
}
export async function saveTemplate(locationId, name, lines) {
  const { data: t, error } = await supabase.from('order_templates')
    .insert({ location_id: locationId, name, order_type: 'weekly' }).select('id').single()
  if (error) throw error
  const rows = lines.map(l => ({
    template_id: t.id, catalog_item_id: l.id, item_name_snapshot: l.name_en,
    unit_snapshot: l.order_unit, default_qty: l.qty
  }))
  if (rows.length) await supabase.from('order_template_items').insert(rows)
  return t.id
}

// ---- history (this location's past orders) ----
export async function loadHistory(locationId) {
  const { data } = await supabase.from('orders')
    .select('id,order_type,status,created_at,completed_at,parent_order_id,items:order_items(id,item_name_snapshot,quantity,unit_snapshot,fulfillment_type,status)')
    .eq('location_id', locationId).order('created_at', { ascending: false }).limit(50)
  return data || []
}
