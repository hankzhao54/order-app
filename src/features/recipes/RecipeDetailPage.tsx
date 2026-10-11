import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import {
  AlertTriangle, ArrowLeft, ClipboardList, Copy, History, Minus, Package, Pencil, Plus, Printer, QrCode, RotateCcw, Star, Trash2, X,
} from 'lucide-react'
import * as api from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useI18n, itemName } from '@/lib/i18n'
import type { MessageKey } from '@/lib/i18n/en'
import { useAction } from '@/lib/useAction'
import { categoryColor, categoryLabel, ingName, prettyNumber, recipeAltName, recipeName, scaleQty, stepText } from '@/lib/recipes'
import { fmtDateTime } from '@/lib/format'
import { useFeedback } from '@/ui/feedback'
import { Badge, Button, Card, Empty, Skeleton } from '@/ui/primitives'
import { Sheet } from '@/ui/Sheet'
import { RK, usePrepList, useRecent, useRecipeCategories, useRecipeFavorites } from './hooks'

export default function RecipeDetailPage() {
  const { id = '' } = useParams()
  const { t, lang } = useI18n()
  const { can, userId } = useAuth()
  const nav = useNavigate()
  const fb = useFeedback()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: RK.one(id), queryFn: () => api.getRecipe(id) })
  const cats = useRecipeCategories()
  const products = useQuery({ queryKey: RK.products(id), queryFn: () => api.productsForRecipe(id) })
  const { favs, toggle: toggleFav } = useRecipeFavorites()
  const prep = usePrepList()
  const { push } = useRecent()
  const [mult, setMult] = useState(1)
  const [zoom, setZoom] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const { run, isBusy } = useAction([RK.list, RK.one(id), RK.versions(id)])

  useEffect(() => { if (q.data) push(q.data.id) }, [q.data, push])

  if (q.isPending) return <div className="page narrow-page"><Skeleton variant="cards" rows={3} /></div>
  const r = q.data
  if (!r) return <div className="page"><Empty title={t('rec.notFound')}><Link to="/recipes">{t('rec.backToList')}</Link></Empty></div>

  const col = categoryColor(cats.data ?? [], r.category)
  const name = recipeName(r, lang)
  const alt = recipeAltName(r, lang)
  const canEdit = can('recipes.edit')
  const canDelete = can('recipes.manage') || (canEdit && r.author_id === userId)

  async function showQr() {
    const url = `${window.location.origin}/recipes/${r!.id}`
    setQr(await QRCode.toDataURL(url, { width: 320, margin: 2 }))
  }
  async function remove() {
    if (!await fb.confirm({ title: t('rec.deleteTitle', { name }), body: t('rec.deleteBody'), danger: true, confirm: t('common.remove') })) return
    const res = await run(() => api.deleteRecipe(r!.id), { success: t('rec.deleted') })
    if (res !== undefined) { qc.removeQueries({ queryKey: RK.one(r!.id) }); nav('/recipes') }
  }
  function printQr() {
    const w = window.open('', '_blank')
    if (!w || !qr) return
    const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(name)}</title><body style="text-align:center;font-family:system-ui;padding:40px"><h2>${esc(name)}</h2><img src="${qr}" style="width:300px"><p style="color:#777">${esc(t('rec.qrHint'))}</p><script>onload=()=>print()</script>`)
    w.document.close()
  }

  return (
    <div className="page narrow-page recipe-page" style={{ ['--cat' as string]: col }}>
      <div className="recipe-top no-print">
        <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => (window.history.length > 1 ? nav(-1) : nav('/recipes'))}>{t('rec.back')}</Button>
        <span className="grow" />
        <Button variant="ghost" aria-label={t('order.favorite')} icon={<Star size={18} fill={favs.has(r.id) ? 'currentColor' : 'none'} />} className={favs.has(r.id) ? 'text-warn' : ''} onClick={() => toggleFav(r.id)} />
        <Button variant="ghost" aria-label={t('rec.addToPrep')} icon={<ClipboardList size={18} />} className={prep.has(r.id) ? 'text-ok' : ''} onClick={() => prep.toggle(r.id, mult)} />
        <Button variant="ghost" aria-label="QR" icon={<QrCode size={18} />} onClick={showQr} />
        <Button variant="ghost" aria-label={t('common.print')} icon={<Printer size={18} />} onClick={() => window.print()} />
        {canEdit && <>
          <Button variant="ghost" aria-label={t('rec.history')} icon={<History size={18} />} onClick={() => setShowHistory(true)} />
          <Button variant="ghost" aria-label={t('rec.duplicate')} icon={<Copy size={18} />} onClick={() => nav(`/recipes/new?from=${encodeURIComponent(r.id)}`)} />
          <Button icon={<Pencil size={16} />} onClick={() => nav(`/recipes/${r.id}/edit`)}>{t('rec.edit')}</Button>
        </>}
        {canDelete && <Button variant="ghost" className="text-bad" aria-label={t('common.remove')} icon={<Trash2 size={18} />} onClick={remove} />}
      </div>

      <div className="recipe-hero">
        {r.cover_image ? <img src={r.cover_image} alt="" onClick={() => setZoom(r.cover_image)} /> : <span className="rcard-initial big">{(name || '·')[0]}</span>}
      </div>

      <div className="recipe-head">
        <span className="cat-chip on static" style={{ ['--cat' as string]: col }}><span className="cat-dot" /> {categoryLabel(cats.data ?? [], r.category, lang)}</span>
        {r.status === 'draft' && <Badge tone="warn">{t('rec.draft')}</Badge>}
        <h1 className="recipe-title">{name}</h1>
        {alt && <div className="muted">{alt}</div>}
        <div className="muted small">{t('rec.by', { name: r.author_name || '—' })}{r.updated_at ? ` · ${t('rec.updated', { at: fmtDateTime(r.updated_at) })}` : ''}</div>
        {r.allergens?.length > 0 && (
          <div className="chips mt-1">
            {r.allergens.map(a => <Badge key={a} tone="bad"><AlertTriangle size={12} /> {t(`allergen.${a}` as MessageKey)}</Badge>)}
          </div>
        )}
      </div>

      <div className="spec-grid">
        <div className="spec"><span>{t('rec.packSpec')}</span><b>{r.pack_spec || '—'}</b></div>
        <div className="spec"><span>{t('rec.shelfLife')}</span><b>{r.shelf_life || '—'}</b></div>
        <div className="spec"><span>{t('rec.vacuum')}</span><b>{r.vacuum_level || '—'}</b></div>
        {(r.prep_time || r.cook_time) ? <div className="spec"><span>{t('rec.time')}</span><b>{(r.prep_time || 0) + (r.cook_time || 0)} min</b></div> : null}
      </div>

      {(products.data ?? []).length > 0 && (
        <Card className="linked-products">
          <Package size={16} />
          <span className="grow">{t('rec.orderedAs')} {(products.data ?? []).map(p => <b key={p.id}>{itemName(lang, p)}{p.order_unit ? ` (${p.order_unit})` : ''}</b>)}</span>
        </Card>
      )}

      {r.ingredients.length > 0 && (
        <section className="recipe-section">
          <div className="section-head">
            <h2>{t('rec.ingredients')} <span className="muted">({r.ingredients.length})</span></h2>
            <div className="scale no-print">
              <span className="muted small">{t('rec.scale')}</span>
              <button type="button" aria-label="−" onClick={() => setMult(m => Math.max(0.25, +(m - 0.5).toFixed(2)))}><Minus size={14} /></button>
              <b>{prettyNumber(mult)}×</b>
              <button type="button" aria-label="+" onClick={() => setMult(m => +(m + 0.5).toFixed(2))}><Plus size={14} /></button>
              {mult !== 1 && <button type="button" aria-label={t('rec.reset')} onClick={() => setMult(1)}><RotateCcw size={14} /></button>}
            </div>
          </div>
          <div className="ing-list">
            {r.ingredients.map((ing, i) => (
              <div key={ing.id || i} className="ing">
                {ing.image ? <img src={ing.image} alt="" onClick={() => setZoom(ing.image!)} /> : <span className="ing-initial">{(ingName(ing, lang) || '·')[0]}</span>}
                <Link className="ing-name" to={`/recipes?q=${encodeURIComponent(ingName(ing, lang))}`} title={t('rec.usedIn')}>{ingName(ing, lang)}</Link>
                <span className={`ing-qty${mult !== 1 ? ' scaled' : ''}`}>{scaleQty(ing.qty, mult)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {r.steps.length > 0 && (
        <section className="recipe-section">
          <h2>{t('rec.steps')}</h2>
          <ol className="step-list">
            {r.steps.map((s, i) => (
              <li key={s.id || i}>
                <span className="step-n">{i + 1}</span>
                <div className="grow">
                  <p>{stepText(s, lang)}</p>
                  {s.image && <img src={s.image} alt="" onClick={() => setZoom(s.image!)} />}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {zoom && (
        <div className="zoom" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" />
          <button type="button" aria-label={t('common.cancel')}><X size={20} /></button>
        </div>
      )}

      <Sheet open={!!qr} onClose={() => setQr(null)} size="sm" title={name}
        footer={<><Button variant="ghost" onClick={() => setQr(null)}>{t('common.done')}</Button><Button variant="primary" icon={<Printer size={16} />} onClick={printQr}>{t('common.print')}</Button></>}>
        <div className="center">{qr && <img src={qr} alt="QR" style={{ width: 260, maxWidth: '100%' }} />}<p className="muted small">{t('rec.qrHint')}</p></div>
      </Sheet>

      {showHistory && <VersionsSheet recipeId={r.id} onClose={() => setShowHistory(false)} busy={isBusy} onRestore={async vid => {
        const res = await run(() => api.restoreRecipeVersion(vid), { id: `v${vid}`, success: t('rec.restored') })
        if (res !== undefined) setShowHistory(false)
      }} />}
    </div>
  )
}

function VersionsSheet({ recipeId, onClose, onRestore, busy }: { recipeId: string; onClose: () => void; onRestore: (id: number) => void; busy: (id?: string) => boolean }) {
  const { t, lang } = useI18n()
  const fb = useFeedback()
  const q = useQuery({ queryKey: RK.versions(recipeId), queryFn: () => api.listRecipeVersions(recipeId) })
  return (
    <Sheet open onClose={onClose} title={t('rec.history')}>
      {q.isPending ? <Skeleton rows={4} /> : !(q.data ?? []).length ? <Empty title={t('rec.noVersions')} /> : (
        <div className="stack">
          {(q.data ?? []).map(v => (
            <div key={v.id} className="task-row">
              <div className="grow">
                <div className="task-name">{recipeName(v.snapshot, lang)}</div>
                <div className="muted small">{fmtDateTime(v.created_at)} · {v.edited_by_name || '—'} · {t('rec.versionCounts', { i: v.snapshot.ingredients?.length ?? 0, s: v.snapshot.steps?.length ?? 0 })}</div>
              </div>
              <Button size="sm" loading={busy(`v${v.id}`)} onClick={async () => {
                if (await fb.confirm({ title: t('rec.restoreTitle'), body: t('rec.restoreBody') })) onRestore(v.id)
              }}>{t('rec.restore')}</Button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}
