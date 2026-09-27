import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Search } from 'lucide-react'
import * as api from '@/lib/api'
import { useI18n, itemName } from '@/lib/i18n'
import type { MessageKey } from '@/lib/i18n/en'
import { useCatalog, useLocations } from '@/lib/refdata'
import { rangeStartISO, todayISO } from '@/lib/dates'
import { fmtDateTime, huf, matches, num } from '@/lib/format'
import { downloadCSV } from '@/lib/csv'
import { Card, Empty, Input, PageHeader, Segmented, Select, Skeleton, Stat } from '@/ui/primitives'

type Range = 'week' | 'month' | 'all'

export default function ReportsPage() {
  const { t } = useI18n()
  const [tab, setTab] = useState<'spend' | 'stock'>('spend')
  const [range, setRange] = useState<Range>('month')
  return (
    <div className="page">
      <PageHeader
        title={t('rep.title')}
        actions={<>
          <Segmented value={tab} onChange={setTab} options={[{ value: 'spend', label: t('rep.spend') }, { value: 'stock', label: t('rep.stockLog') }]} />
          <Segmented size="sm" value={range} onChange={setRange} options={[{ value: 'week', label: t('rep.week') }, { value: 'month', label: t('rep.month') }, { value: 'all', label: t('rep.all') }]} />
        </>}
      />
      {tab === 'spend' ? <Spend range={range} /> : <StockLog range={range} />}
    </div>
  )
}

