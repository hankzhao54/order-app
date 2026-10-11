import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Download, Plus, Search } from 'lucide-react'
import * as api from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useI18n, itemName } from '@/lib/i18n'
import { useCatalog, useCategories, useLocations } from '@/lib/refdata'
import { useLiveQueries } from '@/lib/query'
import { QK, useAction } from '@/lib/useAction'
import { contentTotal, isLow, worstExpiry } from '@/lib/inventory'
import { matches, num } from '@/lib/format'
import { downloadCSV } from '@/lib/csv'
import { todayISO } from '@/lib/dates'
import { Badge, Button, Card, Empty, Input, PageHeader, Segmented, Select, Skeleton } from '@/ui/primitives'
import type { CatalogItem } from '@/lib/types'
import { CountSheet, type StockItem } from './CountSheet'

export default function InventoryPage() {
  const { t } = useI18n()
  const { can } = useAuth()
  const [tab, setTab] = useState<'count' | 'overview'>('count')
  return (
    <div className="page">
      <PageHeader
        title={t('inv.title')}
        actions={can('inventory.overview') ? (
          <Segmented value={tab} onChange={setTab} options={[{ value: 'count', label: t('inv.stocktake') }, { value: 'overview', label: t('inv.overview') }]} />
        ) : undefined}
      />
      {tab === 'overview' ? <Overview /> : <Stocktake />}
    </div>
  )
}

