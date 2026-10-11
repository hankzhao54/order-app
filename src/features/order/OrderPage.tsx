import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, RotateCcw, Search, Star, ShoppingBasket, X } from 'lucide-react'
import * as api from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useI18n, itemName, type Lang, type TFn } from '@/lib/i18n'
import { useCatalog, useCategories, useLocations } from '@/lib/refdata'
import { QK } from '@/lib/useAction'
import { useFeedback } from '@/ui/feedback'
import { Button, Empty, Input, PageHeader, Segmented, Select, Skeleton, Stepper } from '@/ui/primitives'
import { Sheet } from '@/ui/Sheet'
import { matches, num } from '@/lib/format'
import type { CatalogItem } from '@/lib/types'
import { useCart } from './useCart'
import { CartPanel, type TopUp } from './CartPanel'
import { MyOrders } from './MyOrders'

export default function OrderPage() {
  const { t, lang } = useI18n()
  const { locationId, can, userId, profile } = useAuth()
  const fb = useFeedback()
  const qc = useQueryClient()
  const anyLoc = can('order.anyLocation') || !locationId
  const locations = useLocations()
  const storeLocs = (locations.data ?? []).filter(l => !l.is_central || anyLoc)
  const [pickedLoc, setPickedLoc] = useState('')
  const locId = anyLoc ? (pickedLoc || locationId || storeLocs.find(l => !l.is_central)?.id || '') : (locationId || '')
  const locName = (locations.data ?? []).find(l => l.id === locId)?.name_en || profile?.location?.name_en || ''

  const [tab, setTab] = useState<'new' | 'mine'>('new')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({ __fav: true })
  const [cartOpen, setCartOpen] = useState(false)
  const [topUp, setTopUp] = useState<TopUp | null>(null)

  const cats = useCategories()
  const catalog = useCatalog()
  const favs = useQuery({ queryKey: ['favorites', userId], enabled: !!userId, queryFn: () => api.listFavorites(userId!) })
  const templates = useQuery({ queryKey: ['templates', locId], enabled: !!locId, queryFn: () => api.listTemplates(locId) })
  const cart = useCart(locId)

  const items = catalog.data ?? []
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const favSet = useMemo(() => new Set(favs.data ?? []), [favs.data])
  const byCat = useMemo(() => {
    const m = new Map<string, CatalogItem[]>()
    for (const it of items) {
      const k = it.category_id || 'none'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(it)
    }
    for (const list of m.values()) list.sort((a, b) => itemName(lang, a).localeCompare(itemName(lang, b)))
    return m
  }, [items, lang])
  const hits = q.trim() ? items.filter(i => matches([i.name_en, i.name_hu], q)) : null
  const favItems = (favs.data ?? []).map(id => byId.get(id)).filter(Boolean) as CatalogItem[]

  async function toggleFav(id: string) {
    if (!userId) return
    const on = !favSet.has(id)
    qc.setQueryData<string[]>(['favorites', userId], old => on ? [...(old ?? []), id] : (old ?? []).filter(x => x !== id))
    try { await api.setFavorite(userId, id, on) } catch (e) { fb.error(e); qc.invalidateQueries({ queryKey: ['favorites', userId] }) }
  }

  async function repeatLast() {
    if (!locId) return
    try {
      const last = await api.lastOrderLines(locId)
      const next: Record<string, number> = {}
      for (const it of last?.items ?? []) if (it.catalog_item_id && byId.has(it.catalog_item_id)) next[it.catalog_item_id] = (next[it.catalog_item_id] || 0) + Number(it.quantity)
      if (!Object.keys(next).length) { fb.toast(t('order.noLast')); return }
      cart.replaceLines(next)
      fb.ok(t('order.loadedLast'))
    } catch (e) { fb.error(e) }
  }

  function loadTemplate(tpl: api.Template) {
    const next: Record<string, number> = {}
    for (const it of tpl.items) if (it.catalog_item_id && byId.has(it.catalog_item_id)) next[it.catalog_item_id] = Number(it.default_qty)
    cart.replaceLines(next)
    fb.ok(t('order.loadedTemplate', { name: tpl.name }))
  }

  const rowProps = (it: CatalogItem): ItemRowProps => ({
    it, lang, t, qty: cart.cart.lines[it.id] || 0, fav: favSet.has(it.id),
    onFav: toggleFav, onQty: cart.setQty, onAdd: cart.add,
  })
  const drawer = (id: string, title: string, list: CatalogItem[]) => (
    <section className="drawer" key={id}>
      <button type="button" className="drawer-head" aria-expanded={!!open[id]} onClick={() => setOpen(o => ({ ...o, [id]: !o[id] }))}>
        {open[id] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        <span className="drawer-title">{title}</span>
        <span className="muted small">{list.length}</span>
        {list.some(i => cart.cart.lines[i.id]) && <span className="dot" aria-hidden />}
      </button>
      {open[id] && <div className="drawer-body">{list.map(it => <ItemRow key={it.id} {...rowProps(it)} />)}</div>}
    </section>
  )

  const catList = cats.data ?? []
  const uncategorized = byCat.get('none') ?? []

  const panel = (
    <CartPanel
      cart={cart}
      byId={byId}
      locationId={locId}
      topUp={topUp}
      onCancelTopUp={() => setTopUp(null)}
      onSubmitted={() => { setTopUp(null); setCartOpen(false); qc.invalidateQueries({ queryKey: QK.orders }) }}
      onTemplateSaved={() => qc.invalidateQueries({ queryKey: ['templates', locId] })}
    />
  )

  return (
    <div className="page page-order">
      <PageHeader
        title={t('order.title')}
        subtitle={anyLoc ? undefined : locName}
        actions={
          <>
            {anyLoc && (
              <Select value={locId} onChange={e => { setPickedLoc(e.target.value); setTopUp(null) }} aria-label={t('common.location')}>
                {storeLocs.map(l => <option key={l.id} value={l.id}>{l.name_en}{l.is_central ? ` (${t('common.kitchen')})` : ''}</option>)}
              </Select>
            )}
            <Segmented value={tab} onChange={setTab} options={[{ value: 'new', label: t('order.tabNew') }, { value: 'mine', label: t('order.tabMine') }]} />
          </>
        }
      />

      {tab === 'mine' ? (
        <MyOrders locationId={locId} onTopUp={o => { setTopUp(o); setTab('new') }} />
      ) : (
        <div className="order-layout">
          <div className="order-browse">
            {topUp && (
              <div className="note note-info row">
                <span>{t('order.topUpBanner', { label: topUp.label })}</span>
                <Button size="sm" variant="ghost" icon={<X size={16} />} onClick={() => setTopUp(null)}>{t('common.cancel')}</Button>
              </div>
            )}
            <div className="search">
              <Search size={18} aria-hidden />
              <Input type="search" placeholder={t('order.search')} value={q} onChange={e => setQ(e.target.value)} />
            </div>

            {catalog.isPending ? <Skeleton rows={8} /> : hits ? (
              <section className="drawer">
                <div className="drawer-head static"><span className="drawer-title">{t('order.results', { n: hits.length })}</span></div>
                <div className="drawer-body">{hits.map(it => <ItemRow key={it.id} {...rowProps(it)} />)}</div>
                {!hits.length && <Empty title={t('order.noResults')}>{t('order.noResultsHint')}</Empty>}
              </section>
            ) : (
              <>
                <div className="quick">
                  <Button size="sm" icon={<RotateCcw size={16} />} onClick={repeatLast}>{t('order.repeatLast')}</Button>
                  {(templates.data ?? []).map(tpl => (
                    <Button key={tpl.id} size="sm" variant="ghost" className="chip-btn" onClick={() => loadTemplate(tpl)}>{tpl.name}</Button>
                  ))}
                </div>
                <section className="drawer">
                  <button type="button" className="drawer-head" aria-expanded={!!open.__fav} onClick={() => setOpen(o => ({ ...o, __fav: !o.__fav }))}>
                    {open.__fav ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    <Star size={16} className="text-warn" fill="currentColor" />
                    <span className="drawer-title">{t('order.favorites')}</span>
                    <span className="muted small">{favItems.length}</span>
                  </button>
                  {open.__fav && (
                    <div className="drawer-body">
                      {favItems.length ? favItems.map(it => <ItemRow key={it.id} {...rowProps(it)} />) : <p className="muted pad">{t('order.favHint')}</p>}
                    </div>
                  )}
                </section>
                {catList.map(c => {
                  const list = byCat.get(c.id) ?? []
                  return list.length ? drawer(c.id, lang === 'hu' && c.name_hu ? c.name_hu : c.name_en, list) : null
                })}
                {uncategorized.length > 0 && drawer('none', t('order.uncategorized'), uncategorized)}
              </>
            )}
          </div>

          <aside className="order-cart desktop-only">{panel}</aside>
        </div>
      )}

      {tab === 'new' && (
        <>
          <div className="cart-bar mobile-only">
            <Button variant="primary" size="lg" block icon={<ShoppingBasket size={18} />} onClick={() => setCartOpen(true)}>
              {cart.count ? t('order.viewCart', { n: cart.count }) : t('order.cartEmpty')}
            </Button>
          </div>
          <Sheet open={cartOpen} onClose={() => setCartOpen(false)} title={`${t('order.cart')} · ${num(cart.count)}`} size="lg">
            {panel}
          </Sheet>
        </>
      )}
    </div>
  )
}

interface ItemRowProps {
  it: CatalogItem; lang: Lang; t: TFn; qty: number; fav: boolean
  onFav: (id: string) => void; onQty: (id: string, q: number) => void; onAdd: (id: string) => void
}

function ItemRow({ it, lang, t, qty, fav, onFav, onQty, onAdd }: ItemRowProps) {
  const unit = it.order_unit || it.stock_unit || ''
  const alt = lang === 'hu' ? (it.name_hu ? it.name_en : '') : it.name_hu
  return (
    <div className={`item-row${qty ? ' in-cart' : ''}`}>
      <button type="button" className={`fav${fav ? ' on' : ''}`} aria-label={t('order.favorite')} aria-pressed={fav} onClick={() => onFav(it.id)}>
        <Star size={18} fill={fav ? 'currentColor' : 'none'} />
      </button>
      <button type="button" className="item-main" onClick={() => !qty && onAdd(it.id)}>
        <span className="item-name">{itemName(lang, it)}{unit && <span className="item-unit"> / {unit}</span>}</span>
        {alt && <span className="item-alt">{alt}</span>}
      </button>
      {qty ? (
        <Stepper value={qty} onChange={v => onQty(it.id, v)} unit={unit} size="sm" label={itemName(lang, it)} />
      ) : (
        <Button size="sm" onClick={() => onAdd(it.id)}>{t('order.add')}</Button>
      )}
    </div>
  )
}
