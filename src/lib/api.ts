import { supabase } from './supabase'
import type { Database, Json } from './database.types'
import { DEFAULT_CUTOFF } from './dates'
import type { Recipe, RecipeCategory } from './recipes'
import type {
  BuyTask, CatalogItem, Category, CutoffConfig, Location, OrderStatus, OrderType, OrderWithLines, Supplier,
} from './types'

// ---------------------------------------------------------------------------
// Every read and write the app does lives here. Pages never call supabase
// directly, so there is one place to see what hits the database.
// ---------------------------------------------------------------------------

type Fns = Database['ordering']['Functions']

export class ApiError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

function fail(error: { message: string; code?: string } | null): never | void {
  if (error) throw new ApiError(error.message, error.code)
}

async function rpc<K extends keyof Fns>(fn: K, args?: Fns[K]['Args']): Promise<Fns[K]['Returns']> {
  // supabase-js' rpc generics are strict about `never` args; the wrapper keeps call sites clean
  const { data, error } = await (supabase.rpc as unknown as (f: string, a?: unknown) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>)(fn as string, args)
  fail(error)
  return data as Fns[K]['Returns']
}

// ---- reference data ---------------------------------------------------------

export async function listLocations(opts: { includeInactive?: boolean } = {}): Promise<Location[]> {
  let q = supabase.from('locations').select('*').order('is_central', { ascending: false }).order('name_en')
  if (!opts.includeInactive) q = q.eq('is_active', true)
  const { data, error } = await q
  fail(error)
  return data ?? []
}

export async function listCategories(opts: { includeInactive?: boolean } = {}): Promise<Category[]> {
  let q = supabase.from('categories').select('*').order('sort_order').order('name_en')
  if (!opts.includeInactive) q = q.eq('is_active', true)
  const { data, error } = await q
  fail(error)
  return data ?? []
}

export async function listCatalog(opts: { includeInactive?: boolean } = {}): Promise<CatalogItem[]> {
  let q = supabase.from('catalog_items').select('*').order('name_en')
  if (!opts.includeInactive) q = q.eq('is_active', true)
  const { data, error } = await q
  fail(error)
  return data ?? []
}

export async function listSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabase.from('suppliers').select('*').order('name')
  fail(error)
  return data ?? []
}

export async function getCutoff(): Promise<CutoffConfig> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'order_cutoff').maybeSingle()
  fail(error)
  return { ...DEFAULT_CUTOFF, ...((data?.value as Partial<CutoffConfig> | null) ?? {}) }
}

export async function saveCutoff(cfg: CutoffConfig) {
  const { error } = await supabase.from('app_settings')
    .upsert({ key: 'order_cutoff', value: cfg as unknown as Json, updated_at: new Date().toISOString() })
  fail(error)
}

// ---- favorites & templates --------------------------------------------------

export async function listFavorites(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from('user_favorites').select('catalog_item_id').eq('user_id', userId)
  fail(error)
  return (data ?? []).map(r => r.catalog_item_id)
}

export async function setFavorite(userId: string, itemId: string, on: boolean) {
  const { error } = on
    ? await supabase.from('user_favorites').insert({ user_id: userId, catalog_item_id: itemId })
    : await supabase.from('user_favorites').delete().eq('user_id', userId).eq('catalog_item_id', itemId)
  if (error && error.code !== '23505') fail(error)
}

export interface Template { id: string; name: string; items: { catalog_item_id: string | null; default_qty: number }[] }

export async function listTemplates(locationId: string): Promise<Template[]> {
  const { data, error } = await supabase.from('order_templates')
    .select('id, name, items:order_template_items(catalog_item_id, default_qty)')
    .eq('location_id', locationId).eq('is_active', true).order('created_at')
  fail(error)
  return (data ?? []) as Template[]
}

