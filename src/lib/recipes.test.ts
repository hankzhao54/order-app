import { describe, expect, it } from 'vitest'
import { aggregatePrep, parseBulkImport, recipeAltName, recipeMatches, recipeName, scaleQty } from './recipes'

const r = (ings: [string, string][]) => ({ ingredients: ings.map(([name, qty], i) => ({ id: String(i), name, enName: name, qty })) })

describe('recipes', () => {
  it('scales free-text quantities', () => {
    expect(scaleQty('500 g', 2)).toBe('1000 g')
    expect(scaleQty('1,5 l', 2)).toBe('3 l')
    expect(scaleQty('1/2 cup', 3)).toBe('1.5 cup')
    expect(scaleQty('2db', 1.5)).toBe('3db')
    expect(scaleQty('ízlés szerint', 3)).toBe('ízlés szerint')
    expect(scaleQty('', 2)).toBe('')
    expect(scaleQty('12.5 kg', 3)).toBe('37.5 kg')
  })
  it('aggregates a prep list, merging same name + unit', () => {
    const list = aggregatePrep([
      { recipe: r([['Salt', '10 g'], ['Water', '2 l'], ['Pepper', 'to taste']]), mult: 2 },
      { recipe: r([['salt', '5 g'], ['Water', '500 ml']]), mult: 1 },
    ], 'en')
    expect(list).toEqual([
      { name: 'Pepper', qty: 'to taste' },
      { name: 'Salt', qty: '25 g' },
      { name: 'Water', qty: '4 l' },
      { name: 'Water', qty: '500 ml' },
    ])
  })
  it('picks names per language with fallbacks', () => {
    expect(recipeName({ hu_name: 'Leves', en_name: 'Soup' }, 'hu')).toBe('Leves')
    expect(recipeName({ hu_name: 'Leves', en_name: '' }, 'en')).toBe('Leves')
    expect(recipeName({ hu_name: 'Leves', en_name: 'Soup' }, 'zh')).toBe('Soup')
    expect(recipeAltName({ hu_name: 'Leves', en_name: 'Soup' }, 'en')).toBe('Leves')
    expect(recipeAltName({ hu_name: 'Soup', en_name: 'Soup' }, 'en')).toBe('')
  })
  it('searches names and ingredients', () => {
    const x = { hu_name: 'Csirke alaplé', en_name: 'Chicken stock', ingredients: [{ id: '1', name: 'Újhagyma', enName: 'Spring onion', qty: '5 kg' }] }
    expect(recipeMatches(x, 'chicken')).toBe(true)
    expect(recipeMatches(x, 'újhagy')).toBe(true)
    expect(recipeMatches(x, 'spring')).toBe(true)
    expect(recipeMatches(x, 'beef')).toBe(false)
  })
  it('parses pasted tab-separated recipes', () => {
    const rows = parseBulkImport('English Name\tHungarian\tCat\nMapo Tofu\tMapo Tofu\t0\t4\t15\t20\tTofu|400g; Pork|100g\tFry.; Simmer.')
    expect(rows).toHaveLength(1)
    expect(rows[0].ingredients.map(i => i.qty)).toEqual(['400g', '100g'])
    expect(rows[0].steps).toHaveLength(2)
  })
})
