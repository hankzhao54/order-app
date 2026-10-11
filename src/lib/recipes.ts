import type { Lang } from './i18n'

// ---------------------------------------------------------------------------
// Recipe data as the app uses it. The DB stores ingredients/steps as JSON
// arrays; the Hungarian text lives in `name` / `desc` and English in
// `enName` / `enDesc` (kept from the original recipes app so old rows load).
// ---------------------------------------------------------------------------

export interface Ingredient { id: string; name: string; enName?: string; qty: string; image?: string | null }
export interface Step { id: string; desc: string; enDesc?: string; image?: string | null }

export interface Recipe {
  id: string
  hu_name: string
  en_name: string
  category: number
  section: number | null
  serves: number | null
  prep_time: number | null
  cook_time: number | null
  pack_spec: string | null
  shelf_life: string | null
  vacuum_level: string | null
  status: 'published' | 'draft'
  allergens: string[]
  author_id: string | null
  author_name: string | null
  cover_image: string | null
  ingredients: Ingredient[]
  steps: Step[]
  created_at: string
  updated_at: string | null
}

export interface RecipeCategory { id: number; name_en: string; name_hu: string; color: string; sort_order: number }

export const ALLERGENS = ['gluten', 'crustacean', 'egg', 'fish', 'peanut', 'soy', 'milk', 'nut', 'celery', 'mustard', 'sesame', 'sulphite', 'lupin', 'mollusc'] as const
export type Allergen = typeof ALLERGENS[number]

export const CATEGORY_PALETTE = ['#a8833f', '#5a9e6f', '#4a90c4', '#c4774a', '#c06090', '#4ab0c4', '#8b5e9e', '#3d9b9b', '#7a9e3d', '#b0473f']

/** Recipe name in the viewer's language (Chinese viewers get English). */
export function recipeName(r: Pick<Recipe, 'hu_name' | 'en_name'>, lang: Lang): string {
  return lang === 'hu' ? (r.hu_name || r.en_name || '') : (r.en_name || r.hu_name || '')
}
export function recipeAltName(r: Pick<Recipe, 'hu_name' | 'en_name'>, lang: Lang): string {
  const main = recipeName(r, lang)
  const alt = lang === 'hu' ? r.en_name : r.hu_name
  return alt && alt !== main ? alt : ''
}
export const ingName = (i: Ingredient, lang: Lang) => (lang === 'hu' ? i.name || i.enName || '' : i.enName || i.name || '')
export const stepText = (s: Step, lang: Lang) => (lang === 'hu' ? s.desc || s.enDesc || '' : s.enDesc || s.desc || '')

export function categoryLabel(cats: RecipeCategory[], id: number, lang: Lang): string {
  const c = cats.find(x => x.id === id)
  return c ? (lang === 'hu' ? c.name_hu : c.name_en) : '—'
}
export const categoryColor = (cats: RecipeCategory[], id: number) => cats.find(x => x.id === id)?.color || '#a8833f'

/** Name or any ingredient name (both languages) contains the search term. */
export function recipeMatches(r: Pick<Recipe, 'hu_name' | 'en_name' | 'ingredients'>, q: string): boolean {
  const n = q.trim().toLowerCase()
  if (!n) return true
  if ((r.en_name || '').toLowerCase().includes(n) || (r.hu_name || '').toLowerCase().includes(n)) return true
  return (r.ingredients || []).some(i => (i.name || '').toLowerCase().includes(n) || (i.enName || '').toLowerCase().includes(n))
}

/**
 * Scale a free-text quantity: "500 g" ×2 → "1000 g", "1,5 l" ×2 → "3 l", "1/2 cup" ×3 → "1.5 cup".
 * Text without a leading number is returned unchanged.
 */
export function scaleQty(qty: string | null | undefined, multiplier: number): string {
  if (!qty) return ''
  if (multiplier === 1) return qty
  const m = String(qty).trim().match(/^(\d+\s*\/\s*\d+|\d+[.,]\d+|\d+)(\s*.*)$/)
  if (!m) return qty
  let n: number
  if (m[1].includes('/')) {
    const [a, b] = m[1].split('/').map(s => parseFloat(s))
    if (!b) return qty
    n = a / b
  } else {
    n = parseFloat(m[1].replace(',', '.'))
  }
  if (!Number.isFinite(n)) return qty
  return prettyNumber(n * multiplier) + m[2]
}

export function prettyNumber(x: number): string {
  if (Number.isInteger(x)) return String(x)
  return x < 10 ? x.toFixed(2).replace(/\.?0+$/, '') : x.toFixed(1).replace(/\.0$/, '')
}

export interface PrepEntry { id: string; mult: number }

/** Sum ingredients across recipes (× their multipliers), merging same name + unit. */
export function aggregatePrep(entries: { recipe: Pick<Recipe, 'ingredients'>; mult: number }[], lang: Lang) {
  const agg = new Map<string, { name: string; unit: string; num: number | null; text: string[] }>()
  for (const { recipe, mult } of entries) {
    for (const ing of recipe.ingredients || []) {
      const name = ingName(ing, lang)
      if (!name.trim()) continue
      const scaled = scaleQty(ing.qty, mult)
      const m = scaled.trim().match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/)
      const base = name.toLowerCase().trim()
      if (m) {
        const unit = m[2].trim()
        const key = `${base}|${unit.toLowerCase()}`
        const e = agg.get(key) || { name, unit, num: 0, text: [] }
        e.num = (e.num ?? 0) + parseFloat(m[1].replace(',', '.'))
        agg.set(key, e)
      } else {
        const key = `${base}|_`
        const e = agg.get(key) || { name, unit: '', num: null, text: [] }
        if (scaled) e.text.push(scaled)
        agg.set(key, e)
      }
    }
  }
  return [...agg.values()]
    .map(a => ({ name: a.name, qty: a.num != null ? `${prettyNumber(a.num)}${a.unit ? ' ' + a.unit : ''}` : a.text.join(', ') }))
    .sort((x, y) => x.name.localeCompare(y.name))
}

export const newId = () => Math.random().toString(36).slice(2, 9)

/** Parse tab-separated rows pasted from Excel (same format as the old bulk import). */
export function parseBulkImport(text: string) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (!lines.length) return []
  const first = lines[0].toLowerCase()
  const start = first.includes('name') || first.includes('categ') ? 1 : 0
  const out: { en_name: string; hu_name: string; category: number; serves: number; prep_time: number; cook_time: number; ingredients: Ingredient[]; steps: Step[] }[] = []
  for (const line of lines.slice(start)) {
    const cols = line.split('\t')
    if (cols.length < 2) continue
    const [en, hu, cat, serves, prep, cook, ings, steps] = cols
    out.push({
      en_name: (en || '').trim(), hu_name: (hu || '').trim(),
      category: Math.max(0, parseInt(cat) || 0),
      serves: parseInt(serves) || 4, prep_time: parseInt(prep) || 15, cook_time: parseInt(cook) || 30,
      ingredients: (ings || '').split(';').flatMap((s): Ingredient[] => {
        const [n, q] = s.split('|')
        return n?.trim() ? [{ id: newId(), name: n.trim(), enName: n.trim(), qty: (q || '').trim(), image: null }] : []
      }),
      steps: (steps || '').split(';').flatMap((s): Step[] => s.trim() ? [{ id: newId(), desc: s.trim(), enDesc: s.trim(), image: null }] : []),
    })
  }
  return out.filter(r => r.en_name || r.hu_name)
}
