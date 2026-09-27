import { useMemo } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import * as api from '@/lib/api'
import { useI18n, itemName } from '@/lib/i18n'
import { useCatalog, useLocations } from '@/lib/refdata'
import { useLiveQueries } from '@/lib/query'
import { QK } from '@/lib/useAction'
import { expiryInfo, isLow } from '@/lib/inventory'
import { thisMonday, zonedMidnightISO } from '@/lib/dates'
import { fmtDuration, num } from '@/lib/format'
import { isHandled, isReadyToDispatch } from '@/lib/status'
import { Card, PageHeader, Skeleton, Stat } from '@/ui/primitives'
import { NavIcon } from '@/ui/Icon'

export default function DashboardPage() {
  const { t, lang } = useI18n()
  const orders = useQuery({ queryKey: [...QK.orders, 'dash'], queryFn: () => api.listOrders({ statuses: ['submitted', 'in_progress', 'completed'], ascending: true, limit: 500 }) })
  const weekOrders = useQuery({ queryKey: [...QK.orders, 'dash-week'], queryFn: () => api.listOrders({ from: zonedMidnightISO(thisMonday()), limit: 500 }) })
  const buy = useQuery({ queryKey: [...QK.buy, 'dash'], queryFn: api.listBuyPending })
  const stock = useQuery({ queryKey: [...QK.stock, 'all'], queryFn: api.listAllStock })
  const batches = useQuery({ queryKey: [...QK.stock, 'expiring'], queryFn: api.listExpiringBatches })
  const locations = useLocations()
  const catalog = useCatalog()
  useLiveQueries(['orders', 'order_items', 'procurement_tasks'], [QK.orders, QK.buy])

  const d = useMemo(() => {
    const os = orders.data ?? []
    const lines = os.flatMap(o => o.items)
    const locs = locations.data ?? []
    const cat = new Map((catalog.data ?? []).map(c => [c.id, c]))
    const locName = new Map(locs.map(l => [l.id, l.name_en]))
    const done = os.filter(o => o.completed_at)
    const avg = done.length ? done.reduce((a, o) => a + (Date.parse(o.completed_at!) - Date.parse(o.created_at)), 0) / done.length : null
    const orderedThisWeek = new Set((weekOrders.data ?? []).filter(o => o.status !== 'cancelled').map(o => o.location_id))
    const notOrdered = locs.filter(l => !l.is_central && !orderedThisWeek.has(l.id))
    const low = (stock.data ?? []).flatMap(r => {
      const spec = cat.get(r.catalog_item_id)
      return spec && isLow(r.qty, spec.reorder_level) ? [{ name: itemName(lang, spec), loc: locName.get(r.location_id) || '', qty: r.qty }] : []
    })
    const exp = (batches.data ?? []).map(b => ({ name: b.item?.name_en || '', loc: b.loc?.name_en || '', qty: Number(b.qty), e: expiryInfo(b.expires_on) }))
      .filter(b => b.e.level === 'expired' || b.e.level === 'today' || b.e.level === 'soon')
    const perStore = locs.filter(l => !l.is_central).map(l => {
      const ls = os.filter(o => o.location_id === l.id).flatMap(o => o.items)
      return { id: l.id, name: l.name_en, total: ls.length, done: ls.filter(i => isHandled(i.dispatch_status)).length, orders: os.filter(o => o.location_id === l.id).length }
    })
    return {
      toHandle: lines.filter(i => i.dispatch_status === 'pending').length,
      ready: lines.filter(i => isReadyToDispatch(i.dispatch_status)).length,
      unavailable: lines.filter(i => i.dispatch_status === 'unavailable'),
      openOrders: os.filter(o => o.status !== 'completed').length,
      avg, notOrdered, low, expired: exp.filter(b => b.e.level === 'expired'), soon: exp.filter(b => b.e.level !== 'expired'), perStore,
    }
  }, [orders.data, weekOrders.data, stock.data, batches.data, locations.data, catalog.data, lang])

  if (orders.isPending) return <div className="page"><Skeleton variant="cards" rows={4} /></div>

  const attention = [
    d.expired.length > 0 && { tone: 'bad', title: t('dash.expired', { n: d.expired.length }), chips: d.expired.map(b => `${b.name} · ${b.loc} (${num(b.qty)})`) },
    d.soon.length > 0 && { tone: 'warn', title: t('dash.expiring', { n: d.soon.length }), chips: d.soon.map(b => `${b.name} · ${b.loc} (${b.e.days}d)`) },
    d.notOrdered.length > 0 && { tone: 'info', title: t('dash.notOrdered', { n: d.notOrdered.length }), chips: d.notOrdered.map(l => l.name_en) },
    d.low.length > 0 && { tone: 'warn', title: t('dash.low', { n: d.low.length }), chips: d.low.map(r => `${r.name} · ${r.loc} (${num(r.qty)})`) },
    d.unavailable.length > 0 && { tone: 'bad', title: t('dash.unavailable', { n: d.unavailable.length }), chips: d.unavailable.map(i => i.item_name_snapshot) },
  ].filter(Boolean) as { tone: string; title: string; chips: string[] }[]

  return (
    <div className="page">
      <PageHeader title={t('dash.title')} />
      {attention.length ? (
        <Card className="attention">
          <h3 className="card-title"><AlertTriangle size={18} /> {t('dash.attention')}</h3>
          {attention.map(a => (
            <div key={a.title} className="att-block">
              <b>{a.title}</b>
              <div className="chips">
                {a.chips.slice(0, 14).map((c, i) => <span key={i} className={`tally-chip tone-edge-${a.tone}`}>{c}</span>)}
                {a.chips.length > 14 && <span className="muted small">+{a.chips.length - 14}</span>}
              </div>
            </div>
          ))}
        </Card>
      ) : (
        <div className="note note-ok"><CheckCircle2 size={18} /> {t('dash.allClear')}</div>
      )}

      <div className="stats">
        <Stat tone={d.toHandle ? 'warn' : 'neutral'} value={d.toHandle} label={t('dash.toHandle')} />
        <Stat tone={d.ready ? 'ok' : 'neutral'} value={d.ready} label={t('dash.ready')} />
        <Stat tone={(buy.data ?? []).length ? 'buy' : 'neutral'} value={(buy.data ?? []).length} label={t('dash.onBuyList')} />
        <Stat value={d.openOrders} label={t('dash.openOrders')} />
        <Stat value={d.avg != null ? fmtDuration(d.avg) : '—'} label={t('dash.avgTime')} />
      </div>

      <Card>
        <h3 className="card-title">{t('dash.byStore')}</h3>
        {d.perStore.map(s => (
          <div key={s.id} className="store-progress">
            <span className="grow">{s.name}</span>
            <span className="muted small">{t('kitchen.nOrders', { n: s.orders })}</span>
            <div className="bar wide"><div style={{ width: `${s.total ? (s.done / s.total) * 100 : 0}%` }} /></div>
            <span className="mono small">{s.done}/{s.total}</span>
          </div>
        ))}
      </Card>

      <div className="quick-links">
        {[['/kitchen', 'kitchen', 'nav.kitchen'], ['/dispatch', 'dispatch', 'nav.dispatch'], ['/buy', 'buy', 'nav.buy'], ['/inventory', 'inventory', 'nav.inventory'], ['/reports', 'reports', 'nav.reports'], ['/history', 'history', 'nav.history']].map(([to, icon, key]) => (
          <Link key={to} to={to} className="quick-link"><NavIcon name={icon} size={22} /><span>{t(key as 'nav.kitchen')}</span></Link>
        ))}
      </div>
    </div>
  )
}
