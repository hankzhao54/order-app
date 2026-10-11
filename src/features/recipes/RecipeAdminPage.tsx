import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Download, Plus, Search, Trash2 } from 'lucide-react'
import * as api from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { CATEGORY_PALETTE, categoryLabel, parseBulkImport, recipeName, type RecipeCategory } from '@/lib/recipes'
import { downloadCSV } from '@/lib/csv'
import { todayISO } from '@/lib/dates'
import { matches } from '@/lib/format'
import { useFeedback } from '@/ui/feedback'
import { Button, Card, Empty, Field, Input, PageHeader, Segmented, Select, Skeleton, Stat } from '@/ui/primitives'
import { RK, useRecipeCategories, useRecipes } from './hooks'

type Tab = 'categories' | 'bulk' | 'import' | 'stats' | 'export'

export default function RecipeAdminPage() {
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('categories')
  return (
    <div className="page">
      <PageHeader title={t('rec.manage')} actions={
        <Segmented value={tab} onChange={setTab} options={[
          { value: 'categories', label: t('cat.categories') }, { value: 'bulk', label: t('rec.bulkEdit') },
          { value: 'import', label: t('rec.import') }, { value: 'stats', label: t('rec.stats') }, { value: 'export', label: t('rec.export') },
        ]} />
      } />
      {tab === 'categories' && <Categories />}
      {tab === 'bulk' && <BulkEdit />}
      {tab === 'import' && <Import />}
      {tab === 'stats' && <Stats />}
      {tab === 'export' && <Export />}
    </div>
  )
}

function Categories() {
  const { t } = useI18n()
  const fb = useFeedback()
  const qc = useQueryClient()
  const cats = useRecipeCategories()
  const [rows, setRows] = useState<RecipeCategory[]>([])
  const [removed, setRemoved] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (cats.data) { setRows(cats.data.map(c => ({ ...c }))); setRemoved([]) } }, [cats.data])
  const upd = (i: number, p: Partial<RecipeCategory>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...p } : r)))

  async function save() {
    if (rows.some(r => !r.name_en.trim() || !r.name_hu.trim())) { fb.toast(t('rec.catNamesRequired'), 'bad'); return }
    setBusy(true)
    try {
      await api.saveRecipeCategories(rows.map((r, i) => ({ ...r, name_en: r.name_en.trim(), name_hu: r.name_hu.trim(), sort_order: i })), removed)
      qc.invalidateQueries({ queryKey: RK.cats })
      api.logAudit('recipe.categories', null, { count: rows.length, removed: removed.length })
      fb.ok(t('common.saved'))
    } catch (e) { fb.error(e) } finally { setBusy(false) }
  }

  if (cats.isPending) return <Skeleton rows={6} />
  return (
    <Card>
      <p className="muted small">{t('rec.catHint')}</p>
      {rows.map((r, i) => (
        <div key={r.id} className="task-row">
          <span className="cat-dot lg" style={{ background: r.color }} />
          <Input className="grow" placeholder={t('cat.nameEn')} value={r.name_en} onChange={e => upd(i, { name_en: e.target.value })} />
          <Input className="grow" placeholder={t('cat.nameHu')} value={r.name_hu} onChange={e => upd(i, { name_hu: e.target.value })} />
          <div className="swatches">
            {CATEGORY_PALETTE.slice(0, 6).map(c => (
              <button key={c} type="button" aria-label={c} className={r.color === c ? 'on' : ''} style={{ background: c }} onClick={() => upd(i, { color: c })} />
            ))}
          </div>
          <Button size="sm" variant="ghost" className="text-bad" aria-label={t('common.remove')} icon={<Trash2 size={14} />}
            onClick={() => { setRemoved(x => (cats.data?.some(c => c.id === r.id) ? [...x, r.id] : x)); setRows(rs => rs.filter((_, j) => j !== i)) }} />
        </div>
      ))}
      <div className="row gap-1 mt-2">
        <Button icon={<Plus size={16} />} onClick={() => setRows(rs => {
          const next = Math.max(-1, ...rs.map(r => r.id), ...(cats.data ?? []).map(c => c.id)) + 1
          return [...rs, { id: next, name_en: '', name_hu: '', color: CATEGORY_PALETTE[rs.length % CATEGORY_PALETTE.length], sort_order: rs.length }]
        })}>{t('cat.addCategory')}</Button>
        <span className="grow" />
        <Button variant="primary" loading={busy} onClick={save}>{t('common.save')}</Button>
      </div>
    </Card>
  )
}

