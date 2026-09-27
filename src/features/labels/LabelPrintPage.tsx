import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { Printer } from 'lucide-react'
import * as api from '@/lib/api'
import { useT } from '@/lib/i18n'
import { Button, Skeleton } from '@/ui/primitives'

const d = (s: string | null | undefined) => (s ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB') : '—')

/** 62 mm Brother DK label: bilingual name, production / use-by dates and a QR to the trace page. */
export default function LabelPrintPage() {
  const { id = '' } = useParams()
  const t = useT()
  const q = useQuery({ queryKey: ['trace', id], queryFn: () => api.traceBatch(id), retry: false })
  const [qr, setQr] = useState('')
  useEffect(() => {
    QRCode.toDataURL(`${window.location.origin}/trace/${id}`, { margin: 0, width: 240 }).then(setQr).catch(() => {})
  }, [id])
  const row = q.data
  if (q.isPending) return <div className="page"><Skeleton rows={3} /></div>
  if (!row) return <div className="page"><p className="muted">{t('trace.notFound')}</p></div>
  return (
    <div className="label-page">
      <style>{'@media print { @page { size: 62mm 29mm; margin: 0 } }'}</style>
      <div className="label">
        <div className="label-main">
          <div className="label-name">{row.name_en}</div>
          {row.name_hu && row.name_hu !== row.name_en && <div className="label-hu">{row.name_hu}</div>}
          <div className="label-dates">
            <div><span>Prod</span><b>{d(row.produced_on)}</b></div>
            <div><span>Use by</span><b>{d(row.expires_on)}</b></div>
          </div>
          <div className="label-batch">#{String(row.batch_id).slice(0, 8)}</div>
        </div>
        {qr && <img className="label-qr" src={qr} alt="QR" />}
      </div>
      <div className="no-print stack center">
        <Button variant="primary" icon={<Printer size={16} />} onClick={() => window.print()}>{t('labels.printNow')}</Button>
        <p className="muted small">{t('labels.printHint')}</p>
      </div>
    </div>
  )
}