export async function saveTemplate(locationId: string, name: string, lines: { item: CatalogItem; qty: number }[]) {
  const { data: t, error } = await supabase.from('order_templates')
    .insert({ location_id: locationId, name, order_type: 'weekly' }).select('id').single()
  fail(error)
  const rows = lines.map(l => ({
    template_id: t!.id, catalog_item_id: l.item.id, item_name_snapshot: l.item.name_en,
    unit_snapshot: l.item.order_unit, default_qty: l.qty,
  }))
  if (rows.length) {
    const { error: e2 } = await supabase.from('order_template_items').insert(rows)
    fail(e2)
  }
}

export async function deleteTemplate(id: string) {
  const { error } = await supabase.from('order_templates').update({ is_active: false }).eq('id', id)
  fail(error)
}

// ---- orders -----------------------------------------------------------------

const ORDER_SELECT = `id, location_id, order_type, status, created_at, submitted_at, completed_at, parent_order_id,
  production_week, event_name, event_date, note,
  location:locations(name_en),
  items:order_items(id, order_id, catalog_item_id, item_name_snapshot, unit_snapshot, quantity, fulfillment_type,
                    dispatch_status, fulfilled_qty, unavail_reason, dispatched_at)`

interface OrderQuery {
  statuses?: OrderStatus[]
  excludeTypes?: OrderType[]
  locationId?: string | null
  from?: string | null
  to?: string | null
  orderBy?: 'created_at' | 'completed_at'
  ascending?: boolean
  limit?: number
}

export async function listOrders(opts: OrderQuery = {}): Promise<OrderWithLines[]> {
  let q = supabase.from('orders').select(ORDER_SELECT)
  if (opts.statuses) q = q.in('status', opts.statuses)
  if (opts.excludeTypes?.length) q = q.not('order_type', 'in', `(${opts.excludeTypes.join(',')})`)
  if (opts.locationId) q = q.eq('location_id', opts.locationId)
  if (opts.from) q = q.gte('created_at', opts.from)
  if (opts.to) q = q.lt('created_at', opts.to)
  q = q.order(opts.orderBy ?? 'created_at', { ascending: opts.ascending ?? false })
  q = q.limit(opts.limit ?? 300)
  const { data, error } = await q
  fail(error)
  const rows = (data ?? []) as unknown as OrderWithLines[]
  for (const o of rows) o.items.sort((a, b) => a.item_name_snapshot.localeCompare(b.item_name_snapshot))
  return rows
}

export async function lastOrderLines(locationId: string) {
  const { data, error } = await supabase.from('orders')
    .select('id, created_at, items:order_items(catalog_item_id, quantity)')
    .eq('location_id', locationId).neq('status', 'cancelled').neq('order_type', 'procurement')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  fail(error)
  return data
}

export interface SubmitOrderInput {
  locationId: string
  orderType: OrderType
  lines: { id: string; qty: number }[]
  adhoc: { name: string; qty: number; unit?: string | null }[]
  parentOrderId?: string | null
  productionWeek?: string | null
  eventName?: string | null
  eventDate?: string | null
}

export async function submitOrder(i: SubmitOrderInput): Promise<{ orderId: string; count: number; merged: boolean }> {
  const res = await rpc('submit_order', {
    p_location: i.locationId,
    p_type: i.orderType,
    p_lines: i.lines as unknown as Json,
    p_adhoc: i.adhoc.filter(a => a.name.trim()).map(a => ({ name: a.name.trim(), qty: a.qty, unit: a.unit || null })) as unknown as Json,
    p_parent: i.parentOrderId ?? undefined,
    p_production_week: i.productionWeek ?? undefined,
    p_event_name: i.eventName ?? undefined,
    p_event_date: i.eventDate ?? undefined,
  })
  return res as unknown as { orderId: string; count: number; merged: boolean }
}

export type OrderAction = 'complete' | 'reopen' | 'cancel' | 'restore' | 'archive' | 'start'
export const setOrdersStatus = (ids: string[], action: OrderAction) =>
  rpc('set_orders_status', { p_ids: ids, p_action: action })

// ---- kitchen ----------------------------------------------------------------

export const kitchenProduce = (rows: { id: string; fulfilled: number }[]) =>
  rpc('kitchen_set_produced', { p_rows: rows as unknown as Json })
