import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { en, type MessageKey } from './i18n/en'
import { hu } from './i18n/hu'
import { zh } from './i18n/zh'
import { setFormatLocale } from './format'

export type Lang = 'en' | 'hu' | 'zh'
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hu', label: 'Magyar' },
  { code: 'zh', label: '中文' },
]
const DICTS: Record<Lang, Record<MessageKey, string>> = { en, hu, zh }

export type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string

function interpolate(s: string, vars?: Record<string, string | number>) {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : `{${k}}`))
}

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>) {
  return interpolate(DICTS[lang][key] ?? en[key] ?? key, vars)
}

function initialLang(): Lang {
  try {
    const s = localStorage.getItem('lang') as Lang | null
    if (s && s in DICTS) return s
  } catch { /* storage blocked */ }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase()
  if (nav.startsWith('hu')) return 'hu'
  if (nav.startsWith('zh')) return 'zh'
  return 'en'
}

interface I18n { lang: Lang; setLang: (l: Lang) => void; t: TFn }
const Ctx = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const l = initialLang()
    setFormatLocale(l)
    return l
  })
  const setLang = useCallback((l: Lang) => {
    setFormatLocale(l)
    setLangState(l)
    document.documentElement.lang = l
    try { localStorage.setItem('lang', l) } catch { /* ignore */ }
  }, [])
  const t = useCallback<TFn>((key, vars) => translate(lang, key, vars), [lang])
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  const v = useContext(Ctx)
  if (!v) throw new Error('useI18n outside I18nProvider')
  return v
}
export const useT = () => useI18n().t

/** Pick the item name in the viewer's language (HU when available for hu). */
export function itemName(lang: Lang, item: { name_en: string; name_hu?: string | null } | null | undefined): string {
  if (!item) return ''
  return lang === 'hu' && item.name_hu ? item.name_hu : item.name_en
}
