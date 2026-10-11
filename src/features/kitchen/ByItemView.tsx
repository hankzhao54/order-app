import { useEffect, useMemo, useState } from 'react'
import { Check, Printer, SlidersHorizontal } from 'lucide-react'
import * as api from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { QK, useAction } from '@/lib/useAction'
import { aggregateByItem, type ItemAggregate } from '@/lib/kitchen'
import { isPending } from '@/lib/status'
import { num, qtyUnit } from '@/lib/format'
import { Badge, Button, Card, Empty, Input, Segmented } from '@/ui/primitives'
import { Sheet } from '@/ui/Sheet'
import type { OrderWithLines } from '@/lib/types'
import { thisMonday } from '@/lib/dates'
import { bucketOf } from '@/lib/kitchen'

export function ByItemView({ orders, onEditing }: { orders: OrderWithLines[]; onEditing: (v: boolean) => void }) {
  const { t } = useI18n()
  const [range, setRange] = useState<'all' | 'week'>('all')
  const [partial, setPartial] = useState<ItemAggregate | null>(null)
  const [made, setMade] = useState<Record<string, string>>({})
  useEffect(() => { onEditing(!!partial) }, [partial, onEditing])
  const { run, isBusy } = useAction([QK.orders, QK.central])

  const monday = thisMonday()
  const scope = useMemo(() => range === 'week' ? orders.filter(o => bucketOf(o, monday) <= 2) : orders, [orders, range, monday])
  const agg = useMemo(() => aggregateByItem(scope), [scope])

  function allMade(g: ItemAggregate) {
    const rows = g.lines.filter(l => isPending(l.status)).map(l => ({ id: l.id, fulfilled: l.qty }))
    if (rows.length) run(() => api.kitchenProduce(rows), { id: g.key })
  }
  function openPartial(g: ItemAggregate) {
    setMade(Object.fromEntries(g.lines.filter(l => isPending(l.status)).map(l => [l.id, String(l.qty)])))
    setPartial(g)
  }
  async function applyPartial() {
    if (!partial) return
    const rows = Object.entries(made).map(([id, v]) => ({ id, fulfilled: Number(v.replace(',', '.')) })).filter(r => r.fulfilled > 0)
    if (rows.length) await run(() => api.kitchenProduce(rows), { id: partial.key })
    setPartial(null)
  }

  if (!scope.length) return <Empty title={t('kitchen.noneInRange')} />

  const Section = ({ title, rows, make }: { title: string; rows: ItemAggregate[]; make?: boolean }) => (
    <Card className="prod-section">
      <h3>{title} <span className="muted">({rows.length})</span></h3>
      {!rows.length && <p className="muted small">—</p>}
      {rows.map(g => {
        const pendingN = g.lines.filter(l => isPending(l.status)).length
        const done = pendingN === 0
        return (
          <div key={g.key} className={`prod-row${done ? ' done' : ''}`}>
            <div className="prod-main">
              <span className="prod-name">{g.name}{done && <Check size={16} className="text-ok" />}</span>
              <span className="prod-total">{qtyUnit(g.total, g.unit)}</span>
            </div>
            <div className="chips">
              {g.lines.map(l => (
                <span key={l.id} className={`tally-chip st-${l.status}`}>
                  {l.location}: <b>{num(l.qty)}</b>{l.status === 'short' && l.fulfilled != null ? ` (${num(l.fulfilled)})` : ''}
                </span>
              ))}
            </div>
            {make && !done && (
              <div className="row gap-1 no-print">
                <Button size="sm" variant="ok" icon={<Check size={16} />} loading={isBusy(g.key)} onClick={() => allMade(g)}>{t('kitchen.allMade', { n: pendingN })}</Button>
                <Button size="sm" variant="ghost" icon={<SlidersHorizontal size={16} />} onClick={() => openPartial(g)}>{t('kitchen.partial')}</Button>
              </div>
            )}
          </div>
        )
      })}
    </Card>
  )

  return (
    <div className="by-item">
      <div className="toolbar no-print">
        <Segmented value={range} onChange={setRange} size="sm" options={[{ value: 'all', label: t('kitchen.allOpen') }, { value: 'week', label: t('kitchen.thisWeek') }]} />
        <span className="muted small grow">{t('kitchen.prodSummary', { n: scope.length })}</span>
        <Button size="sm" variant="ghost" icon={<Printer size={16} />} onClick={() => window.print()}>{t('common.print')}</Button>
      </div>
      <Section title={t('kitchen.toMake')} rows={agg.make} make />
      <Section title={t('kitchen.toBuy')} rows={agg.buy} />
      {agg.unsorted.length > 0 && <Section title={t('kitchen.unsorted')} rows={agg.unsorted} make />}
      {agg.adhoc.length > 0 && (
        <Card className="prod-section">
          <h3>{t('kitchen.customItems')} <span className="muted">({agg.adhoc.length})</span></h3>
          {agg.adhoc.map(a => (
            <div key={a.id} className="prod-row">
              <div className="prod-main"><span className="prod-name">{a.item_name_snapshot}</span><span className="prod-total">{qtyUnit(a.quantity, a.unit_snapshot)}</span></div>
              <div className="chips"><span className="tally-chip">{a.location}</span><Badge>{t(`lstatus.${a.dispatch_status}` as 'lstatus.pending')}</Badge></div>
            </div>
          ))}
        </Card>
      )}

      <Sheet open={!!partial} onClose={() => setPartial(null)} title={partial ? t('kitchen.partialTitle', { name: partial.name }) : ''}
        footer={<>
          <Button variant="ghost" onClick={() => setPartial(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={partial ? isBusy(partial.key) : false} onClick={applyPartial}>{t('common.apply')}</Button>
        </>}
      >
        <p className="muted small">{t('kitchen.partialHint')}</p>
        <div className="partial-grid">
          {partial?.lines.filter(l => isPending(l.status)).map(l => (
            <label key={l.id} className="field">
              <span className="field-label">{l.location} <span className="muted">/ {num(l.qty)}</span></span>
              <Input inputMode="decimal" value={made[l.id] ?? ''} onChange={e => setMade(m => ({ ...m, [l.id]: e.target.value }))} />
            </label>
          ))}
        </div>
      </Sheet>
    </div>
  )
}
