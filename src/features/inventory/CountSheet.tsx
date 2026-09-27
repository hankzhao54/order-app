import { useState } from 'react'
import type { QueryKey } from '@tanstack/react-query'
import { Trash2, Undo2 } from 'lucide-react'
import * as api from '@/lib/api'
import { useI18n, itemName } from '@/lib/i18n'
import { useAction } from '@/lib/useAction'
import { expiryInfo } from '@/lib/inventory'
import { fmtDate, num } from '@/lib/format'
import { todayISO } from '@/lib/dates'
import { useFeedback } from '@/ui/feedback'
import { Badge, Button, Field, Input, Stepper } from '@/ui/primitives'
import { Sheet } from '@/ui/Sheet'
import type { CatalogItem } from '@/lib/types'

export interface StockItem {
  spec: CatalogItem
  qty: number
  storage: string | null
  batches: { id: string; qty: number; produced_on: string; expires_on: string | null }[]
}

export function CountSheet({ item, locationId, isCentral, locationName, onClose, onCounted, invalidate }: {
  item: StockItem; locationId: string; isCentral: boolean; locationName: string
  onClose: () => void; onCounted: (id: string) => void; invalidate: QueryKey[]
}) {
  const { t, lang } = useI18n()
  const fb = useFeedback()
  const { run, isBusy } = useAction(invalidate)
  const [count, setCount] = useState(item.qty)
  const [showBatches, setShowBatches] = useState(false)
  const [backQty, setBackQty] = useState('')
  const [newQty, setNewQty] = useState('')
  const [newDate, setNewDate] = useState(todayISO())
  const unit = item.spec.stock_unit || ''
  const name = itemName(lang, item.spec)
  const expiring = item.batches.filter(b => ['expired', 'today', 'soon'].includes(expiryInfo(b.expires_on).level))

  async function save() {
    const r = await run(() => api.stocktake(locationId, item.spec.id, count), { id: 'count' })
    if (r !== undefined) {
      api.logAudit('stock.adjust', item.spec.name_en, { target: count, from: item.qty, where: locationName })
      onCounted(item.spec.id)
      onClose()
    }
  }
  async function scrap(b: StockItem['batches'][number]) {
    if (!await fb.confirm({ title: t('inv.scrapTitle', { qty: `${num(b.qty)} ${unit}` }), body: t('inv.scrapBody'), danger: true, confirm: t('inv.scrap') })) return
    const r = await run(() => api.scrapBatch(b.id), { id: b.id })
    if (r !== undefined) api.logAudit('stock.scrap', item.spec.name_en, { qty: b.qty, where: locationName })
  }
  async function sendBack() {
    const n = Number(backQty.replace(',', '.'))
    if (!(n > 0)) { fb.toast(t('inv.enterQty')); return }
    if (n > item.qty) { fb.toast(t('inv.onlyInStock', { n: num(item.qty) })); return }
    if (!await fb.confirm({ title: t('inv.sendBackTitle', { qty: `${num(n)} ${unit}`, name }), body: t('inv.sendBackBody') })) return
    const r = await run(() => api.sendBack(locationId, item.spec.id, n), { id: 'back', success: t('inv.sentBack') })
    if (r !== undefined) { api.logAudit('stock.return', item.spec.name_en, { qty: n, from: locationName }); setBackQty('') }
  }
  async function addDelivery() {
    const n = Number(newQty.replace(',', '.'))
    if (!(n > 0)) { fb.toast(t('inv.enterQty')); return }
    const r = await run(() => api.addBatch(locationId, item.spec.id, n, newDate), { id: 'add' })
    if (r !== undefined) { setNewQty(''); onCounted(item.spec.id) }
  }
  async function removeItem() {
    if (!await fb.confirm({ title: t('inv.removeTitle', { name }), body: item.qty > 0 ? t('inv.removeBodyStock') : undefined, danger: true, confirm: t('common.remove') })) return
    const r = await run(() => api.removeFromStockList(locationId, item.spec.id), { id: 'remove' })
    if (r !== undefined) onClose()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={<div><div>{name}</div><div className="muted small">{locationName} · {t('inv.system', { qty: `${num(item.qty)} ${unit}` })}</div></div>}
      footer={<>
        <Button variant="ghost" className="text-bad" onClick={removeItem}>{t('inv.removeItem')}</Button>
        <span className="grow" />
        <Button variant="primary" size="lg" loading={isBusy('count')} onClick={save}>{t('inv.saveCount', { qty: `${num(count)} ${unit}` })}</Button>
      </>}
    >
      <div className="count-block">
        <Stepper size="lg" value={count} onChange={setCount} unit={unit} label={t('inv.actualCount')} />
        <div className="quick-steps">
          {[-10, -5, -1, +1, +5, +10].map(d => (
            <button key={d} type="button" onClick={() => setCount(c => Math.max(0, Math.round((c + d) * 1000) / 1000))}>{d > 0 ? `+${d}` : d}</button>
          ))}
        </div>
        {count !== item.qty && <div className="muted small center">{t('inv.diff', { d: `${count > item.qty ? '+' : ''}${num(count - item.qty)}` })}</div>}
      </div>

      {expiring.length > 0 && (
        <div className="sub-section warn">
          <h4>{t('inv.expiringTitle')}</h4>
          {expiring.map(b => {
            const e = expiryInfo(b.expires_on)
            return (
              <div key={b.id} className="batch-row">
                <span className="grow">{num(b.qty)} {unit} · {t('inv.made', { d: fmtDate(b.produced_on) })}</span>
                <Badge tone={e.level === 'expired' ? 'bad' : 'warn'}>{e.level === 'expired' ? t('inv.expired') : e.level === 'today' ? t('inv.expToday') : t('inv.expDays', { n: e.days ?? 0 })}</Badge>
                <Button size="sm" variant="danger" icon={<Trash2 size={14} />} loading={isBusy(b.id)} onClick={() => scrap(b)}>{t('inv.scrap')}</Button>
              </div>
            )
          })}
        </div>
      )}

      {!isCentral && item.qty > 0 && (
        <div className="sub-section">
          <h4>{t('inv.sendBackHead')}</h4>
          <div className="row gap-1">
            <Input className="w-qty" inputMode="decimal" placeholder={t('common.qty')} value={backQty} onChange={e => setBackQty(e.target.value)} />
            <Button icon={<Undo2 size={16} />} loading={isBusy('back')} onClick={sendBack}>{t('inv.sendBack')}</Button>
          </div>
          <p className="muted small">{t('inv.sendBackHint')}</p>
        </div>
      )}

      <button type="button" className="link-btn" onClick={() => setShowBatches(s => !s)}>
        {showBatches ? '▾' : '▸'} {t('inv.batches', { n: item.batches.length })}
      </button>
      {showBatches && (
        <div className="sub-section">
          {item.batches.map(b => {
            const e = expiryInfo(b.expires_on)
            return (
              <div key={b.id} className="batch-row">
                <span className="grow small">
                  {t('inv.made', { d: fmtDate(b.produced_on) })}
                  {b.expires_on ? ` · ${t('inv.useBy', { d: fmtDate(b.expires_on) })}` : ` · ${t('inv.noExpiry')}`}
                  {e.level === 'expired' && <Badge tone="bad">{t('inv.expired')}</Badge>}
                </span>
                <BatchQty value={b.qty} busy={isBusy(b.id)} onSave={v => run(() => api.editBatch(b.id, v), { id: b.id })} />
              </div>
            )
          })}
          <div className="grid-3 mt-2">
            <Field label={t('common.qty')}><Input inputMode="decimal" value={newQty} onChange={e => setNewQty(e.target.value)} /></Field>
            <Field label={t('inv.producedOn')}><Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} /></Field>
            <div className="align-end"><Button variant="primary" loading={isBusy('add')} onClick={addDelivery}>{t('inv.addBatch')}</Button></div>
          </div>
          <p className="muted small">{item.spec.shelf_life_days ? t('inv.shelfLife', { n: item.spec.shelf_life_days }) : t('inv.noShelfLife')}</p>
        </div>
      )}
    </Sheet>
  )
}

function BatchQty({ value, busy, onSave }: { value: number; busy: boolean; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value))
  const n = Number(v.replace(',', '.'))
  const dirty = Number.isFinite(n) && n >= 0 && n !== value
  return (
    <span className="row gap-1">
      <Input className="w-qty" inputMode="decimal" value={v} onChange={e => setV(e.target.value)} />
      {dirty && <Button size="sm" variant="primary" loading={busy} onClick={() => onSave(n)}>OK</Button>}
    </span>
  )
}