export const kitchenUseStock = (itemId: string) => rpc('kitchen_use_stock', { p_item: itemId })
export const kitchenReset = (itemId: string) => rpc('kitchen_reset_item', { p_item: itemId })
export const markUnavailable = (itemId: string, reason: string) => rpc('mark_item_unavailable', { p_item: itemId, p_reason: reason })
export const markBought = (itemId: string) => rpc('mark_item_bought', { p_item: itemId })
export const sendToBuyer = (itemId: string, note?: string) => rpc('send_item_to_buyer', { p_item: itemId, p_note: note })
export const updateLineQty = (itemId: string, qty: number) => rpc('update_order_line', { p_item: itemId, p_qty: qty })
export const deleteLine = (itemId: string) => rpc('delete_order_line', { p_item: itemId })

/** Central-kitchen stock that is free to promise (physical minus reservations). */
export async function centralAvailable(): Promise<Record<string, number>> {
  const { data: central, error } = await supabase.from('locations').select('id')
    .eq('is_central', true).eq('is_active', true).order('created_at').limit(1).maybeSingle()
  fail(error)
  if (!central) return {}
  const [stock, resv] = await Promise.all([
    supabase.from('location_stock').select('catalog_item_id, qty').eq('location_id', central.id).gt('qty', 0),
    supabase.from('stock_reservations').select('catalog_item_id, qty').eq('location_id', central.id),
  ])
  fail(stock.error); fail(resv.error)
  const out: Record<string, number> = {}
  for (const r of stock.data ?? []) out[r.catalog_item_id] = Number(r.qty)
  for (const r of resv.data ?? []) out[r.catalog_item_id] = (out[r.catalog_item_id] ?? 0) - Number(r.qty)
  for (const k of Object.keys(out)) if (out[k] <= 0) delete out[k]
  return out
}

// ---- dispatch & receiving ----------------------------------------------------

export const dispatchItems = (ids: string[]) => rpc('dispatch_items', { p_item_ids: ids })
export const receiveItems = (ids: string[]) => rpc('receive_items', { p_item_ids: ids })

export interface IncomingLine {
  id: string; catalog_item_id: string | null; item_name_snapshot: string; unit_snapshot: string | null
  quantity: number; fulfilled_qty: number | null; fulfillment_type: 'make' | 'purchase' | null; dispatched_at: string | null
  order: { location_id: string; created_at: string; order_type: OrderType }
}

export async function listIncoming(locationId: string): Promise<IncomingLine[]> {
  const { data, error } = await supabase.from('order_items')
    .select('id, catalog_item_id, item_name_snapshot, unit_snapshot, quantity, fulfilled_qty, fulfillment_type, dispatched_at, order:orders!inner(location_id, created_at, order_type)')
    .eq('dispatch_status', 'dispatched').eq('order.location_id', locationId)
    .order('dispatched_at', { ascending: false }).limit(300)
  fail(error)
  return (data ?? []) as unknown as IncomingLine[]
}

export interface PendingReturn {
  id: string; catalog_item_id: string; qty: number; expires_on: string | null; created_at: string
  from: { name_en: string } | null; item: { name_en: string; stock_unit: string | null } | null
}

export async function listPendingReturns(toLocation: string): Promise<PendingReturn[]> {
  const { data, error } = await supabase.from('stock_returns')
    .select('id, catalog_item_id, qty, expires_on, created_at, from:locations!stock_returns_from_location_fkey(name_en), item:catalog_items(name_en, stock_unit)')
    .eq('status', 'pending').eq('to_location', toLocation).order('created_at')
  fail(error)
  return (data ?? []) as unknown as PendingReturn[]
}

export const receiveReturn = (id: string) => rpc('receive_return', { p_return: id })

// ---- buy list ------------------------------------------------------------------

const TASK_SELECT = `id, item_name, quantity, unit, status, note, unavail_reason, target_location_id,
  catalog_item_id, source_order_item_id, created_by, created_at, bought_at, target:locations(name_en)`

