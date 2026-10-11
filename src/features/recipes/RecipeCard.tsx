import { ClipboardList, Check, Star } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { categoryColor, categoryLabel, recipeAltName, recipeName, type Recipe, type RecipeCategory } from '@/lib/recipes'

export function RecipeCard({ recipe, cats, fav, inPrep, onOpen, onFav, onPrep }: {
  recipe: Recipe; cats: RecipeCategory[]; fav: boolean; inPrep: boolean
  onOpen: () => void; onFav: () => void; onPrep: () => void
}) {
  const { t, lang } = useI18n()
  const col = categoryColor(cats, recipe.category)
  const name = recipeName(recipe, lang)
  const alt = recipeAltName(recipe, lang)
  return (
    <div className="rcard" style={{ ['--cat' as string]: col }}>
      <button type="button" className="rcard-open" onClick={onOpen} aria-label={name}>
        <div className="rcard-img">
          {recipe.cover_image
            ? <img src={recipe.cover_image} alt="" loading="lazy" />
            : <span className="rcard-initial">{(name || '·')[0]}</span>}
          <span className="rcard-cat">{categoryLabel(cats, recipe.category, lang)}</span>
          {recipe.status === 'draft' && <span className="rcard-draft">{t('rec.draft')}</span>}
        </div>
        <div className="rcard-body">
          <div className="rcard-name">{name}</div>
          {alt && <div className="rcard-alt">{alt}</div>}
          <div className="rcard-meta">
            {recipe.pack_spec && <span>📦 {recipe.pack_spec}</span>}
            {recipe.vacuum_level && <span>🔧 {recipe.vacuum_level}</span>}
            {recipe.allergens?.length > 0 && <span className="text-bad">⚠ {recipe.allergens.length}</span>}
          </div>
        </div>
      </button>
      <div className="rcard-actions">
        <button type="button" className={`rcard-btn${inPrep ? ' on-prep' : ''}`} aria-pressed={inPrep} aria-label={t('rec.addToPrep')} title={t('rec.addToPrep')} onClick={onPrep}>
          {inPrep ? <Check size={16} /> : <ClipboardList size={16} />}
        </button>
        <button type="button" className={`rcard-btn${fav ? ' on-fav' : ''}`} aria-pressed={fav} aria-label={t('order.favorite')} onClick={onFav}>
          <Star size={16} fill={fav ? 'currentColor' : 'none'} />
        </button>
      </div>
    </div>
  )
}
