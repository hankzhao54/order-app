import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChefHat, ChevronDown, ChevronRight, Flag, RotateCcw } from 'lucide-react'
import * as api from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import type { MessageKey } from '@/lib/i18n/en'
import { useLiveQueries } from '@/lib/query'
import { useCatalog } from '@/lib/refdata'
import { QK, useAction } from '@/lib/useAction'
import { thisMonday } from '@/lib/dates'
import { groupOrders, type Bucket } from '@/lib/kitchen'
import { isPending, TYPE_TONE } from '@/lib/status'
import { fmtDateTime, qtyUnit } from '@/lib/format'
import { useFeedback } from '@/ui/feedback'
import { Badge, Button, Card, Empty, PageHeader, Segmented, Skeleton } from '@/ui/primitives'
import type { OrderWithLines } from '@/lib/types'
import { OrderTicket } from './OrderTicket'
import { ByItemView } from './ByItemView'

type View = 'orders' | 'items' | 'completed' | 'cancelled'
const BUCKET_KEY: Record<Bucket, MessageKey> = { 0: 'kitchen.bucketUrgent', 1: 'kitchen.bucketEvent', 2: 'kitchen.bucketThisWeek', 3: 'kitchen.bucketNextWeek' }

export default function KitchenPage() {
  const { t } = useI18n()
  const fb = useFeedback()
  const [view, setView] = useState<View>('orders')
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const openKey = [...QK.orders, 'kitchen', 'open']
  const open = useQuery({
    queryKey: openKey,
    queryFn: () => api.listOrders({ statuses: ['submitted', 'in_progress'], excludeTypes: ['procurement'], ascending: true, limit: 500 }),
  })
  const completed = useQuery({
    queryKey: [...QK.orders, 'kitchen', 'completed'],
    enabled: view === 'completed',
    queryFn: () => api.listOrders({ statuses: ['completed'], excludeTypes: ['procurement'], orderBy: 'completed_at', limit: 60 }),
  })
  const cancelled = useQuery({
    queryKey: [...QK.orders, 'kitchen', 'cancelled'],
    enabled: view === 'cancelled',
    queryFn: () => api.listOrders({ statuses: ['cancelled'], excludeTypes: ['procurement'], limit: 40 }),
  })
  const stock = useQuery({ queryKey: QK.central, queryFn: api.centralAvailable })
  const catalog = useCatalog()
  const recipeFor = useMemo(() => Object.fromEntries((catalog.data ?? []).filter(c => c.recipe_ref).map(c => [c.id, c.recipe_ref!])), [catalog.data])
  useLiveQueries(['orders', 'order_items', 'stock_batches'], [QK.orders, QK.central], editing)
  const { run, isBusy } = useAction([QK.orders, QK.central])

  const monday = thisMonday()
  const orders = open.data ?? []
  const groups = useMemo(() => groupOrders(orders, monday), [orders, monday])
  const pendingLines = orders.reduce((n, o) => n + o.items.filter(i => isPending(i.dispatch_status)).length, 0)

  async function finishAll() {
    const blocked = orders.filter(o => o.items.some(i => isPending(i.dispatch_status)))
    if (blocked.length) {
      fb.toast(t('kitchen.finishBlocked', { n: blocked.length, stores: [...new Set(blocked.map(o => o.location?.name_en))].join(', ') }), 'bad')
      return
    }
    if (!orders.length) { fb.toast(t('kitchen.nothingOpen')); return }
    if (!await fb.confirm({ title: t('kitchen.finishTitle', { n: orders.length }), body: t('kitchen.finishBody') })) return
    await run(() => api.setOrdersStatus(orders.map(o => o.id), 'complete'), { id: 'finish', success: t('kitchen.finished') })
  }

  return (
    <div className="page page-kitchen">
      <PageHeader
        title={t('kitchen.title')}
        subtitle={orders.length ? t('kitchen.summary', { orders: orders.length, lines: pendingLines }) : undefined}
        actions={
          <>
            <Segmented<View> value={view} onChange={setView} options={[
              { value: 'orders', label: t('kitchen.byOrder'), count: orders.length },
              { value: 'items', label: t('kitchen.byItem') },
              { value: 'completed', label: t('kitchen.completed') },
              { value: 'cancelled', label: t('kitchen.cancelled') },
            ]} />
            {view === 'orders' && orders.length > 0 && (
              <Button variant="primary" icon={<Flag size={16} />} loading={isBusy('finish')} onClick={finishAll}>{t('kitchen.finishAll')}</Button>
            )}
          </>
        }
      />

      {view === 'orders' && (open.isPending ? <Skeleton variant="cards" rows={4} /> : !orders.length ? (
        <Empty icon={<ChefHat size={36} />} title={t('kitchen.empty')}>{t('kitchen.emptyHint')}</Empty>
      ) : (
        <div className="tickets">
          {groups.map((g, gi) => {
            const header = gi === 0 || groups[gi - 1].bucket !== g.bucket
            const multi = g.orders.length > 1
            const isOpen = expanded[g.key] ?? !multi
            return (
              <div key={g.key} className="ticket-group-wrap">
                {header && <h2 className={`bucket bucket-${g.bucket}`}>{t(BUCKET_KEY[g.bucket])}</h2>}
                {multi && (
                  <button type="button" className="store-group" aria-expanded={isOpen} onClick={() => setExpanded(e => ({ ...e, [g.key]: !isOpen }))}>
                    {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    <b>{g.location}</b>
                    <Badge>{t('kitchen.nOrders', { n: g.orders.length })}</Badge>
                    {!isOpen && (
                      <span className="tally">
                        {[...g.tally.entries()].map(([name, v]) => <span key={name} className="tally-chip">{name} <b>×{qtyUnit(v.qty)}</b></span>)}
                      </span>
                    )}
                  </button>
                )}
                {isOpen && (
                  <div className={`ticket-grid${multi ? ' grouped' : ''}`}>
                    {g.orders.map(o => (
                      <OrderTicket key={o.id} order={o} stock={stock.data ?? {}} recipeFor={recipeFor} onEditing={setEditing} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}

      {view === 'items' && (open.isPending ? <Skeleton rows={8} /> : <ByItemView orders={orders} onEditing={setEditing} />)}

      {view === 'completed' && (
        <ArchiveList
          loading={completed.isPending}
          orders={completed.data ?? []}
          empty={t('kitchen.noCompleted')}
          when={o => o.completed_at}
          action={o => (
            <Button size="sm" icon={<RotateCcw size={16} />} loading={isBusy(o.id)}
              onClick={() => run(() => api.setOrdersStatus([o.id], 'reopen'), { id: o.id, success: t('kitchen.reopened') })}>
              {t('kitchen.reopen')}
            </Button>
          )}
        />
      )}
      {view === 'cancelled' && (
        <ArchiveList
          loading={cancelled.isPending}
          orders={cancelled.data ?? []}
          empty={t('kitchen.noCancelled')}
          when={o => o.created_at}
          action={o => (
            <Button size="sm" icon={<RotateCcw size={16} />} loading={isBusy(o.id)}
              onClick={() => run(() => api.setOrdersStatus([o.id], 'restore'), { id: o.id, success: t('kitchen.restored') })}>
              {t('kitchen.restore')}
            </Button>
          )}
        />
      )}
    </div>
  )
}

function ArchiveList({ loading, orders, empty, when, action }: {
  loading: boolean; orders: OrderWithLines[]; empty: string; when: (o: OrderWithLines) => string | null; action: (o: OrderWithLines) => React.ReactNode
}) {
  const { t } = useI18n()
  if (loading) return <Skeleton variant="cards" rows={3} />
  if (!orders.length) return <Empty title={empty} />
  return (
    <div className="stack">
      {orders.map(o => (
        <Card key={o.id} className="archive-card">
          <div className="row wrap gap-1">
            <b>{o.location?.name_en}</b>
            <Badge tone={TYPE_TONE[o.order_type]}>{t(`type.${o.order_type}` as MessageKey)}</Badge>
            <span className="muted small">{fmtDateTime(when(o))}</span>
            <span className="grow" />
            {action(o)}
          </div>
          <div className="chips mt-1">
            {o.items.map(i => <span key={i.id} className="tally-chip">{qtyUnit(i.quantity, i.unit_snapshot)} {i.item_name_snapshot}</span>)}
          </div>
        </Card>
      ))}
    </div>
  )
}
