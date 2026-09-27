import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import * as api from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import type { MessageKey } from '@/lib/i18n/en'
import { useLocations } from '@/lib/refdata'
import { addDays, thisMonday, todayISO, zonedMidnightISO } from '@/lib/dates'
import { fmtDate, fmtDateTime, num, qtyUnit } from '@/lib/format'
import { downloadCSV } from '@/lib/csv'
import { LINE_TONE, ORDER_TONE, TYPE_TONE } from '@/lib/status'
import { Badge, Button, Card, Empty, Input, PageHeader, Segmented, Select, Skeleton } from '@/ui/primitives'

type Tab = 'orders' | 'deliveries' | 'buy'

export default function HistoryPage() {
  const { t } = useI18n()
  const { can, locationId } = useAuth()
  const seesAll = can('history.all')
  const locations = useLocations()
  const [mode, setMode] = useState<'week' | 'range'>('week')
  const [week, setWeek] = useState(thisMonday())
  const [from, setFrom] = useState(addDays(todayISO(), -30))
  const [to, setTo] = useState(todayISO())
  const [tab, setTab] = useState<Tab>('orders')
  const [loc, setLoc] = useState('')
  const effLoc = seesAll ? loc || null : locationId

  const range = useMemo(() => mode === 'week'
    ? { from: zonedMidnightISO(week), to: zonedMidnightISO(addDays(week, 7)) }
    : { from: zonedMidnightISO(from), to: zonedMidnightISO(addDays(to, 1)) }, [mode, week, from, to])

  const orders = useQuery({ queryKey: ['history', 'orders', range, effLoc], enabled: tab === 'orders', queryFn: () => api.listOrders({ ...range, locationId: effLoc, limit: 1000 }) })
  const deliveries = useQuery({ queryKey: ['history', 'del', range, effLoc], enabled: tab === 'deliveries', queryFn: () => api.listDispatched({ ...range, locationId: effLoc }) })
  const tasks = useQuery({ queryKey: ['history', 'buy', range, effLoc], enabled: tab === 'buy', queryFn: () => api.listTasksInRange({ ...range, locationId: effLoc }) })
  const current = tab === 'orders' ? orders : tab === 'deliveries' ? deliveries : tasks

  function exportCsv() {
    const stamp = mode === 'week' ? week : `${from}_${to}`
    if (tab === 'orders') {
      const rows = (orders.data ?? []).flatMap(o => o.items.map(i => ({ o, i })))
      downloadCSV(`orders_${stamp}`, [
        { label: 'Date', value: r => r.o.created_at.slice(0, 10) }, { label: 'Location', value: r => r.o.location?.name_en },
        { label: 'Type', value: r => r.o.order_type }, { label: 'Order status', value: r => r.o.status },
        { label: 'Item', value: r => r.i.item_name_snapshot }, { label: 'Qty', value: r => r.i.quantity },
        { label: 'Fulfilled', value: r => r.i.fulfilled_qty }, { label: 'Unit', value: r => r.i.unit_snapshot },
        { label: 'Make/Buy', value: r => r.i.fulfillment_type }, { label: 'Line status', value: r => r.i.dispatch_status },
      ], rows)
    } else if (tab === 'deliveries') {
      downloadCSV(`deliveries_${stamp}`, [
        { label: 'Dispatched', value: r => r.dispatched_at }, { label: 'Location', value: r => r.order?.location?.name_en },
        { label: 'Item', value: r => r.item_name_snapshot }, { label: 'Qty', value: r => r.fulfilled_qty ?? r.quantity },
        { label: 'Unit', value: r => r.unit_snapshot }, { label: 'Make/Buy', value: r => r.fulfillment_type }, { label: 'Status', value: r => r.dispatch_status },
      ], deliveries.data ?? [])
    } else {
      downloadCSV(`buylist_${stamp}`, [
        { label: 'Created', value: r => r.created_at }, { label: 'Deliver to', value: r => r.target?.name_en },
        { label: 'Item', value: r => r.item_name }, { label: 'Qty', value: r => r.quantity }, { label: 'Unit', value: r => r.unit },
        { label: 'Status', value: r => r.status }, { label: 'Bought at', value: r => r.bought_at }, { label: 'Reason', value: r => r.unavail_reason },
      ], tasks.data ?? [])
    }
  }

  const count = (current.data as unknown[] | undefined)?.length ?? 0

  return (
    <div className="page">
      <PageHeader title={t('hist.title')} />
      <div className="toolbar wrap">
        <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'week', label: t('hist.byWeek') }, { value: 'range', label: t('hist.range') }]} />
        {mode === 'week' ? (
          <div className="row gap-1">
            <Button size="sm" variant="ghost" aria-label="‹" icon={<ChevronLeft size={16} />} onClick={() => setWeek(w => addDays(w, -7))} />
            <b className="nowrap">{fmtDate(week)} – {fmtDate(addDays(week, 6))}</b>
            <Button size="sm" variant="ghost" aria-label="›" icon={<ChevronRight size={16} />} onClick={() => setWeek(w => addDays(w, 7))} />
            {week !== thisMonday() && <Button size="sm" variant="ghost" onClick={() => setWeek(thisMonday())}>{t('hist.thisWeek')}</Button>}
          </div>
        ) : (
          <div className="row gap-1">
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
            <span className="muted">→</span>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
        )}
        {seesAll && (
          <Select value={loc} onChange={e => setLoc(e.target.value)} aria-label={t('common.location')}>
            <option value="">{t('hist.allLocations')}</option>
            {(locations.data ?? []).map(l => <option key={l.id} value={l.id}>{l.name_en}</option>)}
          </Select>
        )}
      </div>
      <div className="toolbar">
        <Segmented value={tab} onChange={setTab} options={[
          { value: 'orders', label: t('hist.orders') }, { value: 'deliveries', label: t('hist.deliveries') }, { value: 'buy', label: t('hist.buy') },
        ]} />
        <span className="grow" />
        <Button size="sm" variant="ghost" icon={<Download size={16} />} disabled={!count} onClick={exportCsv}>{t('common.exportCsv')}</Button>
      </div>

      {current.isPending ? <Skeleton rows={6} /> : !count ? <Empty title={t('hist.nothing')} /> : tab === 'orders' ? (
        <div className="stack">
          {(orders.data ?? []).map(o => (
            <Card key={o.id} className="archive-card">
              <div className="row wrap gap-1">
                <b>{fmtDateTime(o.created_at)}</b>
                {seesAll && <Badge>{o.location?.name_en}</Badge>}
                <Badge tone={TYPE_TONE[o.order_type]}>{t(`type.${o.order_type}` as MessageKey)}</Badge>
                <Badge tone={ORDER_TONE[o.status]}>{t(`ostatus.${o.status}` as MessageKey)}</Badge>
                <span className="muted small">{t('mine.lines', { n: o.items.length })}</span>
              </div>
              <div className="chips mt-1">
                {o.items.map(i => (
                  <span key={i.id} className={`tally-chip tone-edge-${LINE_TONE[i.dispatch_status]}`}>{qtyUnit(i.quantity, i.unit_snapshot)} {i.item_name_snapshot}</span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : tab === 'deliveries' ? (
        <Card className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('hist.when')}</th>{seesAll && <th>{t('common.location')}</th>}<th>{t('common.item')}</th><th className="num">{t('common.qty')}</th><th /></tr></thead>
            <tbody>
              {(deliveries.data ?? []).map(r => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDateTime(r.dispatched_at)}</td>
                  {seesAll && <td>{r.order?.location?.name_en}</td>}
                  <td>{r.item_name_snapshot}</td>
                  <td className="num">{num(r.fulfilled_qty ?? r.quantity)} {r.unit_snapshot}</td>
                  <td>{r.dispatch_status === 'received' ? <Badge tone="accent">{t('lstatus.received')}</Badge> : <Badge tone="info">{t('lstatus.dispatched')}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('hist.when')}</th>{seesAll && <th>{t('buy.deliverTo')}</th>}<th>{t('common.item')}</th><th className="num">{t('common.qty')}</th><th /></tr></thead>
            <tbody>
              {(tasks.data ?? []).map(r => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDateTime(r.created_at)}</td>
                  {seesAll && <td>{r.target?.name_en || '—'}</td>}
                  <td>{r.item_name}</td>
                  <td className="num">{qtyUnit(r.quantity, r.unit)}</td>
                  <td><Badge tone={r.status === 'bought' ? 'ok' : r.status === 'unavailable' ? 'bad' : 'buy'}>{t(`tstatus.${r.status}` as MessageKey)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
