import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import * as api from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { rangeStartISO, todayISO } from '@/lib/dates'
import { fmtDateTime } from '@/lib/format'
import { downloadCSV } from '@/lib/csv'
import type { Json } from '@/lib/database.types'
import { Card, Empty, PageHeader, Segmented, Select, Skeleton } from '@/ui/primitives'

function detail(d: Json | null): string {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ''
  return Object.entries(d).filter(([k, v]) => v != null && k !== 'order_id').map(([k, v]) => `${k}: ${v}`).join(' · ')
}

export default function AuditPage() {
  const { t } = useI18n()
  const [range, setRange] = useState<'week' | 'month' | 'all'>('week')
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const since = rangeStartISO(range)
  const q = useQuery({ queryKey: ['admin', 'audit', since], queryFn: () => api.listAudit(since) })
  const rows = q.data ?? []
  const actions = useMemo(() => [...new Set(rows.map(r => r.action))].sort(), [rows])
  const actors = useMemo(() => [...new Set(rows.map(r => r.actor_name || '—'))].sort(), [rows])
  const filtered = rows.filter(r => (!action || r.action === action) && (!actor || (r.actor_name || '—') === actor))

  return (
    <div className="page">
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />
      <div className="toolbar wrap">
        <Segmented size="sm" value={range} onChange={setRange} options={[{ value: 'week', label: t('rep.week') }, { value: 'month', label: t('rep.month') }, { value: 'all', label: t('rep.all') }]} />
        <Select value={action} onChange={e => setAction(e.target.value)}><option value="">{t('audit.allActions')}</option>{actions.map(a => <option key={a} value={a}>{a}</option>)}</Select>
        <Select value={actor} onChange={e => setActor(e.target.value)}><option value="">{t('audit.everyone')}</option>{actors.map(a => <option key={a} value={a}>{a}</option>)}</Select>
        <span className="grow" />
        <button type="button" className="btn btn-ghost btn-sm" disabled={!filtered.length} onClick={() => downloadCSV(`audit-${todayISO()}`, [
          { label: 'When', value: r => r.created_at }, { label: 'Who', value: r => r.actor_name }, { label: 'Action', value: r => r.action },
          { label: 'Target', value: r => r.target }, { label: 'Detail', value: r => detail(r.detail) },
        ], filtered)}><Download size={16} /><span>{t('common.exportCsv')}</span></button>
      </div>
      {q.isPending ? <Skeleton rows={8} /> : !filtered.length ? <Empty title={t('audit.none')} /> : (
        <Card className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('hist.when')}</th><th>{t('audit.who')}</th><th>{t('audit.action')}</th><th>{t('audit.target')}</th><th>{t('audit.detail')}</th></tr></thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td className="nowrap muted small">{fmtDateTime(r.created_at)}</td>
                  <td>{r.actor_name || '—'}</td>
                  <td><code>{r.action}</code></td>
                  <td>{r.target}</td>
                  <td className="muted small">{detail(r.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
