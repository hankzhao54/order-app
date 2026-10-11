import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, PlusCircle, XCircle } from 'lucide-react'
import * as api from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import type { MessageKey } from '@/lib/i18n/en'
import { useLiveQueries } from '@/lib/query'
import { QK, useAction } from '@/lib/useAction'
import { canTopUp, LINE_TONE, ORDER_TONE, orderProgress, storeCanCancel, TYPE_TONE } from '@/lib/status'
import { fmtDate, fmtDateTime, qtyUnit } from '@/lib/format'
import { addDays, todayISO, zonedMidnightISO } from '@/lib/dates'
import { useFeedback } from '@/ui/feedback'
import { Badge, Button, Card, Empty, Skeleton } from '@/ui/primitives'
import type { OrderWithLines } from '@/lib/types'
import type { TopUp } from './CartPanel'

export function MyOrders({ locationId, onTopUp }: { locationId: string; onTopUp: (o: TopUp) => void }) {
  const { t } = useI18n()
  const { isStaff } = useAuth()
  const fb = useFeedback()
  const key = [...QK.orders, 'mine', locationId]
  const q = useQuery({
    queryKey: key,
    enabled: !!locationId,
    queryFn: () => api.listOrders({ locationId, from: zonedMidnightISO(addDays(todayISO(), -45)), limit: 60 }),
  })
  useLiveQueries(['orders', 'order_items'], [key])
  const { run, isBusy } = useAction([QK.orders])
  const [open, setOpen] = useState<Record<string, boolean>>({})

  if (q.isPending) return <Skeleton variant="cards" rows={4} />
  const orders = q.data ?? []
  if (!orders.length) return <Empty title={t('mine.empty')}>{t('mine.emptyHint')}</Empty>

  const label = (o: OrderWithLines) => `${t(`type.${o.order_type}` as MessageKey)} · ${fmtDate(o.created_at)}`

  async function cancel(o: OrderWithLines) {
    if (!await fb.confirm({ title: t('mine.cancelTitle'), body: t('mine.cancelBody'), danger: true, confirm: t('mine.cancel') })) return
    await run(() => api.setOrdersStatus([o.id], 'cancel'), { id: o.id, success: t('mine.cancelled') })
  }

  return (
    <div className="stack">
      {orders.map(o => {
        const prog = orderProgress(o.items)
        const isOpen = open[o.id] ?? false
        const cancellable = storeCanCancel(o.status, o.items) || (isStaff && (o.status === 'submitted' || o.status === 'in_progress'))
        return (
          <Card key={o.id} className="order-card">
            <button type="button" className="order-card-head" onClick={() => setOpen(s => ({ ...s, [o.id]: !isOpen }))} aria-expanded={isOpen}>
              {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              <div className="grow">
                <div className="row wrap gap-1">
                  <b>{fmtDate(o.created_at)}</b>
                  <Badge tone={TYPE_TONE[o.order_type]}>{t(`type.${o.order_type}` as MessageKey)}</Badge>
                  {o.parent_order_id && <Badge tone="accent">{t('mine.topUp')}</Badge>}
                  <Badge tone={ORDER_TONE[o.status]}>{t(`ostatus.${o.status}` as MessageKey)}</Badge>
                </div>
                <div className="muted small">
                  {t('mine.lines', { n: o.items.length })}
                  {o.production_week && ` · ${t('mine.week', { week: fmtDate(o.production_week) })}`}
                  {o.event_name && ` · ${o.event_name}`}
                  {prog !== 'empty' && o.status !== 'cancelled' && ` · ${t(`progress.${prog}` as MessageKey)}`}
                </div>
              </div>
            </button>
            {isOpen && (
              <div className="order-card-body">
                <ul className="line-list">
                  {o.items.map(i => (
                    <li key={i.id}>
                      <span className="grow">{i.item_name_snapshot}</span>
                      <span className="mono">
                        {i.dispatch_status === 'short' ? `${qtyUnit(i.fulfilled_qty)} / ${qtyUnit(i.quantity, i.unit_snapshot)}` : qtyUnit(i.quantity, i.unit_snapshot)}
                      </span>
                      <Badge tone={LINE_TONE[i.dispatch_status]}>{t(`lstatus.${i.dispatch_status}` as MessageKey)}</Badge>
                      {i.unavail_reason && <span className="muted small full">{i.unavail_reason}</span>}
                    </li>
                  ))}
                </ul>
                <div className="muted small">{t('mine.submitted', { at: fmtDateTime(o.submitted_at || o.created_at) })}</div>
                <div className="row gap-1 wrap mt-2">
                  {canTopUp(o.status, o.order_type) && (
                    <Button size="sm" icon={<PlusCircle size={16} />} onClick={() => onTopUp({ id: o.id, label: label(o) })}>{t('mine.addTopUp')}</Button>
                  )}
                  {cancellable && (
                    <Button size="sm" variant="ghost" className="text-bad" icon={<XCircle size={16} />} loading={isBusy(o.id)} onClick={() => cancel(o)}>{t('mine.cancel')}</Button>
                  )}
                </div>
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}
