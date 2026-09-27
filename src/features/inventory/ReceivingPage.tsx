import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, CheckCheck, PackageCheck, Undo2 } from 'lucide-react'
import * as api from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { useLocations } from '@/lib/refdata'
import { useLiveQueries } from '@/lib/query'
import { QK, useAction } from '@/lib/useAction'
import { fmtDate, fmtDateTime, num, qtyUnit } from '@/lib/format'
import { useFeedback } from '@/ui/feedback'
import { Button, Card, Empty, PageHeader, Select, Skeleton } from '@/ui/primitives'

export default function ReceivingPage() {
  const { t } = useI18n()
  const { can, locationId } = useAuth()
  const fb = useFeedback()
  const locations = useLocations()
  const anyLoc = can('inventory.anyLocation')
  const [picked, setPicked] = useState('')
  const locs = locations.data ?? []
  const locId = anyLoc ? (picked || locationId || locs.find(l => !l.is_central)?.id || '') : (locationId || '')
  const loc = locs.find(l => l.id === locId)

  const incomingKey = [...QK.incoming, locId]
  const incoming = useQuery({ queryKey: incomingKey, enabled: !!locId, queryFn: () => api.listIncoming(locId) })
  const returnsKey = [...QK.incoming, 'returns', locId]
  const returns = useQuery({ queryKey: returnsKey, enabled: !!locId && !!loc?.is_central, queryFn: () => api.listPendingReturns(locId) })
  useLiveQueries(['order_items', 'stock_returns'], [QK.incoming])
  const { run, isBusy } = useAction([QK.incoming, QK.stock, QK.orders])

  const lines = incoming.data ?? []
  const rets = returns.data ?? []

  async function receiveAll() {
    if (!await fb.confirm({ title: t('recv.allTitle', { n: lines.length }), body: t('recv.allBody', { loc: loc?.name_en || '' }) })) return
    await run(() => api.receiveItems(lines.map(l => l.id)), { id: 'all', success: t('recv.allDone', { n: lines.length }) })
  }

  return (
    <div className="page">
      <PageHeader
        title={t('recv.title')}
        subtitle={t('recv.subtitle')}
        actions={<>
          {anyLoc && (
            <Select value={locId} onChange={e => setPicked(e.target.value)} aria-label={t('common.location')}>
              {locs.map(l => <option key={l.id} value={l.id}>{l.name_en}{l.is_central ? ` (${t('common.kitchen')})` : ''}</option>)}
            </Select>
          )}
          {lines.length > 1 && <Button variant="primary" icon={<CheckCheck size={16} />} loading={isBusy('all')} onClick={receiveAll}>{t('recv.all', { n: lines.length })}</Button>}
        </>}
      />

      {incoming.isPending ? <Skeleton rows={5} /> : !lines.length && !rets.length ? (
        <Empty icon={<PackageCheck size={36} />} title={t('recv.nothing')}>{t('recv.nothingHint')}</Empty>
      ) : (
        <div className="stack">
          {rets.length > 0 && (
            <Card>
              <h3 className="card-title"><Undo2 size={16} /> {t('recv.returns')}</h3>
              {rets.map(r => (
                <div key={r.id} className="task-row">
                  <div className="grow">
                    <div className="task-name">{r.item?.name_en || '—'} <span className="mono">{qtyUnit(r.qty, r.item?.stock_unit)}</span></div>
                    <div className="muted small">{t('recv.from', { loc: r.from?.name_en || '—' })} · {fmtDateTime(r.created_at)}{r.expires_on ? ` · ${t('inv.useBy', { d: fmtDate(r.expires_on) })}` : ''}</div>
                  </div>
                  <Button size="sm" variant="ok" icon={<Check size={16} />} loading={isBusy(r.id)} onClick={() => run(() => api.receiveReturn(r.id), { id: r.id })}>{t('recv.received')}</Button>
                </div>
              ))}
            </Card>
          )}
          {lines.length > 0 && (
            <Card>
              <h3 className="card-title"><PackageCheck size={16} /> {t('recv.deliveries')}</h3>
              {lines.map(l => (
                <div key={l.id} className="task-row">
                  <div className="grow">
                    <div className="task-name">{l.item_name_snapshot} <span className="mono">{num(l.fulfilled_qty ?? l.quantity)} {l.unit_snapshot || ''}</span></div>
                    <div className="muted small">{t('recv.sentAt', { at: fmtDateTime(l.dispatched_at) })}{l.fulfilled_qty != null && Number(l.fulfilled_qty) < Number(l.quantity) ? ` · ${t('recv.ofOrdered', { n: num(l.quantity) })}` : ''}</div>
                  </div>
                  <Button size="sm" variant="ok" icon={<Check size={16} />} loading={isBusy(l.id)} onClick={() => run(() => api.receiveItems([l.id]), { id: l.id })}>{t('recv.received')}</Button>
                </div>
              ))}
            </Card>
          )}
          <p className="muted small">{t('recv.footer', { loc: loc?.name_en || '' })}</p>
        </div>
      )}
    </div>
  )
}
