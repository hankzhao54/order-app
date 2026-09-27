import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Tag } from 'lucide-react'
import * as api from '@/lib/api'
import { useI18n, itemName } from '@/lib/i18n'
import { useLocations } from '@/lib/refdata'
import { expiryInfo } from '@/lib/inventory'
import { fmtDate, matches, num } from '@/lib/format'
import { Badge, Card, Empty, Input, PageHeader, Select, Skeleton } from '@/ui/primitives'

export default function LabelsPage() {
  const { t, lang } = useI18n()
  const locations = useLocations()
  const [picked, setPicked] = useState('')
  const locs = locations.data ?? []
  const locId = picked || locs.find(l => l.is_central)?.id || locs[0]?.id || ''
  const [q, setQ] = useState('')
  const batches = useQuery({ queryKey: ['labels', locId], enabled: !!locId, queryFn: () => api.listBatchesForLabels(locId) })
  const rows = (batches.data ?? []).filter(b => matches([b.item?.name_en, b.item?.name_hu], q))

  return (
    <div className="page">
      <PageHeader title={t('labels.title')} subtitle={t('labels.subtitle')} />
      <div className="toolbar wrap">
        <Select value={locId} onChange={e => setPicked(e.target.value)} aria-label={t('common.location')}>
          {locs.map(l => <option key={l.id} value={l.id}>{l.name_en}</option>)}
        </Select>
        <div className="search grow"><Search size={18} aria-hidden /><Input type="search" placeholder={t('inv.search')} value={q} onChange={e => setQ(e.target.value)} /></div>
      </div>
      {batches.isPending ? <Skeleton rows={6} /> : !rows.length ? <Empty title={t('labels.none')} /> : (
        <Card>
          {rows.map(b => {
            const e = expiryInfo(b.expires_on)
            return (
              <div key={b.id} className="task-row">
                <div className="grow">
                  <div className="task-name">{itemName(lang, b.item)}</div>
                  <div className="muted small">
                    {t('trace.produced')} {fmtDate(b.produced_on)} · {t('trace.useBy')} {fmtDate(b.expires_on)} · {t('trace.qty')} {num(b.qty)}
                  </div>
                </div>
                {e.level === 'expired' && <Badge tone="bad">{t('inv.expired')}</Badge>}
                <a className="btn btn-primary btn-sm" href={`/label/${b.id}`} target="_blank" rel="noopener"><Tag size={16} /><span>{t('labels.print')}</span></a>
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}
