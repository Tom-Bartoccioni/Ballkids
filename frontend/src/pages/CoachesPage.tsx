import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { UserCog, AlertTriangle, CheckCircle, Download, Plus, Trash2, X, Check, Pencil, Calendar } from 'lucide-react'

export default function CoachesPage() {
  const { isAdmin } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  
  const [showAddModal, setShowAddModal] = useState(false)
  const [newCoach, setNewCoach] = useState({ firstName: '', lastName: '', email: '', password: '' })

  const { data: tournament } = useQuery({
    queryKey: ['tournament', 'active'],
    queryFn: async () => {
      const res = await api.get('/tournaments/active')
      return res.data.data.tournament
    },
  })

  const { data: planningData, isLoading } = useQuery({
    queryKey: ['coaches', 'planning', tournament?.id],
    queryFn: async () => {
      if (!tournament?.id) return null
      const res = await api.get(`/coaches/${tournament.id}/planning`)
      return res.data.data
    },
    enabled: !!tournament?.id,
  })

  const { data: coachesData } = useQuery({
    queryKey: ['coaches', tournament?.id],
    queryFn: async () => {
      if (!tournament?.id) return null
      const res = await api.get(`/coaches/${tournament.id}`)
      return res.data.data
    },
    enabled: !!tournament?.id,
  })

  const planning = planningData?.planning || []
  const days = planningData?.days || []
  const coaches = coachesData?.coaches || []

  // Récupérer les disponibilités de tous les coachs
  const { data: coachAvailabilitiesData } = useQuery({
    queryKey: ['coaches', 'availabilities', tournament?.id],
    queryFn: async () => {
      if (!tournament?.id) return null
      const res = await api.get(`/coaches/${tournament.id}/availabilities`)
      return res.data.data
    },
    enabled: !!tournament?.id,
  })

  const coachAvailabilities = coachAvailabilitiesData?.coachAvailabilities || []
  const availabilityDays = coachAvailabilitiesData?.days || []

  const createCoachMutation = useMutation({
    mutationFn: () =>
      api.post('/auth/register', {
        email: newCoach.email,
        password: newCoach.password,
        firstName: newCoach.firstName,
        lastName: newCoach.lastName,
        role: 'COACH',
        tournamentId: tournament?.id,
      }),
    onSuccess: () => {
      toast({ title: 'Coach créé avec succès' })
      setNewCoach({ firstName: '', lastName: '', email: '', password: '' })
      setShowAddModal(false)
      queryClient.invalidateQueries({ queryKey: ['coaches'] })
    },
    onError: (err: any) => {
      toast({
        variant: 'destructive',
        title: 'Erreur',
        description: err.response?.data?.message || 'Erreur lors de la création',
      })
    },
  })

  const deleteCoachMutation = useMutation({
    mutationFn: (coachId: string) => api.delete(`/coaches/${coachId}`),
    onSuccess: () => {
      toast({ title: 'Coach supprimé' })
      queryClient.invalidateQueries({ queryKey: ['coaches'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la suppression' })
    },
  })

  // Mutation pour mettre à jour la disponibilité d'un coach
  const updateAvailabilityMutation = useMutation({
    mutationFn: async ({ coachId, dayNumber, isAvailable }: { 
      coachId: string; 
      dayNumber: number;
      isAvailable: boolean;
    }) => {
      return api.put(`/coaches/${coachId}/availability`, { dayNumber, isAvailable })
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['coaches'] })
      // Also invalidate schedule if we removed availability (which removes assignment)
      if (!variables.isAvailable) {
        queryClient.invalidateQueries({ queryKey: ['schedule'] })
      }
      toast({ title: 'Disponibilité mise à jour' })
    },
    onError: (error: any) => {
      toast({ 
        variant: 'destructive', 
        title: error.response?.data?.message || 'Erreur lors de la mise à jour de la disponibilité' 
      })
    },
  })

  const handleDeleteCoach = (coachId: string, name: string) => {
    if (confirm(`Supprimer le coach ${name} ?`)) {
      deleteCoachMutation.mutate(coachId)
    }
  }

  const handleExport = () => {
    window.open(`/api/export/coaches/csv?tournamentId=${tournament?.id}`, '_blank')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserCog className="w-6 h-6 text-indigo-500" />
            Coachs
          </h1>
          <p className="text-muted-foreground">
            Gestion des coachs et respect de la règle des 6 jours max consécutifs
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Exporter
          </Button>
          {isAdmin && (
            <Button onClick={() => setShowAddModal(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Ajouter un coach
            </Button>
          )}
        </div>
      </div>

      {/* Liste des coachs */}
      <Card>
        <CardHeader>
          <CardTitle>Liste des coachs ({coaches.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {coaches.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              Aucun coach enregistré. {isAdmin && 'Cliquez sur "Ajouter un coach" pour commencer.'}
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {coaches.map((coach: any) => (
                <div
                  key={coach.id}
                  className="flex items-center justify-between p-3 border rounded-lg bg-gray-50"
                >
                  <div>
                    <p className="font-medium">{coach.user?.firstName} {coach.user?.lastName}</p>
                    <p className="text-xs text-muted-foreground">{coach.user?.email}</p>
                  </div>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => handleDeleteCoach(coach.id, `${coach.user?.firstName} ${coach.user?.lastName}`)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Alerts */}
      {planning.some((c: any) => c.hasAlert) && (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-orange-500 mt-0.5" />
              <div>
                <p className="font-medium text-orange-700">Attention</p>
                <p className="text-sm text-orange-600">
                  Certains coachs dépassent la limite de 6 jours consécutifs
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : coachAvailabilities.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <UserCog className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">Aucun coach enregistré</p>
            <p className="text-muted-foreground">
              Ajoutez des coachs dans les réglages
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Planning et disponibilités
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left p-4 font-medium sticky left-0 bg-gray-50 z-10">
                      Coach
                    </th>
                    {availabilityDays.map((day: any) => (
                      <th key={day.dayNumber} className="text-center p-3 font-medium min-w-[70px]">
                        <div className="flex flex-col">
                          <span>J{day.dayNumber}</span>
                          <span className="text-xs font-normal text-muted-foreground">
                            {new Date(day.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                          </span>
                        </div>
                      </th>
                    ))}
                    <th className="text-center p-4 font-medium">Total</th>
                    <th className="text-center p-4 font-medium min-w-[100px]">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {coachAvailabilities.map((coach: any) => {
                    // Calculer les jours consécutifs DISPONIBLES (inclut assignés)
                    // Un coach ne peut pas travailler plus de 6 jours d'affilée
                    // Donc s'il est disponible 7 jours consécutifs, c'est une alerte
                    let maxConsecutive = 0
                    let consecutiveCount = 0
                    for (const day of coach.schedule) {
                      // Un jour compte comme "potentiel travail" s'il est disponible OU assigné
                      if (day.isAvailable || day.isAssigned) {
                        consecutiveCount++
                        if (consecutiveCount > maxConsecutive) maxConsecutive = consecutiveCount
                      } else {
                        consecutiveCount = 0
                      }
                    }
                    const hasAlert = maxConsecutive > 6

                    return (
                      <tr key={coach.id} className="border-b hover:bg-gray-50">
                        <td className="p-4 font-medium sticky left-0 bg-white z-10">
                          {coach.firstName} {coach.lastName}
                        </td>
                        {coach.schedule.map((day: any) => {
                          return (
                            <td key={day.dayNumber} className="p-3 text-center">
                              {day.isAssigned && isAdmin ? (
                                <button
                                  onClick={() => {
                                    if (confirm(`Retirer ${coach.firstName} ${coach.lastName} du terrain ${day.court || ''} pour J${day.dayNumber} ? Vous devrez réassigner un autre coach sur la page Planning.`)) {
                                      updateAvailabilityMutation.mutate({
                                        coachId: coach.id,
                                        dayNumber: day.dayNumber,
                                        isAvailable: false
                                      })
                                    }
                                  }}
                                  disabled={updateAvailabilityMutation.isPending}
                                  className="inline-flex items-center justify-center w-10 h-10 rounded bg-green-100 text-green-700 text-xs font-medium hover:bg-red-100 hover:text-red-700 transition-colors"
                                  title={`Assigné à ${day.court || 'un terrain'} - Cliquez pour retirer la disponibilité et l'assignation`}
                                >
                                  {day.court?.substring(0, 3) || '✓'}
                                </button>
                              ) : day.isAssigned ? (
                                <span 
                                  className="inline-flex items-center justify-center w-10 h-10 rounded bg-green-100 text-green-700 text-xs font-medium cursor-default"
                                  title={`Assigné à ${day.court || 'un terrain'}`}
                                >
                                  {day.court?.substring(0, 3) || '✓'}
                                </span>
                              ) : isAdmin ? (
                                <button
                                  onClick={() => updateAvailabilityMutation.mutate({
                                    coachId: coach.id,
                                    dayNumber: day.dayNumber,
                                    isAvailable: !day.isAvailable
                                  })}
                                  disabled={updateAvailabilityMutation.isPending}
                                  className={`inline-flex items-center justify-center w-10 h-10 rounded transition-colors ${
                                    day.isAvailable 
                                      ? 'bg-blue-100 text-blue-600 hover:bg-blue-200' 
                                      : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                                  }`}
                                  title={day.isAvailable ? 'Cliquez pour rendre indisponible' : 'Cliquez pour rendre disponible'}
                                >
                                  {day.isAvailable ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                                </button>
                              ) : (
                                <span 
                                  className={`inline-flex items-center justify-center w-10 h-10 rounded ${
                                    day.isAvailable ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
                                  }`}
                                >
                                  {day.isAvailable ? <Check className="w-4 h-4" /> : '-'}
                                </span>
                              )}
                            </td>
                          )
                        })}
                        <td className="p-4 text-center font-bold">
                          {coach.totalAssigned}
                        </td>
                        <td className="p-4 text-center min-w-[100px]">
                          {hasAlert ? (
                            <span className="inline-flex items-center justify-center gap-1 w-[85px] px-2 py-1 rounded-full bg-orange-100 text-orange-700 text-xs">
                              <AlertTriangle className="w-3 h-3" />
                              {maxConsecutive}j consec.
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-center gap-1 w-[85px] px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs">
                              <CheckCircle className="w-3 h-3" />
                              OK
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Legend */}
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm font-medium mb-3">Légende</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-green-100 flex items-center justify-center text-green-700 text-xs">Cou</span>
              <span>Assigné à un terrain (cliquez pour retirer)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-blue-100 flex items-center justify-center"><Check className="w-3 h-3 text-blue-600" /></span>
              <span>Disponible (non assigné)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center text-gray-400">-</span>
              <span>Non disponible (jour de repos)</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
              <span>Plus de 6 jours disponibles consécutifs</span>
            </div>
          </div>
          {isAdmin && (
            <p className="text-xs text-muted-foreground mt-4">
              💡 Cliquez sur une case pour modifier la disponibilité. Si le coach est déjà assigné, son assignation sera également retirée et vous devrez réassigner un autre coach sur la page Planning.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Modal Ajouter Coach */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Ajouter un coach</span>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  createCoachMutation.mutate()
                }}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">Prénom</Label>
                    <Input
                      id="firstName"
                      value={newCoach.firstName}
                      onChange={(e) => setNewCoach({ ...newCoach, firstName: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Nom</Label>
                    <Input
                      id="lastName"
                      value={newCoach.lastName}
                      onChange={(e) => setNewCoach({ ...newCoach, lastName: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={newCoach.email}
                    onChange={(e) => setNewCoach({ ...newCoach, email: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Mot de passe</Label>
                  <Input
                    id="password"
                    type="password"
                    value={newCoach.password}
                    onChange={(e) => setNewCoach({ ...newCoach, password: e.target.value })}
                    required
                    minLength={6}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                    Annuler
                  </Button>
                  <Button type="submit" disabled={createCoachMutation.isPending}>
                    {createCoachMutation.isPending ? 'Création...' : 'Créer'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
