import { useNavigate } from 'react-router'
import { useQueries } from '@tanstack/react-query'
import { ClipboardCopy, Minus, Plus, Printer, X } from 'lucide-react'
import * as api from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { aggregatePrep, prettyNumber, recipeName, type Recipe } from '@/lib/recipes'
import { useFeedback } from '@/ui/feedback'
import { Button, Card, Empty, PageHeader, Skeleton } from '@/ui/primitives'
import { RK, usePrepList } from './hooks'

export default function PrepListPage() {
  const { t, lang } = useI18n()
  const nav = useNavigate()
  const fb = useFeedback()
  const prep = usePrepList()
  const results = useQueries({ queries: prep.list.map(p => ({ queryKey: RK.one(p.id), queryFn: () => api.getRecipe(p.id) })) })
  const loading = results.some(r => r.isPending)
  const byId = new Map(results.map(r => r.data).filter(Boolean).map(r => [r!.id, r as Recipe]))
  const total = aggregatePrep(prep.list.flatMap(p => (byId.get(p.id) ? [{ recipe: byId.get(p.id)!, mult: p.mult }] : [])), lang)

  async function copy() {
    const text = total.map(a => `${a.name}: ${a.qty}`).join('\n')
    try { await navigator.clipboard.writeText(text); fb.ok(t('rec.copied')) } catch { fb.toast(text) }
  }

  return (
    <div className="page narrow-page">
      <PageHeader title={t('rec.prepList')} subtitle={t('rec.prepHint')} actions={prep.list.length ? <>
        <Button variant="ghost" icon={<Printer size={16} />} onClick={() => window.print()}>{t('common.print')}</Button>
        <Button variant="ghost" icon={<ClipboardCopy size={16} />} onClick={copy}>{t('rec.copy')}</Button>
        <Button variant="ghost" className="text-bad" onClick={async () => { if (await fb.confirm({ title: t('rec.clearPrep'), danger: true })) prep.clear() }}>{t('order.clear')}</Button>
      </> : undefined} />

      {!prep.list.length ? <Empty title={t('rec.prepEmpty')}><Button onClick={() => nav('/recipes')}>{t('rec.backToList')}</Button></Empty> : <>
        <Card className="mb-3">
          {prep.list.map(p => {
            const r = byId.get(p.id)
            return (
              <div key={p.id} className="task-row">
                <button type="button" className="link-btn grow left" onClick={() => nav(`/recipes/${p.id}`)}>{r ? recipeName(r, lang) : '…'}</button>
                <div className="scale">
                  <button type="button" aria-label="−" onClick={() => prep.setMult(p.id, +(p.mult - 0.5).toFixed(2))}><Minus size={14} /></button>
                  <b>{prettyNumber(p.mult)}×</b>
                  <button type="button" aria-label="+" onClick={() => prep.setMult(p.id, +(p.mult + 0.5).toFixed(2))}><Plus size={14} /></button>
                </div>
                <Button size="sm" variant="ghost" aria-label={t('common.remove')} icon={<X size={16} />} onClick={() => prep.toggle(p.id)} />
              </div>
            )
          })}
        </Card>
        <h3 className="card-title">{t('rec.totalIngredients', { n: total.length })}</h3>
        {loading ? <Skeleton rows={6} /> : (
          <Card className="table-wrap">
            <table className="table">
              <tbody>{total.map((a, i) => <tr key={i}><td>{a.name}</td><td className="num"><b>{a.qty}</b></td></tr>)}</tbody>
            </table>
          </Card>
        )}
      </>}
    </div>
  )
}
