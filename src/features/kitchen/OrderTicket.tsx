import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { BookMarked, Check, Package, Pencil, RotateCcw, ShoppingCart, Trash2, X, Minus } from 'lucide-react'
import * as api from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import type { MessageKey } from '@/lib/i18n/en'
import { QK, useAction } from '@/lib/useAction'
import { countLines, isPending, isResettable, LINE_TONE, TYPE_TONE } from '@/lib/status'
import { fmtDate, fmtDateTime, num, qtyUnit } from '@/lib/format'
import { useFeedback } from '@/ui/feedback'
import { Badge, Button, Card, Stepper } from '@/ui/primitives'
import { Sheet } from '@/ui/Sheet'
import type { OrderLine, OrderWithLines } from '@/lib/types'

export function OrderTicket({ order: o, stock, recipeFor = {}, onEditing }: {
  order: OrderWithLines; stock: Record<string, number>; recipeFor?: Record<string, string>; onEditing: (v: boolean) => void
}) {
  const { t } = useI18n()
  const fb = useFeedback()
  const { run, isBusy } = useAction([QK.orders, QK.central])
  const [sheet, setSheet] = useState<{ mode: 'short' | 'qty'; line: OrderLine; value: number } | null>(null)
  useEffect(() => { onEditing(!!sheet) }, [sheet, onEditing])

  const c = countLines(o.items)
  const handled = c.total - c.pending
  const allHandled = c.total > 0 && c.pending === 0

  const act = (id: string, fn: () => Promise<unknown>, success?: string) => run(fn, { id, success })

  async function none(line: OrderLine) {
    const reason = await fb.prompt({
      title: t('kitchen.noneTitle', { name: line.item_name_snapshot }),
      choices: [t('reason.outOfStock'), t('reason.cantMakeInTime'), t('reason.tempUnavailable')],
      placeholder: t('buy.otherReason'),
      confirm: t('kitchen.markNone'),
    })
    if (reason) await act(line.id, () => api.markUnavailable(line.id, reason))
  }
  async function remove(line: OrderLine) {
    if (!await fb.confirm({ title: t('kitchen.removeLine', { name: line.item_name_snapshot }), danger: true, confirm: t('common.remove') })) return
    await act(line.id, () => api.deleteLine(line.id))
  }
  async function cancelOrder() {
    if (!await fb.confirm({ title: t('kitchen.cancelTitle', { store: o.location?.name_en || '' }), body: t('kitchen.cancelBody'), danger: true, confirm: t('kitchen.cancelOrder') })) return
    await act(o.id, () => api.setOrdersStatus([o.id], 'cancel'), t('kitchen.orderCancelled'))
  }
  async function applySheet() {
    if (!sheet) return
    const { mode, line, value } = sheet
    if (mode === 'short') {
      if (!(value > 0)) { setSheet(null); await none(line); return }
      await act(line.id, () => api.kitchenProduce([{ id: line.id, fulfilled: value }]))
    } else {
      if (!(value > 0)) { fb.toast(t('kitchen.qtyPositive')); return }
      await act(line.id, () => api.updateLineQty(line.id, value))
    }
    setSheet(null)
  }

  return (
    <Card className={`ticket${o.order_type === 'urgent' || o.parent_order_id ? ' ticket-urgent' : ''}`}>
      <div className="ticket-head">
        <div className="grow">
          <div className="row wrap gap-1">
            <b className="ticket-store">{o.location?.name_en}</b>
            <Badge tone={TYPE_TONE[o.order_type]}>{t(`type.${o.order_type}` as MessageKey)}</Badge>
            {o.parent_order_id && <Badge tone="accent">{t('mine.topUp')}</Badge>}
            {o.order_type === 'event' && (o.event_name || o.event_date) && (
              <Badge tone="accent">{o.event_name || t('type.event')}{o.event_date ? ` · ${fmtDate(o.event_date)}` : ''}</Badge>
            )}
          </div>
          <div className="muted small">{fmtDateTime(o.created_at)}</div>
        </div>
        <div className="progress-ring" title={`${handled}/${c.total}`}>
          <b>{handled}</b><span>/{c.total}</span>
        </div>
      </div>

      <div className="ticket-lines">
        {o.items.map(line => {
          const avail = line.catalog_item_id ? stock[line.catalog_item_id] ?? 0 : 0
          const busy = isBusy(line.id)
          const pending = isPending(line.dispatch_status)
          const isBuy = line.fulfillment_type === 'purchase'
          return (
            <div key={line.id} className={`kline st-${line.dispatch_status}`}>
              <div className="kline-top">
                <span className="kline-qty">{qtyUnit(line.quantity, line.unit_snapshot)}</span>
                <span className="kline-name">{line.item_name_snapshot}</span>
                {line.catalog_item_id && recipeFor[line.catalog_item_id] && (
                  <Link className="kline-recipe" to={`/recipes/${recipeFor[line.catalog_item_id]}`} aria-label={t('rec.open')} title={t('rec.open')}><BookMarked size={15} /></Link>
                )}
                {isBuy && <ShoppingCart size={14} className="text-buy" aria-label={t('kitchen.buyItem')} />}
                {!line.catalog_item_id && <Badge>{t('kitchen.custom')}</Badge>}
                {(pending || line.dispatch_status === 'unavailable') && (
                  <span className="kline-tools">
                    <button type="button" aria-label={t('kitchen.editQty')} onClick={() => setSheet({ mode: 'qty', line, value: Number(line.quantity) })}><Pencil size={14} /></button>
                    <button type="button" aria-label={t('common.remove')} onClick={() => remove(line)}><Trash2 size={14} /></button>
                  </span>
                )}
              </div>

              {pending && !isBuy && avail > 0 && (
                <div className="stock-hint">
                  <Package size={14} />
                  {avail >= Number(line.quantity)
                    ? <span>{t('kitchen.stockCovers', { n: num(avail) })}</span>
                    : <span>{t('kitchen.stockPartial', { n: num(avail), make: num(Number(line.quantity) - avail) })}</span>}
                  {avail >= Number(line.quantity) && (
                    <Button size="sm" variant="ok" loading={busy} onClick={() => act(line.id, () => api.kitchenUseStock(line.id))}>{t('kitchen.useStock')}</Button>
                  )}
                </div>
              )}

              {pending ? (
                <div className="kline-actions">
                  {isBuy ? (
                    <Button size="sm" variant="secondary" icon={<ShoppingCart size={16} />} loading={busy} onClick={() => act(line.id, () => api.sendToBuyer(line.id), t('kitchen.sentToBuyer'))}>{t('kitchen.toBuyList')}</Button>
                  ) : (
                    <>
                      <Button size="sm" variant="ok" icon={<Check size={16} />} loading={busy} onClick={() => act(line.id, () => api.kitchenProduce([{ id: line.id, fulfilled: Number(line.quantity) }]))}>{t('kitchen.ready')}</Button>
                      <Button size="sm" variant="warn" icon={<Minus size={16} />} onClick={() => setSheet({ mode: 'short', line, value: Number(line.quantity) })}>{t('kitchen.short')}</Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" className="text-bad" icon={<X size={16} />} onClick={() => none(line)}>{t('kitchen.none')}</Button>
                </div>
              ) : (
                <div className="kline-actions">
                  <Badge tone={LINE_TONE[line.dispatch_status]}>
                    {t(`lstatus.${line.dispatch_status}` as MessageKey)}
                    {line.dispatch_status === 'short' && ` ${num(line.fulfilled_qty)}/${num(line.quantity)}`}
                  </Badge>
                  {line.unavail_reason && <span className="muted small">{line.unavail_reason}</span>}
                  {isResettable(line.dispatch_status) && (
                    <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} loading={busy} onClick={() => act(line.id, () => api.kitchenReset(line.id))}>{t('kitchen.undo')}</Button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="ticket-foot">
        <Button variant={allHandled ? 'primary' : 'secondary'} disabled={!allHandled} loading={isBusy(o.id)}
          onClick={() => act(o.id, () => api.setOrdersStatus([o.id], 'complete'), t('kitchen.completedToast', { store: o.location?.name_en || '' }))}>
          {allHandled ? t('kitchen.complete') : t('kitchen.handleAll', { done: handled, total: c.total })}
        </Button>
        <Button variant="ghost" className="text-bad" onClick={cancelOrder}>{t('kitchen.cancelOrder')}</Button>
      </div>

      <Sheet
        open={!!sheet}
        onClose={() => setSheet(null)}
        size="sm"
        title={sheet ? (sheet.mode === 'short' ? t('kitchen.shortTitle', { name: sheet.line.item_name_snapshot }) : t('kitchen.qtyTitle', { name: sheet.line.item_name_snapshot })) : ''}
        footer={<>
          <Button variant="ghost" onClick={() => setSheet(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={sheet ? isBusy(sheet.line.id) : false} onClick={applySheet}>{t('common.save')}</Button>
        </>}
      >
        {sheet && (
          <div className="center stack">
            <p className="muted">{sheet.mode === 'short' ? t('kitchen.shortHint', { qty: qtyUnit(sheet.line.quantity, sheet.line.unit_snapshot) }) : t('kitchen.qtyHint')}</p>
            <Stepper size="lg" value={sheet.value} unit={sheet.line.unit_snapshot} onChange={v => setSheet(s => s && { ...s, value: v })} />
          </div>
        )}
      </Sheet>
    </Card>
  )
}
