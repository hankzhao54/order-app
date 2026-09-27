import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChefHat, Plus, Search, ShoppingCart, Trash2 } from 'lucide-react'
import * as api from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useI18n, itemName } from '@/lib/i18n'
import { QK, useAction } from '@/lib/useAction'
import { fmtDate, matches, num } from '@/lib/format'
import { todayISO } from '@/lib/dates'
import { useFeedback } from '@/ui/feedback'
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Segmented, Select, Skeleton } from '@/ui/primitives'
import { Sheet } from '@/ui/Sheet'
import { BlurInput } from '@/ui/BlurInput'
import type { CatalogItem, Category } from '@/lib/types'

const ADMIN_KEYS = { items: [...QK.catalog, 'all'], cats: [...QK.categories, 'all'] }

export default function CatalogPage() {
  const { t } = useI18n()
  const [tab, setTab] = useState<'items' | 'categories'>('items')
  const items = useQuery({ queryKey: ADMIN_KEYS.items, queryFn: () => api.listCatalog({ includeInactive: true }) })
  const cats = useQuery({ queryKey: ADMIN_KEYS.cats, queryFn: () => api.listCategories({ includeInactive: true }) })
  return (
    <div className="page">
      <PageHeader title={t('cat.title')} actions={
        <Segmented value={tab} onChange={setTab} options={[
          { value: 'items', label: t('cat.items'), count: items.data?.length },
          { value: 'categories', label: t('cat.categories'), count: cats.data?.length },
        ]} />
      } />
      {items.isPending || cats.isPending ? <Skeleton rows={10} /> : tab === 'items'
        ? <Items items={items.data ?? []} cats={cats.data ?? []} />
        : <Categories cats={cats.data ?? []} />}
    </div>
  )
}

