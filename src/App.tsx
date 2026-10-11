import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { useAuth } from './lib/auth'
import { homeFor, type Capability } from './lib/permissions'
import { isConfigured } from './lib/supabase'
import { AppShell } from './layout/AppShell'
import { Skeleton } from './ui/primitives'
import { LoginPage } from './features/auth/LoginPage'
import { NoRolePage } from './features/auth/NoRolePage'
import { TracePage } from './features/labels/TracePage'
import { useT } from './lib/i18n'

const OrderPage = lazy(() => import('./features/order/OrderPage'))
const BuyListPage = lazy(() => import('./features/procurement/BuyListPage'))
const KitchenPage = lazy(() => import('./features/kitchen/KitchenPage'))
const DispatchPage = lazy(() => import('./features/dispatch/DispatchPage'))
const InventoryPage = lazy(() => import('./features/inventory/InventoryPage'))
const ReceivingPage = lazy(() => import('./features/inventory/ReceivingPage'))
const LabelsPage = lazy(() => import('./features/labels/LabelsPage'))
const LabelPrintPage = lazy(() => import('./features/labels/LabelPrintPage'))
const HistoryPage = lazy(() => import('./features/history/HistoryPage'))
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'))
const DashboardPage = lazy(() => import('./features/admin/DashboardPage'))
const CatalogPage = lazy(() => import('./features/admin/CatalogPage'))
const SuppliersPage = lazy(() => import('./features/admin/SuppliersPage'))
const LocationsPage = lazy(() => import('./features/admin/LocationsPage'))
const UsersPage = lazy(() => import('./features/admin/UsersPage'))
const AuditPage = lazy(() => import('./features/admin/AuditPage'))
const SettingsPage = lazy(() => import('./features/admin/SettingsPage'))
const RecipesPage = lazy(() => import('./features/recipes/RecipesPage'))
const RecipeDetailPage = lazy(() => import('./features/recipes/RecipeDetailPage'))
const RecipeEditPage = lazy(() => import('./features/recipes/RecipeEditPage'))
const PrepListPage = lazy(() => import('./features/recipes/PrepListPage'))
const RecipeAdminPage = lazy(() => import('./features/recipes/RecipeAdminPage'))

function Loading() {
  return <div className="page"><Skeleton rows={6} /></div>
}

function Guard({ cap, children, bare }: { cap?: Capability | Capability[]; children: ReactNode; bare?: boolean }) {
  const { ready, userId, role, can } = useAuth()
  const location = useLocation()
  if (!ready) return <Loading />
  if (!userId) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  if (!role) return <Navigate to="/no-role" replace />
  if (cap && !(Array.isArray(cap) ? cap.some(c => can(c)) : can(cap))) return <Navigate to="/" replace />
  const content = <Suspense fallback={<Loading />}>{children}</Suspense>
  return bare ? content : <AppShell>{content}</AppShell>
}

function Home() {
  const { ready, userId, role } = useAuth()
  if (!ready) return <Loading />
  if (!userId) return <Navigate to="/login" replace />
  return <Navigate to={homeFor(role)} replace />
}

function NotConfigured() {
  const t = useT()
  return (
    <div className="center-screen">
      <div className="card narrow">
        <h2>{t('setup.title')}</h2>
        <p className="muted">{t('setup.body')}</p>
        <pre className="code">VITE_SUPABASE_URL=…{'\n'}VITE_SUPABASE_ANON_KEY=…</pre>
      </div>
    </div>
  )
}

export function App() {
  if (!isConfigured) return <NotConfigured />
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/no-role" element={<NoRolePage />} />
      <Route path="/trace/:id" element={<TracePage />} />
      <Route path="/" element={<Home />} />
      <Route path="/order" element={<Guard cap="order"><OrderPage /></Guard>} />
      <Route path="/buy" element={<Guard cap={['buy.request', 'buy.work']}><BuyListPage /></Guard>} />
      <Route path="/kitchen" element={<Guard cap="kitchen"><KitchenPage /></Guard>} />
      <Route path="/dispatch" element={<Guard cap="dispatch"><DispatchPage /></Guard>} />
      <Route path="/inventory" element={<Guard cap="inventory"><InventoryPage /></Guard>} />
      <Route path="/receiving" element={<Guard cap="receiving"><ReceivingPage /></Guard>} />
      <Route path="/labels" element={<Guard cap="labels"><LabelsPage /></Guard>} />
      <Route path="/label/:id" element={<Guard cap="labels" bare><LabelPrintPage /></Guard>} />
      <Route path="/history" element={<Guard cap="history"><HistoryPage /></Guard>} />
      <Route path="/reports" element={<Guard cap="reports"><ReportsPage /></Guard>} />
      <Route path="/admin" element={<Guard cap="admin"><DashboardPage /></Guard>} />
      <Route path="/admin/catalog" element={<Guard cap="catalog"><CatalogPage /></Guard>} />
      <Route path="/admin/suppliers" element={<Guard cap="admin"><SuppliersPage /></Guard>} />
      <Route path="/admin/locations" element={<Guard cap="admin"><LocationsPage /></Guard>} />
      <Route path="/admin/users" element={<Guard cap="admin"><UsersPage /></Guard>} />
      <Route path="/admin/audit" element={<Guard cap="admin"><AuditPage /></Guard>} />
      <Route path="/admin/settings" element={<Guard cap="admin"><SettingsPage /></Guard>} />
      <Route path="/recipes" element={<Guard cap="recipes"><RecipesPage /></Guard>} />
      <Route path="/recipes/new" element={<Guard cap="recipes.edit"><RecipeEditPage /></Guard>} />
      <Route path="/recipes/prep" element={<Guard cap="recipes"><PrepListPage /></Guard>} />
      <Route path="/recipes/admin" element={<Guard cap="recipes.manage"><RecipeAdminPage /></Guard>} />
      <Route path="/recipes/:id" element={<Guard cap="recipes"><RecipeDetailPage /></Guard>} />
      <Route path="/recipes/:id/edit" element={<Guard cap="recipes.edit"><RecipeEditPage /></Guard>} />
      {/* v1 URLs keep working */}
      <Route path="/procurement" element={<Navigate to="/buy" replace />} />
      <Route path="/admin/dashboard" element={<Navigate to="/admin" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
