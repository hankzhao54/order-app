import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Archive, Check, Printer, Truck, X } from 'lucide-react'
import * as api from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useI18n, type TFn } from '@/lib/i18n'
import type { MessageKey } from '@/lib/i18n/en'
import { useLiveQueries } from '@/lib/query'
import { QK, useAction } from '@/lib/useAction'
import { countLines, isOutTheDoor, isReadyToDispatch, isWeekCloseTerminal, LINE_TONE } from '@/lib/status'
import { fmtDate, num, qtyUnit } from '@/lib/format'
import { useFeedback } from '@/ui/feedback'
import { Badge, Button, Card, Empty, PageHeader, Segmented, Skeleton } from '@/ui/primitives'
import type { OrderLine, OrderWithLines } from '@/lib/types'

interface StoreBucket { locationId: string; name: string; lines: (OrderLine & { orderType: OrderWithLines['order_type'] })[] }

export default function DispatchPage() {
  const { t } = useI18n()
  const { can } = useAuth()
  const fb = useFeedback()
  const [view, setView] = useState<'active' | 'sent'>('active')
  const key = [...QK.orders, 'dispatch']
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.listOrders({ statuses: ['in_progress', 'completed'], excludeTypes: ['procurement'], ascending: true, limit: 500 }),
  })
  useLiveQueries(['orders', 'order_items'], [QK.orders])
  const { run, isBusy } = useAction([QK.orders, QK.central, QK.buy])

  const orders = q.data ?? []
  const stores = useMemo(() => {
    const m = new Map<string, StoreBucket>()
    for (const o of orders) for (const it of o.items) {
      if (!m.has(o.location_id)) m.set(o.location_id, { locationId: o.location_id, name: o.location?.name_en || '—', lines: [] })
      m.get(o.location_id)!.lines.push({ ...it, orderType: o.order_type })
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [orders])
  const unfinished = orders.reduce((n, o) => n + o.items.filter(i => !isWeekCloseTerminal(i.dispatch_status)).length, 0)

  async function closeWeek() {
    if (unfinished > 0) { fb.toast(t('dispatch.closeBlocked', { n: unfinished }), 'bad'); return }
    if (!orders.length) { fb.toast(t('dispatch.nothingToClose')); return }
    if (!await fb.confirm({ title: t('dispatch.closeTitle', { n: orders.length }), body: t('dispatch.closeBody') })) return
    await run(() => api.setOrdersStatus(orders.map(o => o.id), 'archive'), { id: 'close', success: t('dispatch.closed', { n: orders.length }) })
  }
  async function none(line: OrderLine) {
    const reason = await fb.prompt({
      title: t('kitchen.noneTitle', { name: line.item_name_snapshot }),
      choices: [t('reason.outOfStock'), t('reason.notFound')],
      placeholder: t('buy.otherReason'),
      confirm: t('kitchen.markNone'),
    })
    if (reason) await run(() => api.markUnavailable(line.id, reason), { id: line.id })
  }

  return (
    <div className="page">
      <PageHeader
        title={t('dispatch.title')}
        actions={<>
          <Segmented value={view} onChange={setView} options={[{ value: 'active', label: t('dispatch.active') }, { value: 'sent', label: t('dispatch.sent') }]} />
          {can('dispatch.bulk') && (
            <Button icon={<Archive size={16} />} loading={isBusy('close')} onClick={closeWeek} title={unfinished ? t('dispatch.closeBlocked', { n: unfinished }) : undefined}>
              {t('dispatch.closeWeek')}{unfinished > 0 ? ` (${unfinished})` : ''}
            </Button>
          )}
        </>}
      />

      {q.isPending ? <Skeleton variant="cards" rows={3} /> : !stores.length ? (
        <Empty icon={<Truck size={36} />} title={t('dispatch.empty')}>{t('dispatch.emptyHint')}</Empty>
      ) : (
        <div className="stack">
          {stores.map(s => {
            const c = countLines(s.lines)
            const readyIds = s.lines.filter(l => isReadyToDispatch(l.dispatch_status)).map(l => l.id)
            const visible = s.lines
              .filter(l => view === 'sent' ? isOutTheDoor(l.dispatch_status) : !isOutTheDoor(l.dispatch_status))
              .sort((a, b) => rank(a) - rank(b) || a.item_name_snapshot.localeCompare(b.item_name_snapshot))
            if (!visible.length && view === 'sent') return null
            return (
              <Card key={s.locationId} className="store-card">
                <div className="group-head wrap">
                  <b className="store-name">{s.name}</b>
                  <span className="counts">
                    {c.ready + c.short > 0 && <Badge tone="ok">{t('dispatch.nReady', { n: c.ready + c.short })}</Badge>}
                    {c.pending > 0 && <Badge>{t('dispatch.nKitchen', { n: c.pending })}</Badge>}
                    {c.procuring > 0 && <Badge tone="buy">{t('dispatch.nBuyer', { n: c.procuring })}</Badge>}
                    {c.unavailable > 0 && <Badge tone="bad">{t('dispatch.nNone', { n: c.unavailable })}</Badge>}
                    {c.dispatched + c.received > 0 && <Badge tone="info">{t('dispatch.nSent', { n: c.dispatched + c.received })}</Badge>}
                  </span>
                  <span className="grow" />
                  <Button size="sm" variant="ghost" icon={<Printer size={16} />} onClick={() => printSlip(t, s)}>{t('dispatch.slip')}</Button>
                  {view === 'active' && (
                    <Button size="sm" variant="primary" icon={<Truck size={16} />} disabled={!readyIds.length} loading={isBusy(s.locationId)}
                      onClick={() => run(() => api.dispatchItems(readyIds), { id: s.locationId, success: t('dispatch.sentToast', { n: readyIds.length, store: s.name }) })}>
                      {t('dispatch.sendAll', { n: readyIds.length })}
                    </Button>
                  )}
                </div>
                {!visible.length ? <p className="muted small pad">{t('dispatch.allSent')}</p> : visible.map(l => {
                  const isBuy = l.fulfillment_type === 'purchase'
                  const busy = isBusy(l.id)
                  return (
                    <div key={l.id} className={`dline st-${l.dispatch_status}`}>
                      <div className="grow">
                        <div className="dline-name">{l.item_name_snapshot}{isBuy && <span className="muted"> · 🛒</span>}</div>
                        <div className="muted small mono">
                          {l.dispatch_status === 'short' ? `${num(l.fulfilled_qty)} / ${qtyUnit(l.quantity, l.unit_snapshot)}` : qtyUnit(l.quantity, l.unit_snapshot)}
                          {l.unavail_reason && ` · ${l.unavail_reason}`}
                        </div>
                      </div>
                      <div className="row gap-1 wrap end">
                        {isReadyToDispatch(l.dispatch_status) ? (
                          <Button size="sm" variant="primary" icon={<Truck size={16} />} loading={busy} onClick={() => run(() => api.dispatchItems([l.id]), { id: l.id })}>{t('dispatch.send')}</Button>
                        ) : l.dispatch_status === 'pending' && isBuy ? (
                          <>
                            <Button size="sm" variant="ok" icon={<Check size={16} />} loading={busy} onClick={() => run(() => api.markBought(l.id), { id: l.id })}>{t('buy.bought')}</Button>
                            <Button size="sm" variant="ghost" className="text-bad" icon={<X size={16} />} onClick={() => none(l)}>{t('kitchen.none')}</Button>
                          </>
                        ) : l.dispatch_status === 'procuring' ? (
                          <>
                            <Badge tone="buy">{t('lstatus.procuring')}</Badge>
                            <Button size="sm" variant="ok" icon={<Check size={16} />} loading={busy} onClick={() => run(() => api.markBought(l.id), { id: l.id })}>{t('buy.bought')}</Button>
                          </>
                        ) : (
                          <Badge tone={LINE_TONE[l.dispatch_status]}>{l.dispatch_status === 'pending' ? t('dispatch.inKitchen') : t(`lstatus.${l.dispatch_status}` as MessageKey)}</Badge>
                        )}
                      </div>
                    </div>
                  )
                })}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

const RANK: Record<string, number> = { ready: 0, short: 0, pending: 1, procuring: 2, unavailable: 3, dispatched: 4, received: 5 }
const rank = (l: OrderLine) => RANK[l.dispatch_status] ?? 9

function esc(v: unknown) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

/** Printable delivery slip with tick boxes and a signature line. All values are escaped. */
function printSlip(t: TFn, s: StoreBucket) {
  const lines = s.lines.filter(l => l.dispatch_status !== 'unavailable' && l.dispatch_status !== 'received')
  const rows = lines.map(l => {
    const qty = l.dispatch_status === 'short' ? `${num(l.fulfilled_qty)} / ${num(l.quantity)}` : num(l.quantity)
    return `<tr><td class="chk">☐</td><td>${esc(l.item_name_snapshot)}${l.fulfillment_type === 'purchase' ? ' 🛒' : ''}</td><td class="q">${esc(qty)} ${esc(l.unit_snapshot || '')}</td></tr>`
  }).join('')
  const w = window.open('', '_blank', 'width=460,height=680')
  if (!w) return
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(t('dispatch.slipTitle', { store: s.name }))}</title>
    <style>body{font:15px system-ui,Arial,sans-serif;padding:24px;color:#111}h1{font-size:20px;margin:0 0 4px}.sub{color:#666;font-size:13px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse}td{padding:8px 6px;border-bottom:1px solid #ddd}.chk{width:28px;font-size:18px}.q{text-align:right;white-space:nowrap;font-weight:600}
    .foot{margin-top:28px;font-size:13px;color:#444;display:flex;gap:24px}.foot span{flex:1;border-top:1px solid #999;padding-top:4px}</style></head><body>
    <h1>${esc(t('dispatch.slipTitle', { store: s.name }))}</h1>
    <div class="sub">${esc(fmtDate(new Date()))} · ${lines.length} ${esc(t('dispatch.slipItems'))}</div>
    <table>${rows}</table>
    <div class="foot"><span>${esc(t('dispatch.slipReceivedBy'))}</span><span>${esc(t('dispatch.slipSignature'))}</span></div>
    <script>window.onload=function(){window.print()}</script></body></html>`)
  w.document.close()
}
