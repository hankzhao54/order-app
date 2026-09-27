import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { LogOut, Moon, Sun, Languages, HelpCircle, MoreHorizontal, MapPin } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { navFor } from '@/lib/permissions'
import { LANGS, useI18n } from '@/lib/i18n'
import { NavIcon } from '@/ui/Icon'
import { Sheet } from '@/ui/Sheet'
import type { MessageKey } from '@/lib/i18n/en'
import { displayUsername } from '@/lib/username'

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark')
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try { localStorage.setItem('theme', dark ? 'dark' : 'light') } catch { /* ignore */ }
  }, [dark])
  return [dark, setDark] as const
}

const BOTTOM_SLOTS = 4

export function AppShell({ children }: { children: ReactNode }) {
  const { role, profile, email, signOut } = useAuth()
  const { t, lang, setLang } = useI18n()
  const [dark, setDark] = useTheme()
  const [more, setMore] = useState(false)
  const nav = useNavigate()
  const loc = useLocation()
  useEffect(() => setMore(false), [loc.pathname])

  const items = navFor(role)
  const primary = items.filter(i => i.primary).slice(0, BOTTOM_SLOTS)
  const rest = items.filter(i => !primary.includes(i))
  const name = profile?.full_name || displayUsername(email) || ''
  const guide = lang === 'hu' ? '/user-guide-hu.html' : '/user-guide.html'

  const logout = async () => { await signOut(); nav('/login') }

  const Prefs = (
    <div className="prefs">
      <div className="prefs-row">
        <Languages size={16} aria-hidden />
        <div className="seg seg-sm">
          {LANGS.map(l => (
            <button key={l.code} type="button" className={l.code === lang ? 'on' : ''} onClick={() => setLang(l.code)}>{l.label}</button>
          ))}
        </div>
      </div>
      <div className="prefs-row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDark(d => !d)}>
          {dark ? <Sun size={16} /> : <Moon size={16} />}<span>{dark ? t('shell.light') : t('shell.dark')}</span>
        </button>
        <a className="btn btn-ghost btn-sm" href={guide} target="_blank" rel="noopener"><HelpCircle size={16} /><span>{t('shell.help')}</span></a>
      </div>
    </div>
  )

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">订</span><span>Order</span></div>
        <nav className="side-nav">
          {items.map(i => (
            <NavLink key={i.to} to={i.to} end={i.to === '/admin'} className="side-link">
              <NavIcon name={i.icon} />
              <span>{t(i.key as MessageKey)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          {Prefs}
          <div className="who">
            <div className="who-name">{name}</div>
            <div className="who-meta">
              {role && t(`role.${role}` as MessageKey)}
              {profile?.location && <> · <MapPin size={12} /> {profile.location.name_en}</>}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={logout}><LogOut size={16} /><span>{t('shell.signOut')}</span></button>
          </div>
        </div>
      </aside>

      <header className="topbar">
        <div className="brand"><span className="brand-mark">订</span><span>Order</span></div>
        <div className="topbar-who">
          {profile?.location && <span className="chip-loc"><MapPin size={12} /> {profile.location.name_en}</span>}
        </div>
      </header>

      <main className="main" id="main">{children}</main>

      <nav className="bottom-nav" aria-label="Main">
        {primary.map(i => (
          <NavLink key={i.to} to={i.to} end={i.to === '/admin'} className="bottom-link">
            <NavIcon name={i.icon} size={22} />
            <span>{t(i.key as MessageKey)}</span>
          </NavLink>
        ))}
        <button type="button" className="bottom-link" onClick={() => setMore(true)}>
          <MoreHorizontal size={22} />
          <span>{t('shell.more')}</span>
        </button>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title={name || t('shell.more')}>
        {rest.length > 0 && (
          <div className="more-grid">
            {rest.map(i => (
              <NavLink key={i.to} to={i.to} className="more-link">
                <NavIcon name={i.icon} size={22} />
                <span>{t(i.key as MessageKey)}</span>
              </NavLink>
            ))}
          </div>
        )}
        {Prefs}
        <button type="button" className="btn btn-secondary btn-block mt-3" onClick={logout}><LogOut size={16} /><span>{t('shell.signOut')}</span></button>
      </Sheet>
    </div>
  )
}
