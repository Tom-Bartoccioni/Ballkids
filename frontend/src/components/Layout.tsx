import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import api from '@/lib/api'
import {
  Users,
  ClipboardCheck,
  GraduationCap,
  Calendar,
  UserCog,
  LogOut,
  Menu,
  X,
  LayoutDashboard,
  Clock,
  ChevronDown,
  Trophy,
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
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [tournamentDropdownOpen, setTournamentDropdownOpen] = useState(false)
  const [showNewTournament, setShowNewTournament] = useState(false)
  const [newTournament, setNewTournament] = useState({ name: '', year: new Date().getFullYear(), startDate: '', endDate: '' })
  // Reprise des données d'un tournoi précédent
  const [cloneSource, setCloneSource] = useState('')
  const defaultCloneOptions = { ballkids: true, criteria: true, teams: true, days: true }
  const [cloneOptions, setCloneOptions] = useState(defaultCloneOptions)

  // Fetch all tournaments
  const { data: tournamentsData } = useQuery({
    queryKey: ['tournaments'],
    queryFn: async () => {
      const res = await api.get('/tournaments')
      return res.data.data.tournaments
    },
  })

  // Fetch active tournament
  const { data: activeTournament } = useQuery({
    queryKey: ['tournament', 'active'],
    queryFn: async () => {
      const res = await api.get('/tournaments/active')
      return res.data.data.tournament
    },
  })

  // Switch tournament
  const switchMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.put(`/tournaments/${id}/activate`)
    },
    onSuccess: () => {
      // Invalidate everything to refresh all pages
      queryClient.invalidateQueries()
      setTournamentDropdownOpen(false)
    },
  })

  // Create tournament
  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: any = { ...newTournament }
      if (cloneSource) {
        payload.copyFromTournamentId = cloneSource
        payload.cloneOptions = {
          ballkids: cloneOptions.ballkids,
          // La case « Critères de sélection/formation » pilote les deux
          selectionCriteria: cloneOptions.criteria,
          trainingSetup: cloneOptions.criteria,
          teams: cloneOptions.teams,
          days: cloneOptions.days,
          coaches: false,
        }
      }
      const res = await api.post('/tournaments', payload)
      return res.data
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries()
      // Récapitulatif de reprise si des données ont été clonées
      const cloned = data?.data?.cloneSummary
      let description = 'Le nouveau tournoi est prêt.'
      if (cloneSource && cloned) {
        const parts: string[] = []
        if (cloned.ballkids != null) parts.push(`${cloned.ballkids} ramasseur(s)`)
        if (cloned.selectionCriteria != null) parts.push(`${cloned.selectionCriteria} critère(s) de sélection`)
        if (cloned.trainingSessions != null) parts.push(`${cloned.trainingSessions} séance(s) de formation`)
        if (cloned.teams != null) parts.push(`${cloned.teams} équipe(s)`)
        if (cloned.days != null) parts.push(`${cloned.days} jour(s)`)
        if (parts.length) description = `${parts.join(', ')} repris.`
      }
      toast({ title: 'Tournoi créé', description })
      setShowNewTournament(false)
      setNewTournament({ name: '', year: new Date().getFullYear(), startDate: '', endDate: '' })
      setCloneSource('')
      setCloneOptions(defaultCloneOptions)
      setTournamentDropdownOpen(false)
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Échec de la création du tournoi' })
    },
  })

  // Récupérer le nombre de ramasseurs en attente
  const { data: pendingData } = useQuery({
    queryKey: ['ballkids', 'pending-count'],
    queryFn: async () => {
      const res = await api.get('/ballkids/pending')
      return res.data.data
    },
    enabled: isAdmin,
    refetchInterval: 30000,
  })
  const pendingCount = pendingData?.ballkids?.length || 0
  const tournaments = tournamentsData || []

  const filteredNav = navigation.filter((item) => !item.adminOnly || isAdmin)

  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Bandeau mode démonstration */}
      {isDemoMode && (
        <div className="fixed top-0 inset-x-0 z-[60] h-10 flex items-center justify-center bg-amber-500 text-white text-center text-sm font-medium px-4 shadow">
          🔶 Mode démonstration — les données sont réinitialisées automatiquement chaque nuit.
        </div>
      )}

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
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          isDemoMode && 'top-10'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between h-16 px-4 border-b">
            <Link to="/dashboard" className="flex items-center gap-2">
              <img src="/logo4.png" alt="Ballkidsgo" className="h-9 w-9 rounded-full object-cover" />
              <span className="font-semibold text-lg">Ballkidsgo</span>
            </Link>
            <button
              className="lg:hidden p-2 hover:bg-gray-100 rounded"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tournament selector */}
          <div className="px-3 pt-3 pb-1">
            <div className="relative">
              <button
                onClick={() => setTournamentDropdownOpen(!tournamentDropdownOpen)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg border bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <Trophy className="w-4 h-4 text-primary shrink-0" />
                <span className="truncate flex-1 text-left font-medium">
                  {activeTournament?.name || 'Aucun tournoi'}
                </span>
                <ChevronDown className={cn(
                  'w-4 h-4 text-gray-400 shrink-0 transition-transform',
                  tournamentDropdownOpen && 'rotate-180'
                )} />
              </button>
              {tournamentDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => { setTournamentDropdownOpen(false); setShowNewTournament(false) }}
                  />
                  <div className="absolute left-0 right-0 mt-1 z-20 bg-white border rounded-lg shadow-lg py-1 max-h-64 overflow-y-auto">
                    {tournaments.map((t: any) => (
                      <button
                        key={t.id}
                        onClick={() => switchMutation.mutate(t.id)}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors flex items-center justify-between',
                          t.isActive && 'bg-primary/5 text-primary font-medium'
                        )}
                        disabled={switchMutation.isPending}
                      >
                        <span className="truncate">{t.name}</span>
                        {t.isActive && (
                          <span className="w-2 h-2 bg-primary rounded-full shrink-0" />
                        )}
                      </button>
                    ))}
                    {isAdmin && !showNewTournament && (
                      <button
                        onClick={() => setShowNewTournament(true)}
                        className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-gray-50 transition-colors border-t flex items-center gap-2"
                      >
                        <span className="text-lg leading-none">+</span>
                        Nouveau tournoi
                      </button>
                    )}
                    {isAdmin && showNewTournament && (
                      <div className="p-3 border-t space-y-2">
                        <input
                          type="text"
                          placeholder="Nom du tournoi"
                          value={newTournament.name}
                          onChange={(e) => setNewTournament({ ...newTournament, name: e.target.value })}
                          className="w-full px-2 py-1.5 text-sm border rounded"
                        />
                        <input
                          type="number"
                          placeholder="Année"
                          value={newTournament.year}
                          onChange={(e) => setNewTournament({ ...newTournament, year: parseInt(e.target.value) || 0 })}
                          className="w-full px-2 py-1.5 text-sm border rounded"
                        />
                        <input
                          type="date"
                          value={newTournament.startDate}
                          onChange={(e) => setNewTournament({ ...newTournament, startDate: e.target.value })}
                          className="w-full px-2 py-1.5 text-sm border rounded"
                        />
                        <input
                          type="date"
                          value={newTournament.endDate}
                          onChange={(e) => setNewTournament({ ...newTournament, endDate: e.target.value })}
                          className="w-full px-2 py-1.5 text-sm border rounded"
                        />
                        {/* Reprendre les données d'une année précédente */}
                        {tournaments.length > 0 && (
                          <div className="space-y-2 pt-2 border-t">
                            <label className="block text-xs font-medium text-gray-600">
                              Reprendre les données de…
                            </label>
                            <select
                              value={cloneSource}
                              onChange={(e) => setCloneSource(e.target.value)}
                              className="w-full px-2 py-1.5 text-sm border rounded bg-white"
                            >
                              <option value="">Partir de zéro</option>
                              {tournaments.map((t: any) => (
                                <option key={t.id} value={t.id}>
                                  {t.name} ({t.year})
                                </option>
                              ))}
                            </select>
                            {cloneSource && (
                              <div className="space-y-1.5 pl-0.5">
                                {[
                                  { key: 'ballkids', label: 'Ramasseurs' },
                                  { key: 'criteria', label: 'Critères de sélection/formation' },
                                  { key: 'teams', label: 'Équipes' },
                                  { key: 'days', label: 'Jours de tournoi' },
                                ].map((opt) => (
                                  <label
                                    key={opt.key}
                                    className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={cloneOptions[opt.key as keyof typeof cloneOptions]}
                                      onChange={(e) =>
                                        setCloneOptions({ ...cloneOptions, [opt.key]: e.target.checked })
                                      }
                                      className="rounded border-gray-300"
                                    />
                                    {opt.label}
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => createMutation.mutate()}
                            disabled={!newTournament.name || !newTournament.startDate || !newTournament.endDate || createMutation.isPending}
                            className="flex-1 px-2 py-1.5 text-sm bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50"
                          >
                            {createMutation.isPending ? '...' : 'Créer'}
                          </button>
                          <button
                            onClick={() => {
                              setShowNewTournament(false)
                              setCloneSource('')
                              setCloneOptions(defaultCloneOptions)
                            }}
                            className="px-2 py-1.5 text-sm border rounded hover:bg-gray-50"
                          >
                            Annuler
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
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
      <div className={cn('lg:pl-64', isDemoMode && 'pt-10')}>
        {/* Mobile header */}
        <header className={cn(
          'sticky z-30 flex items-center h-16 px-4 bg-white border-b lg:hidden',
          isDemoMode ? 'top-10' : 'top-0'
        )}>
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
