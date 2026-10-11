import {
  LayoutDashboard, ShoppingBasket, ChefHat, Truck, ShoppingCart, Boxes, PackageCheck, Tag, History, BarChart3,
  BookOpen, Building2, MapPin, Users, ScrollText, Settings, BookMarked, type LucideIcon,
} from 'lucide-react'

const NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, order: ShoppingBasket, kitchen: ChefHat, dispatch: Truck, buy: ShoppingCart,
  inventory: Boxes, receiving: PackageCheck, labels: Tag, history: History, reports: BarChart3,
  catalog: BookOpen, recipes: BookMarked, suppliers: Building2, locations: MapPin, users: Users, audit: ScrollText, settings: Settings,
}

export function NavIcon({ name, size = 20 }: { name: string; size?: number }) {
  const I = NAV_ICONS[name] ?? LayoutDashboard
  return <I size={size} strokeWidth={1.9} aria-hidden />
}
