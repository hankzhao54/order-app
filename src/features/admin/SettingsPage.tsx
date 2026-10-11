import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as api from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { useCutoff } from '@/lib/refdata'
import { QK } from '@/lib/useAction'
import { productionWeek } from '@/lib/dates'
import { fmtDate } from '@/lib/format'
import { useFeedback } from '@/ui/feedback'
import { Button, Card, Field, Input, PageHeader, Select, Skeleton } from '@/ui/primitives'
import type { CutoffConfig } from '@/lib/types'

export default function SettingsPage() {
  const { t } = useI18n()
  const fb = useFeedback()
  const qc = useQueryClient()
  const cutoff = useCutoff()
  const [cfg, setCfg] = useState<CutoffConfig | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (cutoff.data && !cfg) setCfg(cutoff.data) }, [cutoff.data, cfg])
  if (!cfg) return <div className="page"><Skeleton rows={3} /></div>

  const days = [1, 2, 3, 4, 5, 6, 7]
  const dayName = (d: number) => new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(Date.UTC(2024, 0, d)))
  async function save() {
    setBusy(true)
    try {
      await api.saveCutoff(cfg!)
      qc.invalidateQueries({ queryKey: QK.cutoff })
      api.logAudit('settings.cutoff', 'order_cutoff', cfg as unknown as Record<string, unknown>)
      fb.ok(t('common.saved'))
    } catch (e) { fb.error(e) } finally { setBusy(false) }
  }

  return (
    <div className="page">
      <PageHeader title={t('settings.title')} />
      <Card>
        <h3 className="card-title">{t('settings.cutoff')}</h3>
        <p className="muted small">{t('settings.cutoffHint')}</p>
        <label className="check"><input type="checkbox" checked={cfg.enabled} onChange={e => setCfg({ ...cfg, enabled: e.target.checked })} /> {t('settings.enabled')}</label>
        <div className="form-grid">
          <Field label={t('settings.weekday')}>
            <Select value={cfg.weekday} disabled={!cfg.enabled} onChange={e => setCfg({ ...cfg, weekday: Number(e.target.value) })}>
              {days.map(d => <option key={d} value={d}>{dayName(d)}</option>)}
            </Select>
          </Field>
          <Field label={t('settings.time')} hint="Europe/Budapest">
            <Input type="time" disabled={!cfg.enabled} value={`${String(cfg.hour).padStart(2, '0')}:${String(cfg.minute).padStart(2, '0')}`}
              onChange={e => { const [h, m] = e.target.value.split(':').map(Number); setCfg({ ...cfg, hour: h || 0, minute: m || 0 }) }} />
          </Field>
        </div>
        <p className="note note-info">{t('settings.preview', { week: fmtDate(productionWeek(cfg)) })}</p>
        <Button variant="primary" loading={busy} onClick={save}>{t('common.save')}</Button>
      </Card>
    </div>
  )
}