function Spend({ range }: { range: Range }) {
  const { t, lang } = useI18n()
  const [view, setView] = useState<'item' | 'supplier' | 'store'>('item')
  const since = rangeStartISO(range)
  const bought = useQuery({ queryKey: ['rep', 'bought', since], queryFn: () => api.listBoughtSince(since) })
  const prices = useQuery({ queryKey: ['rep', 'prices'], queryFn: api.latestUnitPrices })
  const suppliers = useQuery({ queryKey: ['rep', 'suppliers'], queryFn: api.listSuppliers })
  const locations = useLocations()
  const catalog = useCatalog()

  const data = useMemo(() => {
    const p = prices.data ?? {}
    const supName = new Map((suppliers.data ?? []).map(s => [s.id, s.name]))
    const locName = new Map((locations.data ?? []).map(l => [l.id, l.name_en]))
    const cat = new Map((catalog.data ?? []).map(c => [c.id, c]))
    const rows = (bought.data ?? []).map(b => {
      const price = b.catalog_item_id ? p[b.catalog_item_id] : undefined
      return {
        ...b,
        cost: price ? Number(b.quantity) * price.unit : 0,
        hasPrice: !!price,
        supplier: price?.supplierId ? supName.get(price.supplierId) || '—' : '—',
        store: (b.target_location_id && locName.get(b.target_location_id)) || '—',
        label: b.catalog_item_id && cat.get(b.catalog_item_id) ? itemName(lang, cat.get(b.catalog_item_id)) : b.item_name,
      }
    })
    const total = rows.reduce((a, r) => a + r.cost, 0)
    const groups = new Map<string, { label: string; cost: number; qty: number; missing: number }>()
    for (const r of rows) {
      const k = view === 'item' ? (r.catalog_item_id || r.item_name) : view === 'supplier' ? r.supplier : r.store
      const label = view === 'item' ? r.label : k
      const g = groups.get(k) || { label, cost: 0, qty: 0, missing: 0 }
      g.cost += r.cost; g.qty += Number(r.quantity); if (!r.hasPrice) g.missing++
      groups.set(k, g)
    }
    return { rows, total, groups: [...groups.values()].sort((a, b) => b.cost - a.cost || a.label.localeCompare(b.label)), missing: rows.filter(r => !r.hasPrice).length }
  }, [bought.data, prices.data, suppliers.data, locations.data, catalog.data, view, lang])

  if (bought.isPending || prices.isPending) return <Skeleton rows={6} />
  const max = Math.max(1, ...data.groups.map(g => g.cost))
  return (
    <>
      <div className="stats">
        <Stat value={huf(data.total)} label={t('rep.totalSpend')} />
        <Stat value={data.rows.length} label={t('rep.itemsBought')} />
        {data.missing > 0 && <Stat tone="warn" value={data.missing} label={t('rep.noPrice')} />}
      </div>
      <div className="toolbar">
        <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'item', label: t('rep.byItem') }, { value: 'supplier', label: t('rep.bySupplier') }, { value: 'store', label: t('rep.byStore') }]} />
        <span className="grow" />
        <button type="button" className="btn btn-ghost btn-sm" disabled={!data.groups.length} onClick={() => downloadCSV(`spend-${view}-${range}-${todayISO()}`, [
          { label: view, value: g => g.label }, { label: 'Qty', value: g => g.qty }, { label: 'Spend (HUF)', value: g => Math.round(g.cost) },
          { label: 'Share %', value: g => data.total ? Math.round(g.cost / data.total * 100) : 0 },
        ], data.groups)}><Download size={16} /><span>{t('common.exportCsv')}</span></button>
      </div>
      {!data.groups.length ? <Empty title={t('rep.noPurchases')} /> : (
        <Card className="table-wrap">
          <table className="table">
            <thead><tr><th>{t(view === 'item' ? 'common.item' : view === 'supplier' ? 'rep.supplier' : 'rep.store')}</th><th className="num">{t('common.qty')}</th><th className="num">{t('rep.spendCol')}</th><th className="w-bar" /></tr></thead>
            <tbody>
              {data.groups.map(g => (
                <tr key={g.label}>
                  <td>{g.label}{g.missing > 0 && <span className="muted small"> · {t('rep.someNoPrice')}</span>}</td>
                  <td className="num">{num(g.qty)}</td>
                  <td className="num"><b>{huf(g.cost)}</b></td>
                  <td><div className="bar"><div style={{ width: `${(g.cost / max) * 100}%` }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="muted small">{t('rep.spendFoot')}</p>
    </>
  )
}

const REASONS = ['produced', 'dispatched', 'received', 'return_out', 'return_in', 'stocktake', 'scrap', 'manual', 'production undone'] as const

function StockLog({ range }: { range: Range }) {
  const { t, lang } = useI18n()
  const since = rangeStartISO(range)
  const moves = useQuery({ queryKey: ['rep', 'moves', since], queryFn: () => api.listStockMoves(since) })
  const prices = useQuery({ queryKey: ['rep', 'prices'], queryFn: api.latestUnitPrices })
  const locations = useLocations()
  const catalog = useCatalog()
  const [reason, setReason] = useState('')
  const [loc, setLoc] = useState('')
  const [q, setQ] = useState('')

  const cat = useMemo(() => new Map((catalog.data ?? []).map(c => [c.id, c])), [catalog.data])
  const locName = useMemo(() => new Map((locations.data ?? []).map(l => [l.id, l.name_en])), [locations.data])
  const all = moves.data ?? []
  const filtered = all.filter(m => (!reason || m.reason === reason) && (!loc || m.location_id === loc) && matches([cat.get(m.catalog_item_id)?.name_en, cat.get(m.catalog_item_id)?.name_hu], q))
  const scrap = all.filter(m => m.reason === 'scrap')
  const scrapLoss = scrap.reduce((a, m) => a + Math.abs(m.delta) * (prices.data?.[m.catalog_item_id]?.unit ?? 0), 0)
  const reasonLabel = (r: string) => (REASONS as readonly string[]).includes(r) ? t(`move.${r.replace(' ', '_')}` as MessageKey) : r

  return (
    <>
      <div className="stats">
        <Stat tone="bad" value={huf(scrapLoss)} label={t('rep.wasteLoss')} />
        <Stat value={num(scrap.reduce((a, m) => a + Math.abs(m.delta), 0))} label={t('rep.unitsScrapped')} />
        <Stat value={filtered.length} label={t('rep.movements')} />
      </div>
      <div className="toolbar wrap">
        <div className="search grow"><Search size={18} aria-hidden /><Input type="search" placeholder={t('inv.search')} value={q} onChange={e => setQ(e.target.value)} /></div>
        <Select value={reason} onChange={e => setReason(e.target.value)}>
          <option value="">{t('rep.allReasons')}</option>
          {REASONS.map(r => <option key={r} value={r}>{reasonLabel(r)}</option>)}
        </Select>
        <Select value={loc} onChange={e => setLoc(e.target.value)}>
          <option value="">{t('hist.allLocations')}</option>
          {(locations.data ?? []).map(l => <option key={l.id} value={l.id}>{l.name_en}</option>)}
        </Select>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!filtered.length} onClick={() => downloadCSV(`stock-log-${range}-${todayISO()}`, [
          { label: 'When', value: m => m.created_at }, { label: 'Item', value: m => cat.get(m.catalog_item_id)?.name_en },
          { label: 'Location', value: m => (m.location_id && locName.get(m.location_id)) || '' }, { label: 'Reason', value: m => m.reason },
          { label: 'Change', value: m => m.delta }, { label: 'Note', value: m => m.note },
        ], filtered)}><Download size={16} /><span>{t('common.exportCsv')}</span></button>
      </div>
      {moves.isPending ? <Skeleton rows={8} /> : !filtered.length ? <Empty title={t('rep.noMoves')} /> : (
        <Card className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('hist.when')}</th><th>{t('common.item')}</th><th>{t('common.location')}</th><th>{t('rep.reason')}</th><th className="num">{t('rep.change')}</th></tr></thead>
            <tbody>
              {filtered.map(m => (
                <tr key={m.id}>
                  <td className="nowrap muted small">{fmtDateTime(m.created_at)}</td>
                  <td>{itemName(lang, cat.get(m.catalog_item_id)) || '—'}</td>
                  <td className="muted small">{(m.location_id && locName.get(m.location_id)) || '—'}</td>
                  <td>{reasonLabel(m.reason)}</td>
                  <td className={`num ${m.delta >= 0 ? 'text-ok' : 'text-bad'}`}><b>{m.delta >= 0 ? '+' : ''}{num(m.delta)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="muted small">{t('rep.stockFoot')}</p>
    </>
  )
}
