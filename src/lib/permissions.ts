import type { Role } from './types'

// One place that says who can do what. The database enforces the same rules
// (RLS + role checks inside the RPCs); this only decides what the UI offers.
export type Capability =
  | 'order' | 'order.anyLocation' | 'buy.request' | 'buy.work' | 'kitchen' | 'labels'
  | 'dispatch' | 'dispatch.bulk' | 'inventory' | 'inventory.anyLocation' | 'inventory.overview'
  | 'receiving' | 'reports' | 'history' | 'history.all' | 'catalog' | 'catalog.prices' | 'admin'

const CAPS: Record<Role, Capability[]> = {
  restaurant_orderer: ['order', 'buy.request', 'history', 'receiving'],
  store_manager: ['order', 'buy.request', 'history', 'inventory', 'receiving', 'catalog'],
  bar_staff: ['inventory'],
  driver: ['buy.work', 'dispatch', 'history', 'history.all'],
  kitchen_manager: [
    'order', 'order.anyLocation', 'buy.request', 'buy.work', 'kitchen', 'labels', 'dispatch', 'dispatch.bulk',
    'inventory', 'inventory.anyLocation', 'inventory.overview', 'receiving', 'reports', 'history', 'history.all',
  ],
  admin: [
    'order', 'order.anyLocation', 'buy.request', 'buy.work', 'kitchen', 'labels', 'dispatch', 'dispatch.bulk',
    'inventory', 'inventory.anyLocation', 'inventory.overview', 'receiving', 'reports', 'history', 'history.all',
    'catalog', 'catalog.prices', 'admin',
  ],
}

export function can(role: Role | null | undefined, cap: Capability): boolean {
  return !!role && CAPS[role].includes(cap)
}

export const isStaffRole = (role: Role | null | undefined) => role === 'kitchen_manager' || role === 'admin'
export const isStoreRole = (role: Role | null | undefined) =>
  role === 'restaurant_orderer' || role === 'store_manager' || role === 'bar_staff'

export interface NavItem { to: string; key: string; cap: Capability; icon: string; primary?: boolean }

// Order matters: the first `primary` items a role can see fill the phone's bottom bar.
export const NAV: NavItem[] = [
  { to: '/admin', key: 'nav.dashboard', cap: 'admin', icon: 'dashboard', primary: true },
  { to: '/order', key: 'nav.order', cap: 'order', icon: 'order', primary: true },
  { to: '/kitchen', key: 'nav.kitchen', cap: 'kitchen', icon: 'kitchen', primary: true },
  { to: '/dispatch', key: 'nav.dispatch', cap: 'dispatch', icon: 'dispatch', primary: true },
  { to: '/buy', key: 'nav.buy', cap: 'buy.request', icon: 'buy', primary: true },
  { to: '/buy', key: 'nav.buy', cap: 'buy.work', icon: 'buy', primary: true },
  { to: '/inventory', key: 'nav.inventory', cap: 'inventory', icon: 'inventory', primary: true },
  { to: '/receiving', key: 'nav.receiving', cap: 'receiving', icon: 'receiving', primary: true },
  { to: '/labels', key: 'nav.labels', cap: 'labels', icon: 'labels' },
  { to: '/history', key: 'nav.history', cap: 'history', icon: 'history' },
  { to: '/reports', key: 'nav.reports', cap: 'reports', icon: 'reports' },
  { to: '/admin/catalog', key: 'nav.catalog', cap: 'catalog', icon: 'catalog' },
  { to: '/admin/suppliers', key: 'nav.suppliers', cap: 'admin', icon: 'suppliers' },
  { to: '/admin/locations', key: 'nav.locations', cap: 'admin', icon: 'locations' },
  { to: '/admin/users', key: 'nav.users', cap: 'admin', icon: 'users' },
  { to: '/admin/audit', key: 'nav.audit', cap: 'admin', icon: 'audit' },
  { to: '/admin/settings', key: 'nav.settings', cap: 'admin', icon: 'settings' },
]

export function navFor(role: Role | null | undefined): NavItem[] {
  const seen = new Set<string>()
  return NAV.filter(n => {
    if (!can(role, n.cap) || seen.has(n.to)) return false
    seen.add(n.to)
    return true
  })
}

export function homeFor(role: Role | null | undefined): string {
  switch (role) {
    case 'admin': return '/admin'
    case 'kitchen_manager': return '/kitchen'
    case 'driver': return '/dispatch'
    case 'bar_staff': return '/inventory'
    case 'restaurant_orderer':
    case 'store_manager': return '/order'
    default: return '/no-role'
  }
}

export const ROLES: Role[] = ['restaurant_orderer', 'store_manager', 'bar_staff', 'kitchen_manager', 'driver', 'admin']
export const STORE_BOUND_ROLES: Role[] = ['restaurant_orderer', 'store_manager', 'bar_staff']
