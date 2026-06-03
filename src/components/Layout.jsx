import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthProvider'

export default function Layout({ children }) {
  const { profile, role, isStaff, signOut } = useAuth()
  const nav = useNavigate()
  const orderer = role === 'restaurant_orderer'
  const driver = role === 'driver'
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">订货 · <span>Order</span></div>
        <nav className="nav">
          {(orderer || isStaff) &&
            <NavLink to="/order" className="navlink">Order</NavLink>}
          {isStaff && <NavLink to="/kitchen" className="navlink">Kitchen</NavLink>}
          {(isStaff || driver) && <NavLink to="/dispatch" className="navlink">Dispatch</NavLink>}
          {(orderer || isStaff || driver) && <NavLink to="/procurement" className="navlink">Procurement</NavLink>}
          <NavLink to="/history" className="navlink">History</NavLink>
          {role === 'admin' && <>
            <NavLink to="/admin/catalog" className="navlink">Catalog</NavLink>
            <NavLink to="/admin/locations" className="navlink">Locations</NavLink>
            <NavLink to="/admin/users" className="navlink">Users</NavLink>
          </>}
        </nav>
        <div className="who">
          <span className="muted">{profile?.full_name || role}</span>
          <button className="ghost" onClick={async () => { await signOut(); nav('/login') }}>Sign out</button>
        </div>
      </header>
      <main className="main">{children}</main>
    </div>
  )
}
