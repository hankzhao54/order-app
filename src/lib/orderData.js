import { supabase } from './supabase'

// Catalog + categories + this location's favorites, in one place.
export async function loadCatalog(locationId) {
  const [{ data: cats }, { data: items }] = await Promise.all([
    supabase.from('categories').select('id,name_en,name_hu,sort_order').eq('is_active', true).order('sort_order'),
    supabase.from('catalog_items').select('id,name_en,name_hu,order_unit,category_id,default_fulfillment').eq('is_active', true).order('name_en')
  ])
  let favs = []
  if (locationId) {
    const { data } = await supabase.from('location_favorites')
      .select('id,catalog_item_id,sort_order').eq('location_id', locationId).order('sort_order')
    favs = data || []
  }
  return { cats: cats || [], items: items || [], favs }
}

export async function addFavorite(locationId, catalogItemId, sortOrder) {
  const { data } = await supabase.from('location_favorites')
    .insert({ location_id: locationId, catalog_item_id: catalogItemId, sort_order: sortOrder })
    .select('id,catalog_item_id,sort_order').single()
  return data
}
export async function removeFavorite(favId) {
  await supabase.from('location_favorites').delete().eq('id', favId)
}

export async function submitOrder({ locationId, orderType, lines, adhoc }) {
  const { data: order, error } = await supabase.from('orders')
    .insert({ location_id: locationId, order_type: orderType, status: 'submitted', submitted_at: new Date().toISOString() })
    .select('id').single()
  if (error) throw error
  const rows = []
  for (const l of lines)
    rows.push({ order_id: order.id, catalog_item_id: l.id, item_name_snapshot: l.name_en, unit_snapshot: l.order_unit, quantity: l.qty })
  for (const a of adhoc)
    if (a.name) rows.push({ order_id: order.id, catalog_item_id: null, item_name_snapshot: a.name, unit_snapshot: a.unit || null, quantity: Number(a.qty) || 1 })
  const { error: e2 } = await supabase.from('order_items').insert(rows)
  if (e2) throw e2
  return rows.length
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
    .select('id,order_type,status,created_at,completed_at,items:order_items(id,item_name_snapshot,quantity,unit_snapshot,fulfillment_type,status)')
    .eq('location_id', locationId).order('created_at', { ascending: false }).limit(50)
  return data || []
}
