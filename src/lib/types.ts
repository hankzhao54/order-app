import type { Enums, Tables } from './database.types'

export type Role = Enums<'user_role'>
export type OrderType = Enums<'order_type'>
export type OrderStatus = Enums<'order_status'>
export type DispatchStatus = Enums<'item_dispatch_status'>
export type Fulfillment = Enums<'fulfillment_type'>
export type ProcurementStatus = Enums<'procurement_status'>

export type Location = Tables<'locations'>
export type Category = Tables<'categories'>
export type CatalogItem = Tables<'catalog_items'>
export type Supplier = Tables<'suppliers'>
export type Profile = Tables<'profiles'>
export type StockBatch = Tables<'stock_batches'>

/** An order line as the kitchen / dispatch / history screens load it. */
export type OrderLine = Pick<
  Tables<'order_items'>,
  | 'id' | 'order_id' | 'catalog_item_id' | 'item_name_snapshot' | 'unit_snapshot' | 'quantity'
  | 'fulfillment_type' | 'dispatch_status' | 'fulfilled_qty' | 'unavail_reason' | 'dispatched_at'
>

/** An order with its location name and lines. */
export type OrderWithLines = Pick<
  Tables<'orders'>,
  | 'id' | 'location_id' | 'order_type' | 'status' | 'created_at' | 'submitted_at' | 'completed_at'
  | 'parent_order_id' | 'production_week' | 'event_name' | 'event_date' | 'note'
> & {
  location: { name_en: string } | null
  items: OrderLine[]
}

export type BuyTask = Pick<
  Tables<'procurement_tasks'>,
  | 'id' | 'item_name' | 'quantity' | 'unit' | 'status' | 'note' | 'unavail_reason' | 'target_location_id'
  | 'catalog_item_id' | 'source_order_item_id' | 'created_by' | 'created_at' | 'bought_at'
> & { target: { name_en: string } | null }

export interface CutoffConfig {
  enabled: boolean
  weekday: number // 1 = Monday … 7 = Sunday
  hour: number
  minute: number
  tz: string
}
