import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Camera, ImagePlus, Plus, Trash2, X } from 'lucide-react'
import * as api from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import type { MessageKey } from '@/lib/i18n/en'
import { ALLERGENS, newId, type Ingredient, type Recipe, type Step } from '@/lib/recipes'
import { useFeedback } from '@/ui/feedback'
import { Button, Card, Field, Input, PageHeader, Select, Skeleton } from '@/ui/primitives'
import { RK, useRecipeCategories } from './hooks'

/** An image is either an uploaded URL or a picked file waiting for upload on save. */
type Img = string | { file: File; preview: string } | null
type EIng = Omit<Ingredient, 'image'> & { image: Img }
type EStep = Omit<Step, 'image'> & { image: Img }
interface Draft {
  id?: string
  hu_name: string; en_name: string; category: number; section: number | null
  serves: number | null; prep_time: number | null; cook_time: number | null
  pack_spec: string; shelf_life: string; vacuum_level: string
  status: 'published' | 'draft'; allergens: string[]
  cover_image: Img; ingredients: EIng[]; steps: EStep[]
}

const blankIng = (): EIng => ({ id: newId(), name: '', enName: '', qty: '', image: null })
const blankStep = (): EStep => ({ id: newId(), desc: '', enDesc: '', image: null })

function fromRecipe(r: Recipe, copy: boolean): Draft {
  return {
    id: copy ? undefined : r.id,
    hu_name: copy && r.hu_name ? `${r.hu_name} (másolat)` : r.hu_name,
    en_name: copy && r.en_name ? `${r.en_name} (copy)` : r.en_name,
    category: r.category, section: r.section, serves: r.serves, prep_time: r.prep_time, cook_time: r.cook_time,
    pack_spec: r.pack_spec || '', shelf_life: r.shelf_life || '', vacuum_level: r.vacuum_level || '',
    status: copy ? 'draft' : r.status, allergens: r.allergens || [], cover_image: r.cover_image,
    ingredients: (r.ingredients || []).map(i => ({ ...i, id: copy ? newId() : i.id || newId(), image: i.image ?? null })),
    steps: (r.steps || []).map(s => ({ ...s, id: copy ? newId() : s.id || newId(), image: s.image ?? null })),
  }
}

