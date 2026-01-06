import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import api from '@/lib/api'
import {
  Users,
  ClipboardCheck,
  GraduationCap,
  UsersRound,
  Calendar,
  UserCog,
  LogOut,
  Menu,
  X,
  LayoutDashboard,
  Clock,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Ramasseurs', href: '/ballkids', icon: Users },
  { name: 'En attente', href: '/ballkids/pending', icon: Clock, adminOnly: true, showBadge: true },
  { name: 'Sélection', href: '/selection', icon: ClipboardCheck },
  { name: 'Formations', href: '/training', icon: GraduationCap },
  { name: 'Tournoi', href: '/schedule', icon: Calendar },
  { name: 'Coachs', href: '/coaches', icon: UserCog },
]

export default function Layout() {
  const { user, logout, isAdmin } = useAuth()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Récupérer le nombre de ramasseurs en attente
  const { data: pendingData } = useQuery({
    queryKey: ['ballkids', 'pending-count'],
    queryFn: async () => {
      const res = await api.get('/ballkids/pending')
      return res.data.data
    },
    enabled: isAdmin,
    refetchInterval: 30000, // Rafraîchir toutes les 30 secondes
  })
  const pendingCount = pendingData?.ballkids?.length || 0

  const filteredNav = navigation.filter((item) => !item.adminOnly || isAdmin)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-white border-r transform transition-transform duration-200 lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between h-16 px-4 border-b">
            <Link to="/dashboard" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-white font-bold">BK</span>
              </div>
              <span className="font-semibold text-lg">Ballkids</span>
            </Link>
            <button
              className="lg:hidden p-2 hover:bg-gray-100 rounded"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {filteredNav.map((item) => {
              // Check if another nav item matches better (more specific)
              const anotherItemMatchesBetter = filteredNav.some(
                (other) => other !== item && 
                  location.pathname.startsWith(other.href) && 
                  other.href.length > item.href.length
              )
              const isActive = (location.pathname === item.href ||
                (item.href !== '/dashboard' && location.pathname.startsWith(item.href))) &&
                !anotherItemMatchesBetter
              const showBadge = item.showBadge && pendingCount > 0
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={cn(
                    'flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  )}
                  onClick={() => setSidebarOpen(false)}
                >
                  <div className="flex items-center gap-3">
                    <item.icon className="w-5 h-5" />
                    {item.name}
                  </div>
                  {showBadge && (
                    <span className={cn(
                      'px-2 py-0.5 text-xs font-bold rounded-full',
                      isActive
                        ? 'bg-white text-primary'
                        : 'bg-orange-500 text-white'
                    )}>
                      {pendingCount}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>

          {/* User section */}
          <div className="border-t p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                <span className="text-primary font-semibold">
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-xs text-gray-500">{user?.role}</p>
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={logout}
            >
              <LogOut className="w-4 h-4" />
              Déconnexion
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Mobile header */}
        <header className="sticky top-0 z-30 flex items-center h-16 px-4 bg-white border-b lg:hidden">
          <button
            className="p-2 hover:bg-gray-100 rounded"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="ml-3 font-semibold">Ballkids Manager</span>
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
