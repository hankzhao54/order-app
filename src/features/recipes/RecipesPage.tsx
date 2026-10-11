import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { BookOpen, ClipboardList, History, Plus, Search, Settings2, Star } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { recipeMatches, recipeName, type Recipe } from '@/lib/recipes'
import { Button, Empty, Input, PageHeader, Segmented, Skeleton } from '@/ui/primitives'
import { RecipeCard } from './RecipeCard'
import { usePrepList, useRecent, useRecipeCategories, useRecipeFavorites, useRecipes } from './hooks'

type Sort = 'newest' | 'name' | 'recent'

export default function RecipesPage() {
  const { t, lang } = useI18n()
  const { can, userId } = useAuth()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const setQ = (v: string) => setParams(p => { if (v) p.set('q', v); else p.delete('q'); return p }, { replace: true })
  const [cat, setCat] = useState<number | null>(null)
  const [onlyFavs, setOnlyFavs] = useState(false)
  const [sort, setSort] = useState<Sort>('newest')

  const recipes = useRecipes()
  const cats = useRecipeCategories()
  const { favs, toggle: toggleFav } = useRecipeFavorites()
  const prep = usePrepList()
  const recent = useRecent()
  const manager = can('recipes.manage')

  const editor = can('recipes.edit')
  // drafts are only shown to people who can edit recipes (and to their author)
  const all = useMemo(() => (recipes.data ?? []).filter(r => r.status !== 'draft' || editor || r.author_id === userId), [recipes.data, editor, userId])

  const list = useMemo(() => {
    const out = all.filter(r => recipeMatches(r, q) && (cat == null || r.category === cat) && (!onlyFavs || favs.has(r.id)))
    const byName = (a: Recipe, b: Recipe) => recipeName(a, lang).localeCompare(recipeName(b, lang))
    out.sort((a, b) => {
      if (sort === 'name') return byName(a, b)
      if (sort === 'recent') {
        const ia = recent.ids.indexOf(a.id), ib = recent.ids.indexOf(b.id)
        const d = (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
        if (d) return d
      }
      return b.created_at.localeCompare(a.created_at)
    })
    // favourites float to the top
    return out.sort((a, b) => Number(favs.has(b.id)) - Number(favs.has(a.id)))
  }, [all, q, cat, onlyFavs, favs, sort, lang, recent.ids])

  const recentRecipes = recent.ids.map(id => all.find(r => r.id === id)).filter(Boolean).slice(0, 6) as Recipe[]
  const countFor = (id: number) => all.filter(r => r.category === id).length

  return (
    <div className="page">
      <PageHeader
        title={t('rec.title')}
        subtitle={recipes.data ? t('rec.count', { n: all.length }) : undefined}
        actions={<>
          {prep.list.length > 0 && <Button icon={<ClipboardList size={16} />} onClick={() => nav('/recipes/prep')}>{t('rec.prepList')} ({prep.list.length})</Button>}
          {manager && <Button variant="ghost" icon={<Settings2 size={16} />} onClick={() => nav('/recipes/admin')}>{t('rec.manage')}</Button>}
          {can('recipes.edit') && <Button variant="primary" icon={<Plus size={16} />} onClick={() => nav('/recipes/new')}>{t('rec.new')}</Button>}
        </>}
      />

      <div className="toolbar wrap">
        <div className="search grow">
          <Search size={18} aria-hidden />
          <Input type="search" placeholder={t('rec.search')} value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Segmented size="sm" value={sort} onChange={setSort} options={[
          { value: 'newest', label: t('rec.sortNewest') }, { value: 'name', label: t('rec.sortName') }, { value: 'recent', label: t('rec.sortRecent') },
        ]} />
      </div>

      {recentRecipes.length > 0 && !q && cat == null && !onlyFavs && (
        <div className="recent-row">
          <History size={14} className="muted" />
          {recentRecipes.map(r => (
            <button key={r.id} type="button" className="tally-chip add-chip" onClick={() => nav(`/recipes/${r.id}`)}>{recipeName(r, lang)}</button>
          ))}
        </div>
      )}

      <div className="cat-chips">
        <button type="button" className={`cat-chip cat-fav${onlyFavs ? ' on' : ''}`} onClick={() => setOnlyFavs(f => !f)}>
          <Star size={14} fill={onlyFavs ? 'currentColor' : 'none'} /> {t('order.favorites')} {favs.size > 0 && <b>{favs.size}</b>}
        </button>
        <button type="button" className={`cat-chip${cat == null ? ' on' : ''}`} onClick={() => setCat(null)}>{t('rec.all')} <b>{all.length}</b></button>
        {(cats.data ?? []).map(c => countFor(c.id) > 0 && (
          <button key={c.id} type="button" className={`cat-chip${cat === c.id ? ' on' : ''}`} style={{ ['--cat' as string]: c.color }} onClick={() => setCat(c.id === cat ? null : c.id)}>
            <span className="cat-dot" /> {lang === 'hu' ? c.name_hu : c.name_en} <b>{countFor(c.id)}</b>
          </button>
        ))}
      </div>

      {recipes.isPending ? <Skeleton variant="cards" rows={6} /> : !list.length ? (
        <Empty icon={<BookOpen size={36} />} title={onlyFavs ? t('rec.noFavs') : t('rec.none')}>{q ? t('rec.noneHint') : undefined}</Empty>
      ) : (
        <div className="rgrid">
          {list.map(r => (
            <RecipeCard
              key={r.id} recipe={r} cats={cats.data ?? []}
              fav={favs.has(r.id)} inPrep={prep.has(r.id)}
              onOpen={() => nav(`/recipes/${r.id}`)} onFav={() => toggleFav(r.id)} onPrep={() => prep.toggle(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
