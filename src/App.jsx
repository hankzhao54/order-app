import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/AuthProvider'
import RequireAuth from './components/RequireAuth'
import Layout from './components/Layout'
import Login from './pages/Login'
import OrderingPage from './pages/OrderingPage'
import KitchenPage from './pages/KitchenPage'
import DispatchPage from './pages/DispatchPage'
import ProcurementPage from './pages/ProcurementPage'
import HistoryPage from './pages/HistoryPage'
import InventoryPage from './pages/InventoryPage'
import CatalogAdmin from './pages/admin/CatalogAdmin'
import LocationsAdmin from './pages/admin/LocationsAdmin'
import UsersAdmin from './pages/admin/UsersAdmin'
import SuppliersAdmin from './pages/admin/SuppliersAdmin'
import Dashboard from './pages/admin/Dashboard'

function Home() {
  const { role, user, loading } = useAuth()
  if (loading) return <div className="center muted">Loading…</div>
  if (role === 'admin') return <Navigate to="/admin/dashboard" replace />
  if (role === 'kitchen_manager') return <Navigate to="/kitchen" replace />
  if (role === 'driver') return <Navigate to="/dispatch" replace />
  if (role === 'restaurant_orderer' || role === 'store_manager') return <Navigate to="/order" replace />
  // Signed in but no ordering role yet -> don't bounce between routes.
  return (
    <div className="center muted">
      <p>Signed in as {user?.email}, but this account has no ordering role yet.</p>
      <p className="small">Add a row in <code>ordering.profiles</code> (role + location), then refresh.</p>
    </div>
  )
}

const staff = ['kitchen_manager', 'admin']
const dispatchers = ['kitchen_manager', 'admin', 'driver']
const buyers = ['restaurant_orderer', 'store_manager', 'kitchen_manager', 'admin', 'driver']
const everyone = ['restaurant_orderer', 'store_manager', 'kitchen_manager', 'admin', 'driver']
const orderers = ['restaurant_orderer', 'store_manager', 'kitchen_manager', 'admin']

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
      <Route path="/order" element={<RequireAuth allow={orderers}><Layout><OrderingPage /></Layout></RequireAuth>} />
      <Route path="/dispatch" element={<RequireAuth allow={dispatchers}><Layout><DispatchPage /></Layout></RequireAuth>} />
      <Route path="/procurement" element={<RequireAuth allow={buyers}><Layout><ProcurementPage /></Layout></RequireAuth>} />
      <Route path="/history" element={<RequireAuth allow={everyone}><Layout><HistoryPage /></Layout></RequireAuth>} />
      <Route path="/inventory" element={<RequireAuth allow={['kitchen_manager','admin','store_manager']}><Layout><InventoryPage /></Layout></RequireAuth>} />
      <Route path="/kitchen" element={<RequireAuth allow={staff}><Layout><KitchenPage /></Layout></RequireAuth>} />
      <Route path="/admin/dashboard" element={<RequireAuth allow={['admin']}><Layout><Dashboard /></Layout></RequireAuth>} />
      <Route path="/admin/catalog" element={<RequireAuth allow={['admin']}><Layout><CatalogAdmin /></Layout></RequireAuth>} />
      <Route path="/admin/locations" element={<RequireAuth allow={['admin']}><Layout><LocationsAdmin /></Layout></RequireAuth>} />
      <Route path="/admin/suppliers" element={<RequireAuth allow={['admin']}><Layout><SuppliersAdmin /></Layout></RequireAuth>} />
      <Route path="/admin/users" element={<RequireAuth allow={['admin']}><Layout><UsersAdmin /></Layout></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