function Items({ items, cats }: { items: CatalogItem[]; cats: Category[] }) {
  const { t, lang } = useI18n()
  const [q, setQ] = useState('')
  const [fCat, setFCat] = useState('')
  const [fActive, setFActive] = useState<'active' | 'inactive' | 'all'>('active')
  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null)
  const catName = useMemo(() => new Map(cats.map(c => [c.id, c.name_en])), [cats])
  const list = items
    .filter(i => matches([i.name_en, i.name_hu], q))
    .filter(i => !fCat || i.category_id === fCat)
    .filter(i => fActive === 'all' || (fActive === 'active' ? i.is_active : !i.is_active))

  return (
    <>
      <div className="toolbar wrap">
        <div className="search grow"><Search size={18} aria-hidden /><Input type="search" placeholder={t('inv.search')} value={q} onChange={e => setQ(e.target.value)} /></div>
        <Select value={fCat} onChange={e => setFCat(e.target.value)}>
          <option value="">{t('cat.allCategories')}</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.name_en}</option>)}
        </Select>
        <Segmented size="sm" value={fActive} onChange={setFActive} options={[{ value: 'active', label: t('cat.active') }, { value: 'inactive', label: t('cat.inactive') }, { value: 'all', label: t('cat.all') }]} />
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>{t('cat.addItem')}</Button>
      </div>
      {!list.length ? <Empty title={t('order.noResults')} /> : (
        <Card className="table-wrap">
          <table className="table clickable">
            <thead><tr><th>{t('common.item')}</th><th>{t('cat.category')}</th><th>{t('cat.makeBuy')}</th><th>{t('cat.orderUnit')}</th><th>{t('cat.specs')}</th><th /></tr></thead>
            <tbody>
              {list.map(i => (
                <tr key={i.id} onClick={() => setEditing(i)} className={i.is_active ? '' : 'row-muted'}>
                  <td><b>{itemName(lang, i)}</b>{i.name_hu && lang !== 'hu' && <div className="muted small">{i.name_hu}</div>}</td>
                  <td>{(i.category_id && catName.get(i.category_id)) || <span className="muted">—</span>}</td>
                  <td>{i.default_fulfillment === 'make' ? <Badge tone="ok"><ChefHat size={12} /> {t('cat.make')}</Badge> : i.default_fulfillment === 'purchase' ? <Badge tone="buy"><ShoppingCart size={12} /> {t('cat.buy')}</Badge> : <Badge tone="warn">?</Badge>}</td>
                  <td>{i.order_unit || <span className="muted">—</span>}</td>
                  <td className="muted small">
                    {[i.shelf_life_days != null && t('cat.shelfShort', { n: i.shelf_life_days }), i.storage_location, i.reorder_level != null && `≤ ${num(i.reorder_level)}`].filter(Boolean).join(' · ')}
                  </td>
                  <td>{!i.is_active && <Badge>{t('cat.inactive')}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {editing && <ItemSheet item={editing === 'new' ? null : editing} cats={cats} onClose={() => setEditing(null)} />}
    </>
  )
}

type Draft = {
  name_en: string; name_hu: string; category_id: string; default_fulfillment: '' | 'make' | 'purchase'; order_unit: string
  stock_unit: string; unit_weight: string; weight_unit: string; batch_yield_qty: string; batch_yield_unit: string
  shelf_life_days: string; storage_location: string; reorder_level: string; vacuum_level: string; is_active: boolean
}

const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
const strOrNull = (s: string) => (s.trim() === '' ? null : s.trim())

function ItemSheet({ item, cats, onClose }: { item: CatalogItem | null; cats: Category[]; onClose: () => void }) {
  const { t } = useI18n()
  const { can } = useAuth()
  const fb = useFeedback()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [d, setD] = useState<Draft>(() => ({
    name_en: item?.name_en ?? '', name_hu: item?.name_hu ?? '', category_id: item?.category_id ?? '',
    default_fulfillment: item?.default_fulfillment ?? '', order_unit: item?.order_unit ?? '', stock_unit: item?.stock_unit ?? '',
    unit_weight: item?.unit_weight != null ? String(item.unit_weight) : '', weight_unit: item?.weight_unit ?? 'g',
    batch_yield_qty: item?.batch_yield_qty != null ? String(item.batch_yield_qty) : '', batch_yield_unit: item?.batch_yield_unit ?? '',
    shelf_life_days: item?.shelf_life_days != null ? String(item.shelf_life_days) : '', storage_location: item?.storage_location ?? '',
    reorder_level: item?.reorder_level != null ? String(item.reorder_level) : '', vacuum_level: item?.vacuum_level ?? '',
    is_active: item?.is_active ?? true,
  }))
  const set = (patch: Partial<Draft>) => setD(x => ({ ...x, ...patch }))

  async function save() {
    if (!d.name_en.trim()) { fb.toast(t('cat.nameRequired'), 'bad'); return }
    const row = {
      name_en: d.name_en.trim(), name_hu: strOrNull(d.name_hu), category_id: d.category_id || null,
      default_fulfillment: d.default_fulfillment || null, order_unit: strOrNull(d.order_unit), stock_unit: strOrNull(d.stock_unit),
      unit_weight: numOrNull(d.unit_weight), weight_unit: d.weight_unit || null, batch_yield_qty: numOrNull(d.batch_yield_qty),
      batch_yield_unit: strOrNull(d.batch_yield_unit), shelf_life_days: numOrNull(d.shelf_life_days),
      storage_location: strOrNull(d.storage_location), reorder_level: numOrNull(d.reorder_level), vacuum_level: strOrNull(d.vacuum_level),
      is_active: d.is_active,
    }
    setBusy(true)
    try {
      if (item) await api.updateCatalogItem(item.id, row)
      else await api.createCatalogItem(row)
      fb.ok(t('common.saved'))
      qc.invalidateQueries({ queryKey: QK.catalog })
      onClose()
    } catch (e) { fb.error(e) } finally { setBusy(false) }
  }

  return (
    <Sheet open onClose={onClose} size="lg" title={item ? item.name_en : t('cat.addItem')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={save}>{t('common.save')}</Button></>}>
      <div className="form-grid">
        <Field label={t('cat.nameEn')}><Input value={d.name_en} onChange={e => set({ name_en: e.target.value })} autoFocus={!item} /></Field>
        <Field label={t('cat.nameHu')}><Input value={d.name_hu} onChange={e => set({ name_hu: e.target.value })} /></Field>
        <Field label={t('cat.category')}>
          <Select value={d.category_id} onChange={e => set({ category_id: e.target.value })}>
            <option value="">—</option>
            {cats.map(c => <option key={c.id} value={c.id}>{c.name_en}</option>)}
          </Select>
        </Field>
        <Field label={t('cat.makeBuy')} hint={t('cat.makeBuyHint')}>
          <Segmented size="sm" value={d.default_fulfillment || 'none'} onChange={v => set({ default_fulfillment: v === 'none' ? '' : v as 'make' | 'purchase' })}
            options={[{ value: 'make', label: t('cat.make') }, { value: 'purchase', label: t('cat.buy') }, { value: 'none', label: '—' }]} />
        </Field>
        <Field label={t('cat.orderUnit')} hint={t('cat.orderUnitHint')}><Input value={d.order_unit} onChange={e => set({ order_unit: e.target.value })} /></Field>
        <Field label={t('cat.stockUnit')}><Input value={d.stock_unit} onChange={e => set({ stock_unit: e.target.value })} /></Field>
        <Field label={t('cat.perUnit')}>
          <div className="row gap-1">
            <Input inputMode="decimal" value={d.unit_weight} onChange={e => set({ unit_weight: e.target.value })} />
            <Select value={d.weight_unit} onChange={e => set({ weight_unit: e.target.value })}><option value="g">g</option><option value="kg">kg</option><option value="pcs">pcs</option></Select>
          </div>
        </Field>
        <Field label={t('cat.batchYield')}>
          <div className="row gap-1">
            <Input inputMode="decimal" value={d.batch_yield_qty} onChange={e => set({ batch_yield_qty: e.target.value })} />
            <Input placeholder={t('common.unit')} value={d.batch_yield_unit} onChange={e => set({ batch_yield_unit: e.target.value })} />
          </div>
        </Field>
        <Field label={t('cat.shelfLife')}><Input inputMode="numeric" value={d.shelf_life_days} onChange={e => set({ shelf_life_days: e.target.value })} /></Field>
        <Field label={t('cat.storage')}><Input value={d.storage_location} onChange={e => set({ storage_location: e.target.value })} /></Field>
        <Field label={t('cat.reorder')} hint={t('cat.reorderHint')}><Input inputMode="decimal" value={d.reorder_level} onChange={e => set({ reorder_level: e.target.value })} /></Field>
        <Field label={t('cat.vacuum')}><Input placeholder="P0–P7" value={d.vacuum_level} onChange={e => set({ vacuum_level: e.target.value })} /></Field>
        <label className="check span-2"><input type="checkbox" checked={d.is_active} onChange={e => set({ is_active: e.target.checked })} /> {t('cat.activeHint')}</label>
      </div>
      {item && can('catalog.prices') && <Prices item={item} />}
    </Sheet>
  )
}

function Prices({ item }: { item: CatalogItem }) {
  const { t } = useI18n()
  const fb = useFeedback()
  const key = ['prices', item.id]
  const prices = useQuery({ queryKey: key, queryFn: () => api.listPrices(item.id) })
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: api.listSuppliers })
  const { run, isBusy } = useAction([key, ['rep', 'prices']])
  const [f, setF] = useState({ supplier_id: '', price: '', pack_qty: '', pack_unit: '', effective_date: todayISO() })

  async function add() {
    const price = Number(f.price.replace(',', '.'))
    if (!(price > 0)) { fb.toast(t('cat.priceRequired'), 'bad'); return }
    const r = await run(() => api.addPrice({
      catalog_item_id: item.id, supplier_id: f.supplier_id || null, price, currency: 'HUF',
      pack_qty: numOrNull(f.pack_qty), pack_unit: strOrNull(f.pack_unit), effective_date: f.effective_date,
    }), { id: 'add' })
    if (r !== undefined) {
      api.logAudit('price.update', item.name_en, { price, supplier_id: f.supplier_id || null })
      setF({ supplier_id: '', price: '', pack_qty: '', pack_unit: '', effective_date: todayISO() })
    }
  }

  return (
    <div className="sub-section">
      <h4>{t('cat.prices')}</h4>
      <div className="price-add">
        <Select value={f.supplier_id} onChange={e => setF({ ...f, supplier_id: e.target.value })}>
          <option value="">{t('rep.supplier')}…</option>
          {(suppliers.data ?? []).filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Input inputMode="decimal" placeholder="HUF" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} />
        <Input inputMode="decimal" placeholder={t('cat.packQty')} value={f.pack_qty} onChange={e => setF({ ...f, pack_qty: e.target.value })} />
        <Input placeholder={t('common.unit')} value={f.pack_unit} onChange={e => setF({ ...f, pack_unit: e.target.value })} />
        <Input type="date" value={f.effective_date} onChange={e => setF({ ...f, effective_date: e.target.value })} />
        <Button variant="primary" loading={isBusy('add')} onClick={add}>{t('common.add')}</Button>
      </div>
      {!(prices.data ?? []).length ? <p className="muted small">{t('cat.noPrices')}</p> : (
        <table className="table compact">
          <thead><tr><th>{t('cat.date')}</th><th>{t('rep.supplier')}</th><th className="num">{t('cat.price')}</th><th className="num">{t('cat.unitPrice')}</th><th /></tr></thead>
          <tbody>
            {(prices.data ?? []).map((p, i) => (
              <tr key={p.id} className={i === 0 ? 'row-hl' : ''}>
                <td>{fmtDate(p.effective_date)}</td>
                <td>{p.supplier?.name || '—'}</td>
                <td className="num">{num(p.price)} {p.currency}{p.pack_qty ? ` / ${num(p.pack_qty)} ${p.pack_unit || ''}` : ''}</td>
                <td className="num">{p.pack_qty ? `${(Number(p.price) / Number(p.pack_qty)).toFixed(1)} / ${p.pack_unit || t('common.unit')}` : '—'}</td>
                <td><Button size="sm" variant="ghost" aria-label={t('common.remove')} icon={<Trash2 size={14} />} loading={isBusy(p.id)} onClick={() => run(() => api.deletePrice(p.id), { id: p.id })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Categories({ cats }: { cats: Category[] }) {
  const { t } = useI18n()
  const fb = useFeedback()
  const { run } = useAction([QK.categories])
  const [nameEn, setNameEn] = useState('')
  const [nameHu, setNameHu] = useState('')

  async function add() {
    if (!nameEn.trim()) return
    const sort = cats.reduce((m, c) => Math.max(m, c.sort_order || 0), 0) + 10
    const r = await run(() => api.createCategory({ name_en: nameEn.trim(), name_hu: strOrNull(nameHu), sort_order: sort }))
    if (r !== undefined) { setNameEn(''); setNameHu('') }
  }
  const patch = (id: string, p: Parameters<typeof api.updateCategory>[1]) => run(() => api.updateCategory(id, p))

  return (
    <>
      <Card className="mb-3">
        <div className="row gap-1 wrap">
          <Input placeholder={t('cat.nameEn')} value={nameEn} onChange={e => setNameEn(e.target.value)} />
          <Input placeholder={t('cat.nameHu')} value={nameHu} onChange={e => setNameHu(e.target.value)} />
          <Button variant="primary" icon={<Plus size={16} />} disabled={!nameEn.trim()} onClick={add}>{t('cat.addCategory')}</Button>
        </div>
      </Card>
      <Card className="table-wrap">
        <table className="table">
          <thead><tr><th className="w-sm">{t('cat.sort')}</th><th>{t('cat.nameEn')}</th><th>{t('cat.nameHu')}</th><th className="w-sm">{t('cat.active')}</th></tr></thead>
          <tbody>
            {cats.map(c => (
              <tr key={c.id} className={c.is_active ? '' : 'row-muted'}>
                <td><BlurInput className="w-qty" value={String(c.sort_order ?? 0)} onCommit={v => patch(c.id, { sort_order: Number(v) || 0 })} /></td>
                <td><BlurInput value={c.name_en} onCommit={v => v.trim() ? patch(c.id, { name_en: v.trim() }) : fb.toast(t('cat.nameRequired'), 'bad')} /></td>
                <td><BlurInput value={c.name_hu || ''} onCommit={v => patch(c.id, { name_hu: strOrNull(v) })} /></td>
                <td><input type="checkbox" checked={c.is_active} onChange={e => patch(c.id, { is_active: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="muted small">{t('cat.categoriesFoot')}</p>
    </>
  )
}
