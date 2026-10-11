import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import * as api from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { QK, useAction } from '@/lib/useAction'
import { Badge, Button, Card, Input, PageHeader, Skeleton } from '@/ui/primitives'
import { BlurInput } from '@/ui/BlurInput'

export default function LocationsPage() {
  const { t } = useI18n()
  const key = [...QK.locations, 'all']
  const q = useQuery({ queryKey: key, queryFn: () => api.listLocations({ includeInactive: true }) })
  const { run } = useAction([QK.locations])
  const [f, setF] = useState({ code: '', name_en: '', name_hu: '', is_central: false })

  async function add() {
    if (!f.code.trim() || !f.name_en.trim()) return
    const r = await run(() => api.createLocation({ code: f.code.trim().toUpperCase(), name_en: f.name_en.trim(), name_hu: f.name_hu.trim() || null, is_central: f.is_central }), { success: t('common.saved') })
    if (r !== undefined) setF({ code: '', name_en: '', name_hu: '', is_central: false })
  }
  return (
    <div className="page">
      <PageHeader title={t('loc.title')} subtitle={t('loc.subtitle')} />
      <Card className="mb-3">
        <div className="row gap-1 wrap">
          <Input className="w-code" placeholder={t('loc.code')} value={f.code} onChange={e => setF({ ...f, code: e.target.value })} />
          <Input placeholder={t('cat.nameEn')} value={f.name_en} onChange={e => setF({ ...f, name_en: e.target.value })} />
          <Input placeholder={t('cat.nameHu')} value={f.name_hu} onChange={e => setF({ ...f, name_hu: e.target.value })} />
          <label className="check"><input type="checkbox" checked={f.is_central} onChange={e => setF({ ...f, is_central: e.target.checked })} /> {t('loc.central')}</label>
          <Button variant="primary" icon={<Plus size={16} />} disabled={!f.code.trim() || !f.name_en.trim()} onClick={add}>{t('common.add')}</Button>
        </div>
      </Card>
      {q.isPending ? <Skeleton rows={5} /> : (
        <Card className="table-wrap">
          <table className="table">
            <thead><tr><th className="w-sm">{t('loc.code')}</th><th>{t('cat.nameEn')}</th><th>{t('cat.nameHu')}</th><th /><th className="w-sm">{t('cat.active')}</th></tr></thead>
            <tbody>
              {(q.data ?? []).map(l => (
                <tr key={l.id} className={l.is_active ? '' : 'row-muted'}>
                  <td className="mono">{l.code}</td>
                  <td><BlurInput value={l.name_en} onCommit={v => v.trim() && run(() => api.updateLocation(l.id, { name_en: v.trim() }))} /></td>
                  <td><BlurInput value={l.name_hu || ''} onCommit={v => run(() => api.updateLocation(l.id, { name_hu: v.trim() || null }))} /></td>
                  <td>{l.is_central && <Badge tone="accent">{t('loc.central')}</Badge>}</td>
                  <td><input type="checkbox" checked={l.is_active} onChange={e => run(() => api.updateLocation(l.id, { is_active: e.target.checked }))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="muted small">{t('loc.foot')}</p>
    </div>
  )
}