function BulkEdit() {
  const { t, lang } = useI18n()
  const fb = useFeedback()
  const qc = useQueryClient()
  const recipes = useRecipes()
  const cats = useRecipeCategories()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [f, setF] = useState({ category: '', pack_spec: '', shelf_life: '', vacuum_level: '' })
  const [progress, setProgress] = useState<string | null>(null)
  const visible = (recipes.data ?? []).filter(r => matches([r.en_name, r.hu_name], q))
  const toggle = (id: string) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const nothing = Object.values(f).every(v => v === '')

  async function apply() {
    const ids = [...sel]
    try {
      for (let k = 0; k < ids.length; k++) {
        setProgress(`${k + 1}/${ids.length}`)
        const r = await api.getRecipe(ids[k])
        if (!r) continue
        await api.saveRecipe({
          ...r,
          category: f.category !== '' ? Number(f.category) : r.category,
          pack_spec: f.pack_spec || r.pack_spec, shelf_life: f.shelf_life || r.shelf_life, vacuum_level: f.vacuum_level || r.vacuum_level,
        }, 'recipe.bulk_edit')
      }
      fb.ok(t('rec.bulkDone', { n: ids.length }))
      setSel(new Set()); setF({ category: '', pack_spec: '', shelf_life: '', vacuum_level: '' })
    } catch (e) { fb.error(e) } finally { setProgress(null); qc.invalidateQueries({ queryKey: ['recipes'] }) }
  }

  return (
    <>
      <Card className="mb-3">
        <div className="form-grid four">
          <Field label={t('cat.category')}>
            <Select value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>
              <option value="">{t('rec.noChange')}</option>
              {(cats.data ?? []).map(c => <option key={c.id} value={c.id}>{lang === 'hu' ? c.name_hu : c.name_en}</option>)}
            </Select>
          </Field>
          <Field label={t('rec.packSpec')}><Input placeholder={t('rec.noChange')} value={f.pack_spec} onChange={e => setF({ ...f, pack_spec: e.target.value })} /></Field>
          <Field label={t('rec.shelfLife')}><Input placeholder={t('rec.noChange')} value={f.shelf_life} onChange={e => setF({ ...f, shelf_life: e.target.value })} /></Field>
          <Field label={t('rec.vacuum')}><Input placeholder={t('rec.noChange')} value={f.vacuum_level} onChange={e => setF({ ...f, vacuum_level: e.target.value })} /></Field>
        </div>
        <Button variant="primary" disabled={!sel.size || nothing || !!progress} loading={!!progress} onClick={apply}>
          {progress ? progress : t('rec.applyTo', { n: sel.size })}
        </Button>
      </Card>
      <div className="toolbar">
        <div className="search grow"><Search size={18} aria-hidden /><Input type="search" placeholder={t('inv.search')} value={q} onChange={e => setQ(e.target.value)} /></div>
        <Button size="sm" variant="ghost" onClick={() => setSel(sel.size === visible.length ? new Set() : new Set(visible.map(r => r.id)))}>
          {sel.size === visible.length && visible.length ? t('rec.selectNone') : t('rec.selectAll')}
        </Button>
      </div>
      <Card>
        {visible.map(r => (
          <button key={r.id} type="button" className={`inv-row${sel.has(r.id) ? ' counted' : ''}`} style={{ opacity: 1 }} onClick={() => toggle(r.id)}>
            <span className="inv-check">{sel.has(r.id) && <Check size={16} />}</span>
            <span className="grow"><span className="inv-name">{recipeName(r, lang)}</span><span className="muted small">{categoryLabel(cats.data ?? [], r.category, lang)}{r.pack_spec ? ` · 📦 ${r.pack_spec}` : ''}{r.vacuum_level ? ` · 🔧 ${r.vacuum_level}` : ''}</span></span>
          </button>
        ))}
      </Card>
    </>
  )
}

function Import() {
  const { t } = useI18n()
  const fb = useFeedback()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const rows = useMemo(() => parseBulkImport(text), [text])
  async function run() {
    try {
      for (let k = 0; k < rows.length; k++) {
        setBusy(`${k + 1}/${rows.length}`)
        const r = rows[k]
        await api.saveRecipe({
          ...r, section: 0, pack_spec: '', shelf_life: '', vacuum_level: '', status: 'published', allergens: [], cover_image: null,
        }, 'recipe.import')
      }
      fb.ok(t('rec.imported', { n: rows.length }))
      setText('')
    } catch (e) { fb.error(e) } finally { setBusy(null); qc.invalidateQueries({ queryKey: ['recipes'] }) }
  }
  return (
    <Card>
      <p className="muted small">{t('rec.importHint')}</p>
      <pre className="code small">EN name ⇥ HU name ⇥ category id ⇥ serves ⇥ prep min ⇥ cook min ⇥ name|qty; name|qty ⇥ step 1; step 2</pre>
      <textarea className="input mono" rows={8} value={text} onChange={e => setText(e.target.value)} placeholder={t('rec.importPh')} />
      <div className="row gap-1 mt-2">
        <span className="muted small grow">{t('rec.importPreview', { n: rows.length })}</span>
        <Button variant="primary" disabled={!rows.length || !!busy} loading={!!busy} onClick={run}>{busy ?? t('rec.importN', { n: rows.length })}</Button>
      </div>
      {rows.length > 0 && (
        <ul className="line-list mt-2">
          {rows.map((r, i) => <li key={i}><b className="grow">{r.en_name || r.hu_name}</b><span className="muted small">{t('rec.versionCounts', { i: r.ingredients.length, s: r.steps.length })}</span></li>)}
        </ul>
      )}
    </Card>
  )
}