export async function listBuyTasks(opts: { status: 'pending' | 'done'; locationId?: string | null; limit?: number }): Promise<BuyTask[]> {
  let q = supabase.from('procurement_tasks').select(TASK_SELECT)
  q = opts.status === 'pending' ? q.eq('status', 'pending') : q.neq('status', 'pending')
  if (opts.locationId) q = q.eq('target_location_id', opts.locationId)
  q = q.order(opts.status === 'pending' ? 'created_at' : 'bought_at', { ascending: false, nullsFirst: false }).limit(opts.limit ?? 200)
  const { data, error } = await q
  fail(error)
  return (data ?? []) as unknown as BuyTask[]
}

export async function addBuyTask(t: { item_name: string; catalog_item_id: string | null; quantity: number; unit: string | null; note: string | null; target_location_id: string | null }) {
  // created_by is stamped by a DB trigger from auth.uid(); RLS still wants it present
  const { data: u } = await supabase.auth.getUser()
  const { error } = await supabase.from('procurement_tasks').insert({ ...t, created_by: u.user?.id ?? null })
  fail(error)
}

export const setTaskStatus = (id: string, to: 'bought' | 'unavailable' | 'pending', reason?: string) =>
  rpc('set_procurement_task_status', { p_task: id, p_to: to, p_reason: reason })
export const deleteTask = (id: string) => rpc('delete_procurement_task', { p_task: id })

// ---- inventory -------------------------------------------------------------------

export interface StockRow {
  catalog_item_id: string; qty: number; storage_location: string | null
  batches: { id: string; qty: number; produced_on: string; expires_on: string | null }[]
}

export async function listStock(locationId: string): Promise<StockRow[]> {
  const [ls, batches] = await Promise.all([
    supabase.from('location_stock').select('catalog_item_id, qty, storage_location').eq('location_id', locationId),
    supabase.from('stock_batches').select('id, catalog_item_id, qty, produced_on, expires_on')
      .eq('location_id', locationId).gt('qty', 0).order('expires_on', { ascending: true, nullsFirst: false }),
  ])
  fail(ls.error); fail(batches.error)
  const by: Record<string, StockRow['batches']> = {}
  for (const b of batches.data ?? []) (by[b.catalog_item_id] ||= []).push({ id: b.id, qty: Number(b.qty), produced_on: b.produced_on, expires_on: b.expires_on })
  return (ls.data ?? []).map(r => ({ catalog_item_id: r.catalog_item_id, qty: Number(r.qty), storage_location: r.storage_location, batches: by[r.catalog_item_id] ?? [] }))
}

export async function listAllStock() {
  const { data, error } = await supabase.from('location_stock').select('location_id, catalog_item_id, qty')
  fail(error)
  return (data ?? []).map(r => ({ ...r, qty: Number(r.qty) }))
}

export async function listExpiringBatches() {
  const { data, error } = await supabase.from('stock_batches')
    .select('id, qty, expires_on, location_id, item:catalog_items(name_en), loc:locations(name_en)')
    .gt('qty', 0).not('expires_on', 'is', null).order('expires_on').limit(500)
  fail(error)
  return (data ?? []) as unknown as { id: string; qty: number; expires_on: string; location_id: string; item: { name_en: string } | null; loc: { name_en: string } | null }[]
}

export const stocktake = (loc: string, item: string, target: number) =>
  rpc('set_total_fifo', { p_loc: loc, p_item: item, p_target: target, p_note: 'stocktake' })
export const addBatch = (loc: string, item: string, qty: number, produced: string, expires?: string | null, note?: string) =>
  rpc('add_batch', { p_loc: loc, p_item: item, p_qty: qty, p_produced: produced, p_expires: expires ?? undefined, p_note: note })
export const scrapBatch = (batch: string, note = 'expired/scrapped') => rpc('scrap_batch', { p_batch: batch, p_note: note })
export const editBatch = (batch: string, qty: number) => rpc('edit_batch', { p_batch: batch, p_qty: qty, p_note: 'batch correction' })
export const sendBack = (from: string, item: string, qty: number, note?: string) =>
  rpc('send_back', { p_from: from, p_item: item, p_qty: qty, p_note: note })
export const addToStockList = (loc: string, item: string) => rpc('add_loc_item', { p_loc: loc, p_item: item })

