import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import * as api from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { useAction } from '@/lib/useAction'
import { Button, Card, Empty, Input, PageHeader, Skeleton } from '@/ui/primitives'
import { BlurInput } from '@/ui/BlurInput'

export default function SuppliersPage() {
  const { t } = useI18n()
  const q = useQuery({ queryKey: ['suppliers'], queryFn: api.listSuppliers })
  const { run } = useAction([['suppliers']])
  const [f, setF] = useState({ name: '', contact: '', note: '' })

  async function add() {
    if (!f.name.trim()) return
    const r = await run(() => api.createSupplier({ name: f.name.trim(), contact: f.contact.trim() || null, note: f.note.trim() || null }), { success: t('common.saved') })
    if (r !== undefined) setF({ name: '', contact: '', note: '' })
  }
  return (
    <div className="page">
      <PageHeader title={t('sup.title')} subtitle={t('sup.subtitle')} />
      <Card className="mb-3">
        <div className="row gap-1 wrap">
          <Input placeholder={t('sup.name')} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
          <Input placeholder={t('sup.contact')} value={f.contact} onChange={e => setF({ ...f, contact: e.target.value })} />
          <Input placeholder={t('sup.note')} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
          <Button variant="primary" icon={<Plus size={16} />} disabled={!f.name.trim()} onClick={add}>{t('sup.add')}</Button>
        </div>
      </Card>
      {q.isPending ? <Skeleton rows={5} /> : !(q.data ?? []).length ? <Empty title={t('sup.none')} /> : (
        <Card className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('sup.name')}</th><th>{t('sup.contact')}</th><th>{t('sup.note')}</th><th className="w-sm">{t('cat.active')}</th></tr></thead>
            <tbody>
              {(q.data ?? []).map(s => (
                <tr key={s.id} className={s.is_active ? '' : 'row-muted'}>
                  <td><BlurInput value={s.name} onCommit={v => v.trim() && run(() => api.updateSupplier(s.id, { name: v.trim() }))} /></td>
                  <td><BlurInput value={s.contact || ''} onCommit={v => run(() => api.updateSupplier(s.id, { contact: v.trim() || null }))} /></td>
                  <td><BlurInput value={s.note || ''} onCommit={v => run(() => api.updateSupplier(s.id, { note: v.trim() || null }))} /></td>
                  <td><input type="checkbox" checked={s.is_active} onChange={e => run(() => api.updateSupplier(s.id, { is_active: e.target.checked }))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