function Stats() {
  const { t, lang } = useI18n()
  const recipes = useRecipes()
  const cats = useRecipeCategories()
  if (recipes.isPending) return <Skeleton rows={4} />
  const all = recipes.data ?? []
  const byCat = (cats.data ?? []).map(c => ({ label: lang === 'hu' ? c.name_hu : c.name_en, color: c.color, n: all.filter(r => r.category === c.id).length }))
    .filter(c => c.n).sort((a, b) => b.n - a.n)
  const max = Math.max(1, ...byCat.map(c => c.n))
  const authors = Object.entries(all.reduce<Record<string, number>>((m, r) => { const a = r.author_name || '—'; m[a] = (m[a] || 0) + 1; return m }, {})).sort((a, b) => b[1] - a[1])
  return (
    <>
      <div className="stats">
        <Stat value={all.length} label={t('rec.statTotal')} />
        <Stat value={all.filter(r => r.status === 'draft').length} label={t('rec.draft')} tone="warn" />
        <Stat value={all.filter(r => r.cover_image).length} label={t('rec.statPhoto')} />
        <Stat value={all.filter(r => !r.allergens?.length).length} label={t('rec.statNoAllergen')} />
      </div>
      <div className="grid-2">
        <Card>
          <h3 className="card-title">{t('rec.statByCat')}</h3>
          {byCat.map(c => (
            <div key={c.label} className="store-progress">
              <span className="grow">{c.label}</span>
              <div className="bar wide"><div style={{ width: `${(c.n / max) * 100}%`, background: c.color }} /></div>
              <span className="mono small">{c.n}</span>
            </div>
          ))}
        </Card>
        <Card>
          <h3 className="card-title">{t('rec.statByAuthor')}</h3>
          {authors.map(([a, n]) => <div key={a} className="store-progress"><span className="grow">{a}</span><b>{n}</b></div>)}
        </Card>
      </div>
    </>
  )
}

function Export() {
  const { t, lang } = useI18n()
  const fb = useFeedback()
  const recipes = useRecipes()
  const cats = useRecipeCategories()
  const [busy, setBusy] = useState(false)
  async function full() {
    const out = []
    for (const r of recipes.data ?? []) { const x = await api.getRecipe(r.id); if (x) out.push(x) }
    return out
  }
  async function json() {
    setBusy(true)
    try {
      const data = await full()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `recipes-${todayISO()}.json`; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      fb.ok(t('rec.exported', { n: data.length }))
    } catch (e) { fb.error(e) } finally { setBusy(false) }
  }
  async function csv() {
    setBusy(true)
    try {
      const data = await full()
      downloadCSV(`recipes-${todayISO()}`, [
        { label: 'ID', value: r => r.id }, { label: 'HU Name', value: r => r.hu_name }, { label: 'EN Name', value: r => r.en_name },
        { label: 'Category', value: r => categoryLabel(cats.data ?? [], r.category, lang) }, { label: 'Pack', value: r => r.pack_spec },
        { label: 'Shelf life', value: r => r.shelf_life }, { label: 'Vacuum', value: r => r.vacuum_level }, { label: 'Status', value: r => r.status },
        { label: 'Allergens', value: r => (r.allergens || []).join('; ') }, { label: 'Author', value: r => r.author_name },
        { label: 'Ingredients', value: r => r.ingredients.map(i => `${i.name}${i.qty ? ` (${i.qty})` : ''}`).join('; ') },
        { label: 'Steps', value: r => r.steps.map((s, k) => `${k + 1}. ${s.desc}`).join(' | ') },
      ], data)
      fb.ok(t('rec.exported', { n: data.length }))
    } catch (e) { fb.error(e) } finally { setBusy(false) }
  }
  if (!recipes.data) return <Skeleton rows={3} />
  if (!recipes.data.length) return <Empty title={t('rec.none')} />
  return (
    <Card>
      <p className="muted">{t('rec.exportHint', { n: recipes.data.length })}</p>
      <div className="row gap-1">
        <Button variant="primary" icon={<Download size={16} />} loading={busy} onClick={json}>JSON</Button>
        <Button icon={<Download size={16} />} loading={busy} onClick={csv}>CSV (Excel)</Button>
      </div>
    </Card>
  )
}
