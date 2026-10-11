import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, MapPin, RotateCcw, Trash2, X } from 'lucide-react'
import * as api from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useI18n, itemName } from '@/lib/i18n'
import { useCatalog, useLocations } from '@/lib/refdata'
import { useLiveQueries } from '@/lib/query'
import { QK, useAction } from '@/lib/useAction'
import { fmtDateTime, qtyUnit } from '@/lib/format'
import { useFeedback } from '@/ui/feedback'
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Segmented, Select, Skeleton } from '@/ui/primitives'
import type { BuyTask } from '@/lib/types'

export default function BuyListPage() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { can, role, locationId, userId } = useAuth()
  const fb = useFeedback()
  const isBuyer = can('buy.work')
  const isStore = role === 'restaurant_orderer' || role === 'store_manager'
  const canAdd = can('buy.request')
  const scope = isStore ? locationId : null

  const [view, setView] = useState<'todo' | 'done'>('todo')
  const pendingKey = [...QK.buy, 'pending', scope]
  const doneKey = [...QK.buy, 'done', scope]
  const pending = useQuery({ queryKey: pendingKey, queryFn: () => api.listBuyTasks({ status: 'pending', locationId: scope }) })
  const done = useQuery({ queryKey: doneKey, queryFn: () => api.listBuyTasks({ status: 'done', locationId: scope, limit: 80 }) })
  useLiveQueries(['procurement_tasks'], [QK.buy])
  const { run, isBusy } = useAction([QK.buy, QK.orders])

  const grouped = useMemo(() => {
    const m = new Map<string, BuyTask[]>()
    for (const task of pending.data ?? []) {
      const k = task.target?.name_en || t('buy.unassigned')
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(task)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [pending.data, t])

  async function cant(task: BuyTask) {
    const reason = await fb.prompt({
      title: t('buy.cantTitle', { name: task.item_name }),
      choices: [t('reason.outOfStock'), t('reason.tooExpensive'), t('reason.notFound')],
      placeholder: t('buy.otherReason'),
      confirm: t('buy.cant'),
    })
    if (reason) await run(() => api.setTaskStatus(task.id, 'unavailable', reason), { id: task.id })
  }
  async function allBought(list: BuyTask[]) {
    if (!await fb.confirm({ title: t('buy.allBoughtTitle', { n: list.length }) })) return
    await run(async () => { for (const task of list) await api.setTaskStatus(task.id, 'bought') }, { id: 'all', success: t('buy.allBoughtDone') })
  }
  async function remove(task: BuyTask) {
    if (!await fb.confirm({ title: t('buy.removeTitle', { name: task.item_name }), danger: true, confirm: t('common.remove') })) return
    await run(() => api.deleteTask(task.id), { id: task.id })
  }

  return (
    <div className="page">
      <PageHeader
        title={t('buy.title')}
        subtitle={isStore ? t('buy.subtitleStore') : t('buy.subtitleBuyer')}
        actions={<Segmented value={view} onChange={setView} options={[
          { value: 'todo', label: t('buy.todo'), count: pending.data?.length },
          { value: 'done', label: t('buy.done') },
        ]} />}
      />

      {canAdd && view === 'todo' && <AddTask isStore={isStore} locationId={locationId} onAdded={() => qc.invalidateQueries({ queryKey: QK.buy })} />}

      {view === 'todo' ? (
        pending.isPending ? <Skeleton variant="cards" rows={3} /> : !grouped.length ? (
          <Empty title={t('buy.nothing')}>{isStore ? t('buy.nothingStore') : t('buy.nothingBuyer')}</Empty>
        ) : (
          <div className="stack">
            {grouped.map(([loc, list]) => (
              <Card key={loc} className="group-card">
                <div className="group-head">
                  <MapPin size={16} /><b>{loc}</b><Badge tone="buy">{t('buy.left', { n: list.length })}</Badge>
                  <span className="grow" />
                  {isBuyer && list.length > 1 && (
                    <Button size="sm" variant="ok" icon={<Check size={16} />} loading={isBusy('all')} onClick={() => allBought(list)}>{t('buy.allBought')}</Button>
                  )}
                </div>
                {list.map(task => (
                  <div className="task-row" key={task.id}>
                    <div className="grow">
                      <div className="task-name">{task.item_name} <span className="mono">{qtyUnit(task.quantity, task.unit)}</span></div>
                      {task.note && <div className="muted small">📝 {task.note}</div>}
                    </div>
                    {isBuyer ? (
                      <div className="row gap-1">
                        <Button size="sm" variant="ok" icon={<Check size={16} />} loading={isBusy(task.id)} onClick={() => run(() => api.setTaskStatus(task.id, 'bought'), { id: task.id })}>{t('buy.bought')}</Button>
                        <Button size="sm" variant="ghost" className="text-bad" icon={<X size={16} />} onClick={() => cant(task)}>{t('buy.cant')}</Button>
                      </div>
                    ) : <Badge>{t('buy.waiting')}</Badge>}
                    {(role === 'admin' || task.created_by === userId) && (
                      <Button size="sm" variant="ghost" aria-label={t('common.remove')} icon={<Trash2 size={16} />} onClick={() => remove(task)} />
                    )}
                  </div>
                ))}
              </Card>
            ))}
          </div>
        )
      ) : done.isPending ? <Skeleton rows={6} /> : !(done.data ?? []).length ? <Empty title={t('buy.noneDone')} /> : (
        <Card>
          {(done.data ?? []).map(task => (
            <div className="task-row" key={task.id}>
              <div className="grow">
                <div className="task-name">{task.item_name} <span className="mono">{qtyUnit(task.quantity, task.unit)}</span></div>
                <div className="muted small">→ {task.target?.name_en || '—'} · {fmtDateTime(task.bought_at || task.created_at)}{task.unavail_reason ? ` · ${task.unavail_reason}` : ''}</div>
              </div>
              <Badge tone={task.status === 'bought' ? 'ok' : 'bad'}>{t(`tstatus.${task.status}` as 'tstatus.bought')}</Badge>
              {(isBuyer || task.created_by === userId) && (
                <Button size="sm" variant="ghost" aria-label={t('buy.reopen')} icon={<RotateCcw size={16} />} loading={isBusy(task.id)} onClick={() => run(() => api.setTaskStatus(task.id, 'pending'), { id: task.id })} />
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function AddTask({ isStore, locationId, onAdded }: { isStore: boolean; locationId: string | null; onAdded: () => void }) {
  const { t, lang } = useI18n()
  const fb = useFeedback()
  const catalog = useCatalog()
  const locations = useLocations()
  const [pick, setPick] = useState('')
  const [name, setName] = useState('')
  const [qty, setQty] = useState('1')
  const [unit, setUnit] = useState('')
  const [note, setNote] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)

  function onPick(id: string) {
    setPick(id)
    const c = (catalog.data ?? []).find(x => x.id === id)
    if (c) { setName(itemName(lang, c)); setUnit(c.order_unit || '') }
  }
  async function add() {
    const q = Number(qty.replace(',', '.'))
    if (!name.trim()) return
    if (!(q > 0)) { fb.toast(t('order.qtyPositive')); return }
    setBusy(true)
    try {
      await api.addBuyTask({
        item_name: name.trim(), catalog_item_id: pick || null, quantity: q, unit: unit.trim() || null,
        note: note.trim() || null, target_location_id: isStore ? locationId : (target || null),
      })
      setPick(''); setName(''); setQty('1'); setUnit(''); setNote('')
      fb.ok(t('buy.added'))
      onAdded()
    } catch (e) { fb.error(e) } finally { setBusy(false) }
  }
  return (
    <Card className="add-task">
      <div className="add-task-grid">
        <Field label={t('buy.fromCatalog')}>
          <Select value={pick} onChange={e => onPick(e.target.value)}>
            <option value="">—</option>
            {(catalog.data ?? []).map(c => <option key={c.id} value={c.id}>{itemName(lang, c)}</option>)}
          </Select>
        </Field>
        <Field label={t('buy.item')}><Input value={name} placeholder={t('buy.itemHint')} onChange={e => { setName(e.target.value); setPick('') }} /></Field>
        <Field label={t('common.qty')}><Input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} /></Field>
        <Field label={t('common.unit')}><Input value={unit} onChange={e => setUnit(e.target.value)} /></Field>
        <Field label={t('buy.note')} className="span-2"><Input value={note} placeholder={t('buy.noteHint')} onChange={e => setNote(e.target.value)} /></Field>
        {!isStore && (
          <Field label={t('buy.deliverTo')}>
            <Select value={target} onChange={e => setTarget(e.target.value)}>
              <option value="">—</option>
              {(locations.data ?? []).map(l => <option key={l.id} value={l.id}>{l.name_en}</option>)}
            </Select>
          </Field>
        )}
        <div className="add-task-submit"><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={add}>{t('buy.add')}</Button></div>
      </div>
    </Card>
  )
}