export default function RecipeEditPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const from = params.get('from')
  const sourceId = id || from
  const { t, lang } = useI18n()
  const nav = useNavigate()
  const fb = useFeedback()
  const qc = useQueryClient()
  const cats = useRecipeCategories()
  const src = useQuery({ queryKey: RK.one(sourceId || '-'), enabled: !!sourceId, queryFn: () => api.getRecipe(sourceId!) })
  const [d, setD] = useState<Draft | null>(null)
  const [saving, setSaving] = useState<null | 'draft' | 'published'>(null)
  const dirty = useRef(false)

  useEffect(() => {
    if (d) return
    if (sourceId) { if (src.data) setD(fromRecipe(src.data, !id)) }
    else if (cats.data) setD({
      hu_name: '', en_name: '', category: cats.data[0]?.id ?? 0, section: 0, serves: null, prep_time: null, cook_time: null,
      pack_spec: '', shelf_life: '', vacuum_level: '', status: 'published', allergens: [], cover_image: null,
      ingredients: [blankIng()], steps: [blankStep()],
    })
  }, [d, sourceId, id, src.data, cats.data])

  // warn before leaving with unsaved changes
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault() } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])

  if (!d) return <div className="page narrow-page"><Skeleton rows={8} /></div>

  const set = (patch: Partial<Draft>) => { dirty.current = true; setD(x => x && { ...x, ...patch }) }
  const setIng = (i: number, patch: Partial<EIng>) => set({ ingredients: d.ingredients.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const setStep = (i: number, patch: Partial<EStep>) => set({ steps: d.steps.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const move = <T,>(arr: T[], i: number, dir: -1 | 1) => { const a = arr.slice(); const j = i + dir; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a }

  async function upload(img: Img, folder: 'covers' | 'ings' | 'steps'): Promise<string | null> {
    if (!img) return null
    if (typeof img === 'string') return img
    return api.uploadRecipeImage(img.file, folder)
  }

  async function save(status: 'published' | 'draft') {
    if (!d!.hu_name.trim() && !d!.en_name.trim()) { fb.toast(t('rec.nameRequired'), 'bad'); return }
    setSaving(status)
    try {
      // each language falls back to the other, so one-language entry is enough
      const ingredients = []
      for (const i of d!.ingredients) {
        const hu = i.name.trim(), en = (i.enName || '').trim()
        if (!hu && !en) continue
        ingredients.push({ id: i.id, name: hu || en, enName: en || hu, qty: i.qty.trim(), image: await upload(i.image, 'ings') })
      }
      const steps = []
      for (const s of d!.steps) {
        const hu = s.desc.trim(), en = (s.enDesc || '').trim()
        if (!hu && !en) continue
        steps.push({ id: s.id, desc: hu || en, enDesc: en || hu, image: await upload(s.image, 'steps') })
      }
      const res = await api.saveRecipe({
        id: d!.id, hu_name: d!.hu_name.trim(), en_name: d!.en_name.trim(), category: d!.category, section: d!.section,
        serves: d!.serves, prep_time: d!.prep_time, cook_time: d!.cook_time,
        pack_spec: d!.pack_spec.trim(), shelf_life: d!.shelf_life.trim(), vacuum_level: d!.vacuum_level.trim(),
        status, allergens: d!.allergens, cover_image: await upload(d!.cover_image, 'covers'), ingredients, steps,
      }, from ? 'recipe.duplicate' : undefined)
      dirty.current = false
      qc.invalidateQueries({ queryKey: ['recipes'] })
      fb.ok(res.created ? t('rec.created') : t('common.saved'))
      nav(`/recipes/${res.id}`, { replace: true })
    } catch (e) { fb.error(e) } finally { setSaving(null) }
  }

  async function cancel() {
    if (dirty.current && !await fb.confirm({ title: t('rec.discardTitle'), danger: true, confirm: t('rec.discard') })) return
    dirty.current = false
    nav(-1)
  }

  const title = id ? t('rec.editTitle') : from ? t('rec.duplicate') : t('rec.new')
  return (
    <div className="page narrow-page recipe-edit">
      <PageHeader title={title} />

      <Card className="mb-3">
        <Field group label={t('rec.cover')}><ImagePick value={d.cover_image} onChange={v => set({ cover_image: v })} big /></Field>
        <p className="muted small">{t('rec.oneLangHint')}</p>
        <div className="form-grid">
          <Field label={t('cat.nameHu')}><Input value={d.hu_name} onChange={e => set({ hu_name: e.target.value })} autoFocus={!id} /></Field>
          <Field label={t('cat.nameEn')}><Input value={d.en_name} onChange={e => set({ en_name: e.target.value })} /></Field>
          <Field label={t('cat.category')}>
            <Select value={d.category} onChange={e => set({ category: Number(e.target.value) })}>
              {(cats.data ?? []).map(c => <option key={c.id} value={c.id}>{lang === 'hu' ? c.name_hu : c.name_en}</option>)}
            </Select>
          </Field>
          <Field group label={t('rec.servesTime')}>
            <div className="row gap-1">
              <Input inputMode="numeric" aria-label={t('rec.serves')} placeholder={t('rec.serves')} value={d.serves ?? ''} onChange={e => set({ serves: Number(e.target.value) || null })} />
              <Input inputMode="numeric" aria-label={t('rec.prepTime')} placeholder={t('rec.prepTime')} value={d.prep_time ?? ''} onChange={e => set({ prep_time: Number(e.target.value) || null })} />
              <Input inputMode="numeric" aria-label={t('rec.cookTime')} placeholder={t('rec.cookTime')} value={d.cook_time ?? ''} onChange={e => set({ cook_time: Number(e.target.value) || null })} />
            </div>
          </Field>
          <Field label={t('rec.packSpec')}><Input value={d.pack_spec} placeholder="2.5 kg / bag" onChange={e => set({ pack_spec: e.target.value })} /></Field>
          <Field label={t('rec.shelfLife')}><Input value={d.shelf_life} placeholder="5 days / 6 months frozen" onChange={e => set({ shelf_life: e.target.value })} /></Field>
          <Field label={t('rec.vacuum')}><Input value={d.vacuum_level} placeholder="P3" onChange={e => set({ vacuum_level: e.target.value })} /></Field>
        </div>
        <Field group label={t('rec.allergens')}>
          <div className="chips">
            {ALLERGENS.map(a => {
              const on = d.allergens.includes(a)
              return (
                <button key={a} type="button" className={`allergen-chip${on ? ' on' : ''}`} aria-pressed={on}
                  onClick={() => set({ allergens: on ? d.allergens.filter(x => x !== a) : [...d.allergens, a] })}>
                  {t(`allergen.${a}` as MessageKey)}
                </button>
              )
            })}
          </div>
        </Field>
      </Card>

      <Card className="mb-3">
        <h3 className="card-title">{t('rec.ingredients')}</h3>
        {d.ingredients.map((ing, i) => (
          <div key={ing.id} className="edit-row">
            <ImagePick value={ing.image} onChange={v => setIng(i, { image: v })} />
            <div className="edit-row-fields">
              <Input placeholder={t('rec.ingHu')} value={ing.name} onChange={e => setIng(i, { name: e.target.value })} />
              <Input placeholder={t('rec.ingEn')} value={ing.enName || ''} onChange={e => setIng(i, { enName: e.target.value })} />
              <Input className="w-qty-wide" placeholder={t('rec.qtyPh')} value={ing.qty} onChange={e => setIng(i, { qty: e.target.value })} />
            </div>
            <RowTools i={i} n={d.ingredients.length}
              onUp={() => set({ ingredients: move(d.ingredients, i, -1) })} onDown={() => set({ ingredients: move(d.ingredients, i, 1) })}
              onRemove={() => set({ ingredients: d.ingredients.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <Button variant="ghost" icon={<Plus size={16} />} onClick={() => set({ ingredients: [...d.ingredients, blankIng()] })}>{t('rec.addIng')}</Button>
      </Card>

      <Card className="mb-3">
        <h3 className="card-title">{t('rec.steps')}</h3>
        {d.steps.map((s, i) => (
          <div key={s.id} className="edit-row step">
            <span className="step-n">{i + 1}</span>
            <div className="edit-row-fields">
              <textarea className="input" rows={3} placeholder={t('rec.stepHu')} value={s.desc} onChange={e => setStep(i, { desc: e.target.value })} />
              <textarea className="input" rows={3} placeholder={t('rec.stepEn')} value={s.enDesc || ''} onChange={e => setStep(i, { enDesc: e.target.value })} />
              <ImagePick value={s.image} onChange={v => setStep(i, { image: v })} wide />
            </div>
            <RowTools i={i} n={d.steps.length}
              onUp={() => set({ steps: move(d.steps, i, -1) })} onDown={() => set({ steps: move(d.steps, i, 1) })}
              onRemove={() => set({ steps: d.steps.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <Button variant="ghost" icon={<Plus size={16} />} onClick={() => set({ steps: [...d.steps, blankStep()] })}>{t('rec.addStep')}</Button>
      </Card>

      <div className="save-bar">
        <Button variant="ghost" onClick={cancel}>{t('common.cancel')}</Button>
        <span className="grow" />
        <Button loading={saving === 'draft'} disabled={!!saving} onClick={() => save('draft')}>{t('rec.saveDraft')}</Button>
        <Button variant="primary" size="lg" loading={saving === 'published'} disabled={!!saving} onClick={() => save('published')}>{t('rec.publish')}</Button>
      </div>
    </div>
  )
}

function RowTools({ i, n, onUp, onDown, onRemove }: { i: number; n: number; onUp: () => void; onDown: () => void; onRemove: () => void }) {
  return (
    <div className="row-tools">
      <button type="button" aria-label="↑" disabled={i === 0} onClick={onUp}><ArrowUp size={14} /></button>
      <button type="button" aria-label="↓" disabled={i === n - 1} onClick={onDown}><ArrowDown size={14} /></button>
      <button type="button" aria-label="✕" className="text-bad" onClick={onRemove}><Trash2 size={14} /></button>
    </div>
  )
}

function ImagePick({ value, onChange, big, wide }: { value: Img; onChange: (v: Img) => void; big?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const src = !value ? null : typeof value === 'string' ? value : value.preview
  const pick = (f: File | undefined) => { if (f && f.type.startsWith('image/')) onChange({ file: f, preview: URL.createObjectURL(f) }) }
  return (
    <div className={`img-pick${big ? ' big' : ''}${wide ? ' wide' : ''}`}
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files[0]) }}>
      <input ref={ref} type="file" accept="image/*" hidden onChange={e => pick(e.target.files?.[0])} />
      {src ? (
        <>
          <img src={src} alt="" onClick={() => ref.current?.click()} />
          <button type="button" className="img-x" aria-label="✕" onClick={() => onChange(null)}><X size={14} /></button>
        </>
      ) : (
        <button type="button" className="img-empty" onClick={() => ref.current?.click()}>
          {big ? <ImagePlus size={26} /> : <Camera size={18} />}
        </button>
      )}
    </div>
  )
}
