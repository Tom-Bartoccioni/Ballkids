import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, UserCheck, UsersRound, Calendar, Clock, Pencil, Save, X } from 'lucide-react'

export default function DashboardPage() {
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)
  const [editData, setEditData] = useState({
    name: '',
    startDate: '',
    endDate: '',
  })

  const { data: tournament } = useQuery({
    queryKey: ['tournament', 'active'],
    queryFn: async () => {
      const res = await api.get('/tournaments/active')
      return res.data.data.tournament
    },
  })

  const { data: ballkidsData } = useQuery({
    queryKey: ['ballkids', 'stats'],
    queryFn: async () => {
      const res = await api.get('/ballkids', { params: { excludePending: true, limit: 1 } })
      return res.data.data
    },
  })

  const { data: pendingData } = useQuery({
    queryKey: ['ballkids', 'pending'],
    queryFn: async () => {
      const res = await api.get('/ballkids/pending')
      return res.data.data
    },
  })

  const { data: selectedData } = useQuery({
    queryKey: ['ballkids', 'selected'],
    queryFn: async () => {
      const res = await api.get('/ballkids', { params: { status: 'SELECTED', limit: 1 } })
      return res.data.data
    },
  })

  const { data: trainingSummaryData } = useQuery({
    queryKey: ['training', 'summary', tournament?.id],
    queryFn: async () => {
      if (!tournament?.id) return null
      const res = await api.get(`/training/${tournament.id}/summary/all`)
      return res.data.data
    },
    enabled: !!tournament?.id,
  })

  const sessionCompletion = trainingSummaryData?.sessionCompletion || {}

  const stats = [
    {
      name: 'Total ramasseurs',
      value: ballkidsData?.pagination?.total || 0,
      icon: Users,
      href: '/ballkids',
      color: 'bg-blue-500',
    },
    {
      name: 'En attente',
      value: pendingData?.ballkids?.length || 0,
      icon: Clock,
      href: '/ballkids/pending',
      color: 'bg-orange-500',
    },
    {
      name: 'Sélectionnés',
      value: selectedData?.pagination?.total || 0,
      icon: UserCheck,
      href: '/selection',
      color: 'bg-green-500',
    },
    {
      name: 'Équipes',
      value: tournament?._count?.teams || 0,
      icon: UsersRound,
      href: '/schedule',
      color: 'bg-purple-500',
    },
  ]

  const updateTournamentMutation = useMutation({
    mutationFn: (data: { name: string; startDate: string; endDate: string }) =>
      api.put(`/tournaments/${tournament.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tournament', 'active'] })
      setIsEditing(false)
    },
  })

  const handleEdit = () => {
    if (!tournament) return
    setEditData({
      name: tournament.name || '',
      startDate: tournament.startDate ? new Date(tournament.startDate).toISOString().split('T')[0] : '',
      endDate: tournament.endDate ? new Date(tournament.endDate).toISOString().split('T')[0] : '',
    })
    setIsEditing(true)
  }

  const handleCancel = () => {
    setIsEditing(false)
  }

  const handleSave = () => {
    updateTournamentMutation.mutate(editData)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          {tournament ? tournament.name : 'Aucun tournoi actif'}
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.name} to={stat.href}>
            <Card className="hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.name}
                </CardTitle>
                <div className={`p-2 rounded-lg ${stat.color}`}>
                  <stat.icon className="h-4 w-4 text-white" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Tournament info */}
      {tournament && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Tournoi actif
              </span>
              {isAdmin && !isEditing && (
                <Button variant="outline" size="sm" onClick={handleEdit}>
                  <Pencil className="w-4 h-4 mr-1" />
                  Modifier
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isEditing ? (
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Nom</p>
                  <Input
                    value={editData.name}
                    onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Début</p>
                  <Input
                    type="date"
                    value={editData.startDate}
                    onChange={(e) => setEditData({ ...editData, startDate: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Fin</p>
                  <Input
                    type="date"
                    value={editData.endDate}
                    onChange={(e) => setEditData({ ...editData, endDate: e.target.value })}
                  />
                </div>
                <div className="md:col-span-3 flex gap-2">
                  <Button onClick={handleSave} disabled={updateTournamentMutation.isPending}>
                    <Save className="w-4 h-4 mr-1" />
                    {updateTournamentMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
                  </Button>
                  <Button variant="outline" onClick={handleCancel}>
                    <X className="w-4 h-4 mr-1" />
                    Annuler
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <p className="text-sm text-muted-foreground">Nom</p>
                  <p className="font-medium">{tournament.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Début</p>
                  <p className="font-medium">
                    {new Date(tournament.startDate).toLocaleDateString('fr-FR')}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Fin</p>
                  <p className="font-medium">
                    {new Date(tournament.endDate).toLocaleDateString('fr-FR')}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Quick actions */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Actions rapides</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link
              to="/ballkids/pending"
              className="block p-3 rounded-lg bg-orange-50 hover:bg-orange-100 transition-colors"
            >
              <span className="font-medium text-orange-700">
                Valider les inscriptions en attente
              </span>
              <span className="text-sm text-orange-600 block">
                {pendingData?.ballkids?.length || 0} en attente
              </span>
            </Link>
            <Link
              to="/schedule"
              className="block p-3 rounded-lg bg-purple-50 hover:bg-purple-100 transition-colors"
            >
              <span className="font-medium text-purple-700">
                Gérer les équipes
              </span>
              <span className="text-sm text-purple-600 block">
                Constitution et modifications
              </span>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Séances de formation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[1, 2, 3, 4].map((num) => {
                const isCompleted = sessionCompletion[num] === true
                return (
                  <div
                    key={num}
                    className="flex items-center justify-between p-2 rounded bg-gray-50"
                  >
                    <span>Séance {num}</span>
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        isCompleted
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      {isCompleted ? 'Terminée' : 'En attente'}
                    </span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