function Stocktake() {
  const { t, lang } = useI18n()
  const { can, locationId } = useAuth()
  const locations = useLocations()
  const catalog = useCatalog()
  const cats = useCategories()
  const anyLoc = can('inventory.anyLocation')
  const [picked, setPicked] = useState('')
  const central = (locations.data ?? []).find(l => l.is_central)
  const locId = anyLoc ? (picked || locationId || central?.id || '') : (locationId || '')
  const loc = (locations.data ?? []).find(l => l.id === locId)

  const key = [...QK.stock, locId]
  const stock = useQuery({ queryKey: key, enabled: !!locId, queryFn: () => api.listStock(locId) })
  const [editing, setEditing] = useState<string | null>(null)
  useLiveQueries(['stock_batches', 'location_stock'], [key], !!editing)
  const { run } = useAction([key])

  const [q, setQ] = useState('')
  const [groupBy, setGroupBy] = useState<'storage' | 'category'>('storage')
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [counted, setCounted] = useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [adding, setAdding] = useState(false)

  const byId = useMemo(() => new Map((catalog.data ?? []).map(c => [c.id, c])), [catalog.data])
  const catName = useMemo(() => new Map((cats.data ?? []).map(c => [c.id, lang === 'hu' && c.name_hu ? c.name_hu : c.name_en])), [cats.data, lang])

  const items: StockItem[] = useMemo(() => (stock.data ?? []).flatMap(r => {
    const spec = byId.get(r.catalog_item_id)
    return spec ? [{ spec, qty: r.qty, batches: r.batches, storage: r.storage_location || spec.storage_location }] : []
  }).sort((a, b) => itemName(lang, a.spec).localeCompare(itemName(lang, b.spec))), [stock.data, byId, lang])

  const filtered = items.filter(i => matches([i.spec.name_en, i.spec.name_hu, i.storage], q) && (!onlyOpen || !counted[i.spec.id]))
  const groups = useMemo(() => {
    const m = new Map<string, StockItem[]>()
    for (const i of filtered) {
      const k = (groupBy === 'storage' ? i.storage : (i.spec.category_id && catName.get(i.spec.category_id))) || t('inv.unassigned')
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(i)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered, groupBy, catName, t])

  const inList = new Set(items.map(i => i.spec.id))
  const addable = (catalog.data ?? []).filter(c => !inList.has(c.id) && matches([c.name_en, c.name_hu], q))
  const countedN = items.filter(i => counted[i.spec.id]).length
  const current = editing ? items.find(i => i.spec.id === editing) ?? null : null

  return (
    <>
      <div className="toolbar wrap">
        {anyLoc ? (
          <Select value={locId} onChange={e => { setPicked(e.target.value); setCounted({}) }} aria-label={t('common.location')}>
            {(locations.data ?? []).map(l => <option key={l.id} value={l.id}>{l.name_en}{l.is_central ? ` (${t('common.kitchen')})` : ''}</option>)}
          </Select>
        ) : <b>{loc?.name_en}</b>}
        <div className="search grow">
          <Search size={18} aria-hidden />
          <Input type="search" placeholder={t('inv.search')} value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Segmented size="sm" value={groupBy} onChange={setGroupBy} options={[{ value: 'storage', label: t('inv.byStorage') }, { value: 'category', label: t('inv.byCategory') }]} />
        <label className="check"><input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} /> {t('inv.onlyUncounted')}</label>
        <Badge tone={countedN === items.length && items.length ? 'ok' : 'neutral'}>{t('inv.counted', { n: countedN, total: items.length })}</Badge>
        <Button size="sm" variant={adding ? 'primary' : 'secondary'} icon={<Plus size={16} />} onClick={() => setAdding(a => !a)}>{adding ? t('common.done') : t('inv.addItems')}</Button>
      </div>

      {adding && (
        <Card className="mb-3">
          <p className="muted small">{t('inv.addHint', { loc: loc?.name_en || '' })}</p>
          <div className="chips">
            {addable.slice(0, 80).map(c => (
              <button key={c.id} type="button" className="tally-chip add-chip" onClick={() => run(() => api.addToStockList(locId, c.id))}>+ {itemName(lang, c)}</button>
            ))}
            {!addable.length && <span className="muted small">{t('inv.allAdded')}</span>}
          </div>
        </Card>
      )}

      {stock.isPending || catalog.isPending ? <Skeleton rows={8} /> : !items.length ? (
        <Empty title={t('inv.emptyList', { loc: loc?.name_en || '' })}>{t('inv.emptyListHint')}</Empty>
      ) : (
        <div className="stack">
          {groups.map(([g, list]) => (
            <Card key={g} className="inv-group">
              <button type="button" className="group-head" onClick={() => setCollapsed(c => ({ ...c, [g]: !c[g] }))}>
                {collapsed[g] ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                <b>{g}</b>
                <span className="muted small">{list.filter(i => counted[i.spec.id]).length}/{list.length}</span>
              </button>
              {!collapsed[g] && list.map(i => {
                const exp = worstExpiry(i.batches)
                const low = isLow(i.qty, i.spec.reorder_level)
                const unit = i.spec.stock_unit || ''
                return (
                  <button type="button" key={i.spec.id} className={`inv-row${counted[i.spec.id] ? ' counted' : ''}`} onClick={() => setEditing(i.spec.id)}>
                    <span className="inv-check">{counted[i.spec.id] && <Check size={16} />}</span>
                    <span className="grow">
                      <span className="inv-name">{itemName(lang, i.spec)}</span>
                      <span className="row gap-1 wrap">
                        {low && <Badge tone="warn">{t('inv.low')}</Badge>}
                        {exp.level === 'expired' && <Badge tone="bad"><AlertTriangle size={12} /> {t('inv.expired')}</Badge>}
                        {(exp.level === 'soon' || exp.level === 'today') && <Badge tone="warn">{exp.level === 'today' ? t('inv.expToday') : t('inv.expDays', { n: exp.days ?? 0 })}</Badge>}
                      </span>
                    </span>
                    <span className="inv-qty">{num(i.qty)}<small> {unit}</small></span>
                    <span className="inv-content muted small">{contentTotal(i.qty, i.spec) || ''}</span>
                  </button>
                )
              })}
            </Card>
          ))}
        </div>
      )}

      {current && (
        <CountSheet
          item={current}
          locationId={locId}
          isCentral={!!loc?.is_central}
          locationName={loc?.name_en || ''}
          onClose={() => setEditing(null)}
          onCounted={id => setCounted(c => ({ ...c, [id]: true }))}
          invalidate={[key]}
        />
      )}
    </>
  )
}

function Overview() {
  const { t, lang } = useI18n()
  const locations = useLocations()
  const catalog = useCatalog()
  const all = useQuery({ queryKey: [...QK.stock, 'all'], queryFn: api.listAllStock })
  const [q, setQ] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)

  const sites = locations.data ?? []
  const byId = useMemo(() => new Map((catalog.data ?? []).map(c => [c.id, c])), [catalog.data])
  const rows = useMemo(() => {
    const m = new Map<string, Record<string, number>>()
    for (const r of all.data ?? []) {
      if (!m.has(r.catalog_item_id)) m.set(r.catalog_item_id, {})
      m.get(r.catalog_item_id)![r.location_id] = r.qty
    }
    return [...m.entries()].flatMap(([id, bySite]) => {
      const spec = byId.get(id)
      if (!spec) return []
      const total = Object.values(bySite).reduce((a, b) => a + b, 0)
      return [{ spec, bySite, total }]
    }).filter(r => matches([r.spec.name_en, r.spec.name_hu], q))
      .filter(r => !onlyLow || Object.values(r.bySite).some(v => isLow(v, r.spec.reorder_level)))
      .sort((a, b) => itemName(lang, a.spec).localeCompare(itemName(lang, b.spec)))
  }, [all.data, byId, q, onlyLow, lang])

  function exportCsv() {
    const name = new Map(sites.map(s => [s.id, s.name_en]))
    const flat = (all.data ?? []).flatMap(r => {
      const spec = byId.get(r.catalog_item_id) as CatalogItem | undefined
      return spec ? [{ loc: name.get(r.location_id) || '', en: spec.name_en, hu: spec.name_hu || '', qty: r.qty, unit: spec.stock_unit || '' }] : []
    }).sort((a, b) => a.loc.localeCompare(b.loc) || a.en.localeCompare(b.en))
    downloadCSV(`inventory-${todayISO()}`, [
      { label: 'Location', value: r => r.loc }, { label: 'Item (EN)', value: r => r.en }, { label: 'Item (HU)', value: r => r.hu },
      { label: 'Qty', value: r => r.qty }, { label: 'Unit', value: r => r.unit },
    ], flat)
  }

  return (
    <>
      <div className="toolbar wrap">
        <div className="search grow"><Search size={18} aria-hidden /><Input type="search" placeholder={t('inv.search')} value={q} onChange={e => setQ(e.target.value)} /></div>
        <label className="check"><input type="checkbox" checked={onlyLow} onChange={e => setOnlyLow(e.target.checked)} /> {t('inv.onlyLow')}</label>
        <Button size="sm" variant="ghost" icon={<Download size={16} />} onClick={exportCsv}>{t('common.exportCsv')}</Button>
      </div>
      {all.isPending ? <Skeleton rows={10} /> : !rows.length ? <Empty title={t('inv.noStock')} /> : (
        <div className="table-wrap">
          <table className="table matrix">
            <thead>
              <tr>
                <th>{t('common.item')}</th>
                {sites.map(s => <th key={s.id} className="num">{s.name_en}</th>)}
                <th className="num">{t('common.total')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.spec.id}>
                  <td>{itemName(lang, r.spec)} <span className="muted small">{r.spec.stock_unit}</span></td>
                  {sites.map(s => {
                    const v = r.bySite[s.id]
                    if (v == null) return <td key={s.id} className="num muted">·</td>
                    const low = isLow(v, r.spec.reorder_level)
                    return <td key={s.id} className={`num${low ? ' cell-low' : ''}${v === 0 ? ' muted' : ''}`}>{num(v)}</td>
                  })}
                  <td className="num"><b>{num(r.total)}</b> {contentTotal(r.total, r.spec) && <span className="muted small">· {contentTotal(r.total, r.spec)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
