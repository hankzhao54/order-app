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

// Order creation, weekly merge and (for procurement orders) buy-list task
// creation all happen inside one database transaction — ordering.submit_order.
// A failure can no longer leave an empty order or half-created buy list, and
// created_by is stamped server-side from auth.uid().
export async function submitOrder({ locationId, orderType, lines, adhoc, parentOrderId, productionWeek, eventName, eventDate }) {
  const { data, error } = await supabase.rpc('submit_order', {
    p_location: locationId,
    p_type: orderType,
    p_lines: lines.map(l => ({ id: l.id, qty: Number(l.qty) })),
    p_adhoc: adhoc.filter(a => a.name).map(a => ({ name: a.name, unit: a.unit || null, qty: Number(a.qty) || 1 })),
    p_parent: parentOrderId || null,
    p_production_week: productionWeek || null,
    p_event_name: eventName || null,
    p_event_date: eventDate || null,
  })
  if (error) throw error
  return { count: data.count, orderId: data.orderId, merged: data.merged }
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
