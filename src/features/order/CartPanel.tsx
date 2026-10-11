import { useState } from 'react'
import { CalendarClock, Flame, PartyPopper, Plus, ShoppingCart, Trash2 } from 'lucide-react'
import * as api from '@/lib/api'
import { useI18n, itemName } from '@/lib/i18n'
import { useCutoff } from '@/lib/refdata'
import { minutesToCutoff, productionWeek } from '@/lib/dates'
import { fmtDate } from '@/lib/format'
import { useFeedback } from '@/ui/feedback'
import { Button, Field, Input, Segmented, Stepper } from '@/ui/primitives'
import type { CatalogItem, OrderType } from '@/lib/types'
import type { Cart } from './useCart'

export interface TopUp { id: string; label: string }

export function CartPanel({ cart, byId, locationId, topUp, onCancelTopUp, onSubmitted, onTemplateSaved }: {
  cart: Cart
  byId: Map<string, CatalogItem>
  locationId: string
  topUp: TopUp | null
  onCancelTopUp: () => void
  onSubmitted: () => void
  onTemplateSaved: () => void
}) {
  const { t, lang } = useI18n()
  const fb = useFeedback()
  const cutoff = useCutoff()
  const [busy, setBusy] = useState(false)
  const { cart: c } = cart
  const type: OrderType = topUp ? 'urgent' : c.type
  const pw = type === 'weekly' && cutoff.data ? productionWeek(cutoff.data) : null
  const mins = cutoff.data ? minutesToCutoff(cutoff.data) : 0

  const lines = Object.entries(c.lines)
    .map(([id, qty]) => ({ item: byId.get(id), qty }))
    .filter((l): l is { item: CatalogItem; qty: number } => !!l.item)
    .sort((a, b) => itemName(lang, a.item).localeCompare(itemName(lang, b.item)))

  async function submit() {
    if (!locationId) { fb.toast(t('order.pickLocation')); return }
    if (!cart.count) { fb.toast(t('order.cartEmpty')); return }
    if (c.adhoc.some(a => a.name.trim() && !(a.qty > 0))) { fb.toast(t('order.qtyPositive')); return }
    setBusy(true)
    try {
      const res = await api.submitOrder({
        locationId,
        orderType: type,
        lines: lines.map(l => ({ id: l.item.id, qty: l.qty })),
        adhoc: c.adhoc.map(a => ({ name: a.name, qty: a.qty, unit: a.unit })),
        parentOrderId: topUp?.id ?? null,
        productionWeek: pw,
        eventName: type === 'event' ? c.eventName.trim() || null : null,
        eventDate: type === 'event' ? c.eventDate || null : null,
      })
      cart.clear()
      fb.ok(topUp ? t('order.sentTopUp', { n: res.count }) : res.merged ? t('order.sentMerged', { n: res.count }) : t('order.sent', { n: res.count }))
      onSubmitted()
    } catch (e) { fb.error(e) } finally { setBusy(false) }
  }

  async function saveTemplate() {
    const name = await fb.prompt({ title: t('order.saveTemplate'), placeholder: t('order.templateName') })
    if (!name) return
    try {
      await api.saveTemplate(locationId, name, lines)
      fb.ok(t('order.templateSaved', { name }))
      onTemplateSaved()
    } catch (e) { fb.error(e) }
  }

  const typeNote: Record<OrderType, { icon: React.ReactNode; text: string; tone: string }> = {
    weekly: { icon: <CalendarClock size={16} />, text: pw ? t('order.noteWeekly', { week: fmtDate(pw) }) : '', tone: 'info' },
    urgent: { icon: <Flame size={16} />, text: t('order.noteUrgent'), tone: 'bad' },
    event: { icon: <PartyPopper size={16} />, text: t('order.noteEvent'), tone: 'accent' },
    procurement: { icon: <ShoppingCart size={16} />, text: t('order.noteBuy'), tone: 'buy' },
  }
  const note = typeNote[type]

  return (
    <div className="cart">
      {topUp ? (
        <div className="note note-info">
          {t('order.topUpBanner', { label: topUp.label })}
          <Button size="sm" variant="ghost" onClick={onCancelTopUp}>{t('common.cancel')}</Button>
        </div>
      ) : (
        <Segmented<OrderType>
          value={c.type}
          onChange={cart.setType}
          ariaLabel={t('order.type')}
          options={[
            { value: 'weekly', label: t('type.weekly') },
            { value: 'urgent', label: t('type.urgent') },
            { value: 'event', label: t('type.event') },
            { value: 'procurement', label: t('type.procurement') },
          ]}
        />
      )}
      {note.text && <div className={`note note-${note.tone}`}>{note.icon}<span>{note.text}</span></div>}
      {type === 'weekly' && mins > 0 && mins < 24 * 60 && (
        <div className="note note-warn"><CalendarClock size={16} /><span>{t('order.cutoffSoon', { h: Math.floor(mins / 60), m: mins % 60 })}</span></div>
      )}
      {type === 'event' && (
        <div className="grid-2">
          <Field label={t('order.eventName')}><Input value={c.eventName} onChange={e => cart.setEvent({ eventName: e.target.value })} /></Field>
          <Field label={t('order.eventDate')}><Input type="date" value={c.eventDate} onChange={e => cart.setEvent({ eventDate: e.target.value })} /></Field>
        </div>
      )}

      <div className="cart-lines">
        {!lines.length && !c.adhoc.length && <p className="muted center pad">{t('order.cartEmptyHint')}</p>}
        {lines.map(({ item, qty }) => (
          <div className="cart-line" key={item.id}>
            <span className="cart-name">{itemName(lang, item)}</span>
            <Stepper value={qty} onChange={v => cart.setQty(item.id, v)} unit={item.order_unit} size="sm" label={itemName(lang, item)} />
          </div>
        ))}
        {c.adhoc.map(a => (
          <div className="cart-line adhoc" key={a.key}>
            <Input placeholder={t('order.customName')} value={a.name} onChange={e => cart.patchAdhoc(a.key, { name: e.target.value })} />
            <Input className="w-qty" inputMode="decimal" placeholder={t('common.qty')} value={a.qty || ''} onChange={e => cart.patchAdhoc(a.key, { qty: Number(e.target.value.replace(',', '.')) || 0 })} />
            <Input className="w-unit" placeholder={t('common.unit')} value={a.unit} onChange={e => cart.patchAdhoc(a.key, { unit: e.target.value })} />
            <Button size="sm" variant="ghost" aria-label={t('common.remove')} icon={<Trash2 size={16} />} onClick={() => cart.removeAdhoc(a.key)} />
          </div>
        ))}
      </div>

      <div className="cart-tools">
        <Button size="sm" variant="ghost" icon={<Plus size={16} />} onClick={cart.addAdhoc}>{t('order.addCustom')}</Button>
        {lines.length > 0 && !topUp && <Button size="sm" variant="ghost" onClick={saveTemplate}>{t('order.saveTemplate')}</Button>}
        {cart.count > 0 && <Button size="sm" variant="ghost" onClick={async () => { if (await fb.confirm({ title: t('order.clearCart'), danger: true, confirm: t('order.clear') })) cart.clear() }}>{t('order.clear')}</Button>}
      </div>

      <Button variant="primary" size="lg" block loading={busy} disabled={!cart.count} onClick={submit}>
        {topUp ? t('order.submitTopUp', { n: cart.count }) : t('order.submit', { n: cart.count })}
      </Button>
    </div>
  )
}