export async function removeFromStockList(loc: string, item: string) {
  const { error } = await supabase.from('location_stock').delete().eq('location_id', loc).eq('catalog_item_id', item)
  fail(error)
}

// ---- labels / trace ------------------------------------------------------------------

export async function listBatchesForLabels(locationId: string) {
  const { data, error } = await supabase.from('stock_batches')
    .select('id, produced_on, expires_on, qty, item:catalog_items(name_en, name_hu)')
    .eq('location_id', locationId).gt('qty', 0).order('produced_on', { ascending: false }).limit(300)
  fail(error)
  return (data ?? []) as unknown as { id: string; produced_on: string; expires_on: string | null; qty: number; item: { name_en: string; name_hu: string | null } | null }[]
}

export async function traceBatch(id: string) {
  const data = await rpc('trace_batch', { p_batch: id })
  return data?.[0] ?? null
}

// ---- history & reports -------------------------------------------------------------------

export async function listDispatched(opts: { from: string; to: string; locationId?: string | null }) {
  let q = supabase.from('order_items')
    .select('id, item_name_snapshot, quantity, fulfilled_qty, unit_snapshot, fulfillment_type, dispatched_at, dispatch_status, order:orders!inner(location_id, location:locations(name_en))')
    .in('dispatch_status', ['dispatched', 'received'])
    .gte('dispatched_at', opts.from).lt('dispatched_at', opts.to)
    .order('dispatched_at', { ascending: false }).limit(1000)
  if (opts.locationId) q = q.eq('order.location_id', opts.locationId)
  const { data, error } = await q
  fail(error)
  return (data ?? []) as unknown as { id: string; item_name_snapshot: string; quantity: number; fulfilled_qty: number | null; unit_snapshot: string | null; fulfillment_type: string | null; dispatched_at: string; dispatch_status: string; order: { location_id: string; location: { name_en: string } | null } }[]
}

export async function listTasksInRange(opts: { from: string; to: string; locationId?: string | null }) {
  let q = supabase.from('procurement_tasks').select(TASK_SELECT)
    .gte('created_at', opts.from).lt('created_at', opts.to).order('created_at', { ascending: false }).limit(1000)
  if (opts.locationId) q = q.eq('target_location_id', opts.locationId)
  const { data, error } = await q
  fail(error)
  return (data ?? []) as unknown as BuyTask[]
}

export async function listBoughtSince(since: string | null) {
  let q = supabase.from('procurement_tasks')
    .select('id, catalog_item_id, item_name, quantity, target_location_id, bought_at').eq('status', 'bought')
  if (since) q = q.gte('bought_at', since)
  const { data, error } = await q.limit(2000)
  fail(error)
  return data ?? []
}

/** Latest unit price per catalog item (price / pack_qty), with supplier. */
export async function latestUnitPrices(): Promise<Record<string, { unit: number; supplierId: string | null }>> {
  const { data, error } = await supabase.from('item_prices')
    .select('catalog_item_id, price, pack_qty, supplier_id, effective_date, created_at')
    .order('effective_date', { ascending: false }).order('created_at', { ascending: false })
  fail(error)
  const out: Record<string, { unit: number; supplierId: string | null }> = {}
  for (const p of data ?? []) {
    if (out[p.catalog_item_id]) continue
    out[p.catalog_item_id] = { unit: Number(p.price) / (Number(p.pack_qty) || 1), supplierId: p.supplier_id }
  }
  return out
}

export async function listStockMoves(since: string | null) {
  let q = supabase.from('stock_moves').select('id, catalog_item_id, delta, reason, note, location_id, created_at')
    .order('created_at', { ascending: false }).limit(1000)
  if (since) q = q.gte('created_at', since)
  const { data, error } = await q
  fail(error)
  return (data ?? []).map(m => ({ ...m, delta: Number(m.delta) }))
}

export async function listBuyPending() {
  const { data, error } = await supabase.from('procurement_tasks').select('id').eq('status', 'pending')
  fail(error)
  return data ?? []
}

// ---- admin: catalog, suppliers, locations, prices -------------------------------------------

