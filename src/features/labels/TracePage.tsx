import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Clock } from 'lucide-react'
import * as api from '@/lib/api'
import { useI18n, itemName } from '@/lib/i18n'
import { expiryInfo } from '@/lib/inventory'
import { fmtDate, num } from '@/lib/format'
import { Skeleton } from '@/ui/primitives'

/** Public page behind the QR code on printed labels. Works without signing in. */
export function TracePage() {
  const { id = '' } = useParams()
  const { t, lang } = useI18n()
  const q = useQuery({ queryKey: ['trace', id], queryFn: () => api.traceBatch(id), retry: false })
  const row = q.data
  const exp = expiryInfo(row?.expires_on)
  return (
    <div className="trace">
      <div className="trace-card">
        <div className="trace-brand"><span className="brand-mark">订</span> {t('trace.title')}</div>
        {q.isPending ? <Skeleton rows={4} /> : !row ? (
          <p className="muted">{t('trace.notFound')}</p>
        ) : (
          <>
            <h1>{itemName(lang, row)}</h1>
            {row.name_hu && row.name_hu !== row.name_en && <div className="muted">{lang === 'hu' ? row.name_en : row.name_hu}</div>}
            {exp.level === 'expired' && <div className="trace-flag tone-bad"><AlertTriangle size={18} /> {t('trace.expired')}</div>}
            {(exp.level === 'soon' || exp.level === 'today') && <div className="trace-flag tone-warn"><Clock size={18} /> {t('trace.soon')}</div>}
            <dl className="trace-dl">
              <dt>{t('trace.produced')}</dt><dd>{fmtDate(row.produced_on)}</dd>
              <dt>{t('trace.useBy')}</dt><dd className={exp.level === 'expired' ? 'text-bad' : ''}>{fmtDate(row.expires_on)}</dd>
              <dt>{t('trace.qty')}</dt><dd>{num(row.qty)}</dd>
              <dt>{t('trace.location')}</dt><dd>{row.location}</dd>
              <dt>{t('trace.batch')}</dt><dd className="mono">{String(row.batch_id).slice(0, 8)}</dd>
            </dl>
          </>
        )}
      </div>
    </div>
  )
}
