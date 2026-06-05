import { NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../lib/AuthProvider'

function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'))
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try { localStorage.setItem('theme', dark ? 'dark' : 'light') } catch {}
  }, [dark])
  return (
    <button className="themebtn" title={dark ? 'Light mode' : 'Dark mode'} onClick={() => setDark(d => !d)}>
      {dark ? '☀️' : '🌙'}
    </button>
  )
}

export default function Layout({ children }) {
  const { profile, role, isStaff, signOut } = useAuth()
  const nav = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const orderer = role === 'restaurant_orderer'
  const storeMgr = role === 'store_manager'
  const barStaff = role === 'bar_staff'
  const driver = role === 'driver'
  return (
    <div className="app">
      <header className="topbar">
        <button className="navtoggle" aria-label="Menu" onClick={() => setMenuOpen(o => !o)}>☰</button>
        <div className="brand">订货 · <span>Order</span></div>
        <nav className={`nav${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(false)}>
          {role === 'admin' && <NavLink to="/admin/dashboard" className="navlink">Dashboard</NavLink>}
          {(orderer || storeMgr || isStaff) &&
            <NavLink to="/order" className="navlink">Order</NavLink>}
          {isStaff && <NavLink to="/kitchen" className="navlink">Kitchen</NavLink>}
          {(isStaff || storeMgr || barStaff) && <NavLink to="/inventory" className="navlink">Inventory</NavLink>}
          {isStaff && <NavLink to="/reports" className="navlink">Reports</NavLink>}
          {(isStaff || driver) && <NavLink to="/dispatch" className="navlink">Dispatch</NavLink>}
          {(orderer || storeMgr || isStaff || driver) && <NavLink to="/procurement" className="navlink">Procurement</NavLink>}
          <NavLink to="/history" className="navlink">History</NavLink>
          {role === 'admin' && <>
            <NavLink to="/admin/catalog" className="navlink">Catalog</NavLink>
            <NavLink to="/admin/suppliers" className="navlink">Suppliers</NavLink>
            <NavLink to="/admin/locations" className="navlink">Locations</NavLink>
            <NavLink to="/admin/users" className="navlink">Users</NavLink>
          </>}
        </nav>
        <div className="who">
          <ThemeToggle />
          <span className="muted">{profile?.full_name || role}</span>
          <button className="ghost" onClick={async () => { await signOut(); nav('/login') }}>Sign out</button>
        </div>
      </header>
      <main className="main">{children}</main>
    </div>
  )
}