type TUpdate<T extends keyof Database['ordering']['Tables']> = Database['ordering']['Tables'][T]['Update']
type TInsert<T extends keyof Database['ordering']['Tables']> = Database['ordering']['Tables'][T]['Insert']

export async function updateCatalogItem(id: string, patch: TUpdate<'catalog_items'>) {
  const { error } = await supabase.from('catalog_items').update(patch).eq('id', id)
  fail(error)
}
export async function createCatalogItem(row: TInsert<'catalog_items'>) {
  const { data, error } = await supabase.from('catalog_items').insert(row).select('id').single()
  fail(error)
  return data!.id
}
export async function updateCategory(id: string, patch: TUpdate<'categories'>) {
  const { error } = await supabase.from('categories').update(patch).eq('id', id)
  fail(error)
}
export async function createCategory(row: TInsert<'categories'>) {
  const { error } = await supabase.from('categories').insert(row)
  fail(error)
}
export async function updateSupplier(id: string, patch: TUpdate<'suppliers'>) {
  const { error } = await supabase.from('suppliers').update(patch).eq('id', id)
  fail(error)
}
export async function createSupplier(row: TInsert<'suppliers'>) {
  const { error } = await supabase.from('suppliers').insert(row)
  fail(error)
}
export async function updateLocation(id: string, patch: TUpdate<'locations'>) {
  const { error } = await supabase.from('locations').update(patch).eq('id', id)
  fail(error)
}
export async function createLocation(row: TInsert<'locations'>) {
  const { error } = await supabase.from('locations').insert(row)
  fail(error)
}

export async function listPrices(itemId: string) {
  const { data, error } = await supabase.from('item_prices')
    .select('id, price, currency, pack_qty, pack_unit, effective_date, supplier_id, supplier:suppliers(name)')
    .eq('catalog_item_id', itemId).order('effective_date', { ascending: false }).order('created_at', { ascending: false })
  fail(error)
  return (data ?? []) as unknown as { id: string; price: number; currency: string; pack_qty: number | null; pack_unit: string | null; effective_date: string; supplier_id: string | null; supplier: { name: string } | null }[]
}
export async function addPrice(row: TInsert<'item_prices'>) {
  const { error } = await supabase.from('item_prices').insert(row)
  fail(error)
}
export async function deletePrice(id: string) {
  const { error } = await supabase.from('item_prices').delete().eq('id', id)
  fail(error)
}

// ---- admin: users & audit -------------------------------------------------------------------

export async function listProfiles() {
  const { data, error } = await supabase.from('profiles')
    .select('user_id, full_name, role, location_id, is_active, created_at').order('full_name')
  fail(error)
  return data ?? []
}

export async function updateProfile(userId: string, patch: TUpdate<'profiles'>) {
  const { error } = await supabase.from('profiles').update(patch).eq('user_id', userId)
  fail(error)
}

/** Calls the admin-create-user Edge Function (create | set_password | set_active | delete). */
export async function adminUserAction(body: Record<string, unknown>) {
  const { data: s } = await supabase.auth.getSession()
  const token = s.session?.access_token
  const { data, error } = await supabase.functions.invoke('admin-create-user', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body,
  })
  const msg = (data as { error?: string } | null)?.error
  if (error || msg) throw new ApiError(msg || error?.message || 'Request failed')
  return data as { ok: true; user_id?: string }
}

export async function listAudit(since: string | null) {
  let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(1000)
  if (since) q = q.gte('created_at', since)
  const { data, error } = await q
  fail(error)
  return data ?? []
}

/** Fire-and-forget audit entry; never blocks or breaks the action it describes. */
export function logAudit(action: string, target?: string | null, detail?: Record<string, unknown> | null) {
  rpc('log_audit', { p_action: action, p_target: target ?? undefined, p_detail: (detail ?? undefined) as Json | undefined })
    .catch(e => console.warn('audit log failed:', e))
}

// ---- recipes ---------------------------------------------------------------------------------


const RECIPE_LIST = 'id, hu_name, en_name, category, section, serves, prep_time, cook_time, pack_spec, shelf_life, vacuum_level, status, allergens, author_id, author_name, cover_image, created_at, updated_at, ingredients'

export async function listRecipes(): Promise<Recipe[]> {
  const { data, error } = await supabase.from('recipes').select(RECIPE_LIST).order('created_at', { ascending: false })
  fail(error)
  return (data ?? []) as unknown as Recipe[]
}

export async function getRecipe(id: string): Promise<Recipe | null> {
  const { data, error } = await supabase.from('recipes').select('*').eq('id', id).maybeSingle()
  fail(error)
  return (data as unknown as Recipe | null) ?? null
}

export type RecipeInput = Omit<Recipe, 'id' | 'author_id' | 'author_name' | 'created_at' | 'updated_at'> & { id?: string }

export async function saveRecipe(r: RecipeInput, action?: string): Promise<{ id: string; created: boolean }> {
  const res = await rpc('save_recipe', { p: r as unknown as Json, p_action: action })
  return res as unknown as { id: string; created: boolean }
}

export const deleteRecipe = (id: string) => rpc('delete_recipe', { p_id: id })
export const restoreRecipeVersion = (versionId: number) => rpc('restore_recipe_version', { p_version: versionId })

export async function listRecipeVersions(recipeId: string) {
  const { data, error } = await supabase.from('recipe_versions')
    .select('id, recipe_id, snapshot, edited_by_name, created_at')
    .eq('recipe_id', recipeId).order('created_at', { ascending: false }).limit(50)
  fail(error)
  return (data ?? []) as unknown as { id: number; recipe_id: string; snapshot: Recipe & { deleted?: boolean }; edited_by_name: string | null; created_at: string }[]
}

export async function listRecipeCategories(): Promise<RecipeCategory[]> {
  const { data, error } = await supabase.from('recipe_categories').select('id, name_en, name_hu, color, sort_order').order('sort_order').order('id')
  fail(error)
  return (data ?? []) as RecipeCategory[]
}

export async function saveRecipeCategories(rows: RecipeCategory[], removedIds: number[]) {
  if (rows.length) {
    const { error } = await supabase.from('recipe_categories').upsert(rows, { onConflict: 'id' })
    fail(error)
  }
  if (removedIds.length) {
    const { error } = await supabase.from('recipe_categories').delete().in('id', removedIds)
    fail(error)
  }
}

export async function listRecipeFavorites(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from('recipe_favorites').select('recipe_id').eq('user_id', userId)
  fail(error)
  return (data ?? []).map(r => r.recipe_id)
}

export async function setRecipeFavorite(userId: string, recipeId: string, on: boolean) {
  const { error } = on
    ? await supabase.from('recipe_favorites').insert({ user_id: userId, recipe_id: recipeId })
    : await supabase.from('recipe_favorites').delete().eq('user_id', userId).eq('recipe_id', recipeId)
  if (error && error.code !== '23505') fail(error)
}

/** Catalog items (order products) that point at a recipe. */
export async function productsForRecipe(recipeId: string) {
  const { data, error } = await supabase.from('catalog_items')
    .select('id, name_en, name_hu, order_unit, stock_unit, default_fulfillment, is_active').eq('recipe_ref', recipeId)
  fail(error)
  return data ?? []
}

export const linkRecipe = (itemId: string, recipeId: string | null) => rpc('link_recipe', { p_item: itemId, p_recipe: recipeId ?? '' })

/** Downscale to ≤1200 px JPEG and upload to the recipe-images bucket; returns the public URL. */
export async function uploadRecipeImage(file: File, folder: 'covers' | 'ings' | 'steps'): Promise<string> {
  const blob = await compressImage(file)
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const { error } = await supabase.storage.from('recipe-images').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  fail(error as { message: string } | null)
  return supabase.storage.from('recipe-images').getPublicUrl(path).data.publicUrl
}

function compressImage(file: File, maxDim = 1200, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale)
      c.height = Math.round(img.height * scale)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      c.toBlob(b => (b ? resolve(b) : reject(new Error('Image compression failed'))), 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Not a readable image')) }
    img.src = url
  })
}
