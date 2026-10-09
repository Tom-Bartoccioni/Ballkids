import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { UsersRound, Wand2, User, GripVertical, ArrowLeftRight, X, Check, Trash2, ChevronDown, ChevronUp } from 'lucide-react'

// Couleur degradee de rouge a vert, relative au min/max des scores affiches
function getScoreColor(score: number, minScore: number, maxScore: number): { bg: string; text: string } {
  const range = maxScore - minScore
  const normalized = range > 0 ? (score - minScore) / range : 0.5
  
  if (normalized < 0.5) {
    const ratio = normalized * 2
    return {
      bg: `rgb(${255}, ${Math.round(200 * ratio)}, ${Math.round(100 * ratio)})`,
      text: ratio < 0.3 ? 'white' : '#7c2d12'
    }
  } else {
    const ratio = (normalized - 0.5) * 2
    return {
      bg: `rgb(${Math.round(255 - 120 * ratio)}, ${Math.round(200 + 30 * ratio)}, ${Math.round(100 + 50 * ratio)})`,
      text: '#14532d'
    }
  }
}

// Couleur relative au meilleur total d'equipe affiche (les points n'ont pas de plafond fixe).
function getTeamAverageColor(score: number, maxScore: number): { bg: string; text: string } {
  const normalized = maxScore > 0 ? Math.max(0, Math.min(1, score / maxScore)) : 0.5
  const hue = 120 * normalized
  return {
    bg: `hsl(${hue}, 70%, 45%)`,
    text: 'white',
  }
}

type DragItem = {
  ballkidId: string
  ballkidName: string
  fromTeamId: string | null
  isReserve: boolean
  averageScore: number | null
}

type PendingSwap = {
  id: string
  ballkid1: { id: string; name: string; teamId: string | null; isReserve: boolean }
  ballkid2: { id: string; name: string; teamId: string | null; isReserve: boolean }
}

export default function TeamsPage() {
  const { isAdmin } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  
  const [draggedItem, setDraggedItem] = useState<DragItem | null>(null)
  const [dropTarget, setDropTarget] = useState<{ ballkidId: string; teamId: string } | null>(null)
  const [reserveDropTeamId, setReserveDropTeamId] = useState<string | null>(null)
  const [pendingSwaps, setPendingSwaps] = useState<PendingSwap[]>([])
  const [isApplying, setIsApplying] = useState(false)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [generateTeamCount, setGenerateTeamCount] = useState(13)
  const [generateTeamSize, setGenerateTeamSize] = useState(6)
  const [addReserveModal, setAddReserveModal] = useState<{ teamId: string; teamNumber: number; position: number } | null>(null)
  const [selectedDay, setSelectedDay] = useState(1)
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null)
  const [mobileScores, setMobileScores] = useState<Record<string, string>>({})

  const { data: tournament } = useQuery({
    queryKey: ['tournament', 'active'],
    queryFn: async () => {
      const res = await api.get('/tournaments/active')
      return res.data.data.tournament
    },
  })

  const { data: teamsData, isLoading } = useQuery({
    queryKey: ['teams', tournament?.id],
    queryFn: async () => {
      if (!tournament?.id) return null
      const res = await api.get(`/teams/${tournament.id}`)
      return res.data.data
    },
    enabled: !!tournament?.id,
  })

  // Fetch tournament days for day selector
  const { data: scheduleData } = useQuery({
    queryKey: ['schedule', tournament?.id],
    queryFn: async () => {
      if (!tournament?.id) return null
      const res = await api.get(`/schedule/${tournament.id}`)
      return res.data.data
    },
    enabled: !!tournament?.id,
  })

  const days = scheduleData?.days || []

  // Score mutation for mobile view
  const scoreMutation = useMutation({
    mutationFn: (data: { ballkidId: string; score: number }) =>
      api.post(`/schedule/${tournament?.id}/day/${selectedDay}/score-simple`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la notation' })
    },
  })

  const handleMobileScore = (ballkidId: string) => {
    const value = mobileScores[ballkidId]
    if (value === undefined || value === '') return
    const score = parseFloat(value)
    if (isNaN(score) || score < 0) {
      toast({ variant: 'destructive', title: 'La note doit être un nombre positif' })
      return
    }
    scoreMutation.mutate({ ballkidId, score })
    toast({ title: 'Note enregistrée' })
  }

  const generateMutation = useMutation({
    mutationFn: (data: { teamCount: number; teamSize: number }) =>
      api.post(`/teams/${tournament?.id}/generate`, data),
    onSuccess: (res) => {
      toast({
        title: 'Équipes générées',
        description: `${res.data.data.ballkidsAssigned} ramasseurs répartis dans ${res.data.data.teamsCreated} équipes`,
      })
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      setShowGenerateModal(false)
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la génération' })
    },
  })

  const balanceMutation = useMutation({
    mutationFn: () => api.post(`/teams/${tournament?.id}/balance`),
    onSuccess: (res) => {
      toast({
        title: 'Équipes équilibrées',
        description: res.data.data.message,
      })
      queryClient.invalidateQueries({ queryKey: ['teams'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de l\'équilibrage' })
    },
  })

  const swapMutation = useMutation({
    mutationFn: (data: { ballkidId1: string; ballkidId2: string }) => 
      api.post(`/teams/${tournament?.id}/swap`, data),
  })

  const assignReserveMutation = useMutation({
    mutationFn: (data: { ballkidId: string; teamId: string; position: number; isReserve: boolean }) =>
      api.put(`/teams/${tournament?.id}/assign`, {
        ballkidId: data.ballkidId,
        teamId: data.teamId,
        position: data.position,
        isReserve: data.isReserve,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de l\'assignation' })
    },
  })

  const rawTeams = teamsData?.teams || []

  // Appliquer visuellement les swaps en attente
  const applyPendingSwapsToData = useCallback((teams: any[], swaps: PendingSwap[]) => {
    if (swaps.length === 0) return teams

    // Deep clone des teams
    const clonedTeams = JSON.parse(JSON.stringify(teams))

    // Pour chaque swap, échanger les ballkids visuellement
    swaps.forEach(swap => {
      // Trouver les assignments des deux ballkids
      let assignment1: any = null
      let assignment1TeamIdx: number = -1
      let assignment1Idx: number = -1
      let assignment2: any = null
      let assignment2TeamIdx: number = -1
      let assignment2Idx: number = -1

      clonedTeams.forEach((team: any, teamIdx: number) => {
        team.assignments?.forEach((a: any, aIdx: number) => {
          if (a.ballkid.id === swap.ballkid1.id) {
            assignment1 = a
            assignment1TeamIdx = teamIdx
            assignment1Idx = aIdx
          }
          if (a.ballkid.id === swap.ballkid2.id) {
            assignment2 = a
            assignment2TeamIdx = teamIdx
            assignment2Idx = aIdx
          }
        })
      })

      // Effectuer l'échange si les deux sont trouvés
      if (assignment1 && assignment2) {
        const temp = { ...assignment1.ballkid }
        clonedTeams[assignment1TeamIdx].assignments[assignment1Idx].ballkid = assignment2.ballkid
        clonedTeams[assignment2TeamIdx].assignments[assignment2Idx].ballkid = temp
      }
    })

    return clonedTeams
  }, [])

  const teams = applyPendingSwapsToData(rawTeams, pendingSwaps)

  // Extraire les remplaçants (après application des swaps visuels)
  const allReserves: any[] = []
  teams.forEach((team: any) => {
    const reserves = team.assignments?.filter((a: any) => a.isReserve) || []
    allReserves.push(...reserves)
  })

  // Calculer min/max scores
  const allScores: number[] = []
  const teamAverages: number[] = []
  teams.forEach((team: any) => {
    const members = team.assignments?.filter((a: any) => !a.isReserve) || []
    members.forEach((a: any) => {
      const overallScore = a.ballkid.overallAverage ?? a.ballkid.averageTrainingScore
      if (overallScore != null) {
        allScores.push(overallScore)
      }
    })
    if (members.length > 0) {
      const avg = members.reduce((sum: number, a: any) => {
        const overallScore = a.ballkid.overallAverage ?? a.ballkid.averageTrainingScore
        return sum + (overallScore || 0)
      }, 0) / members.length
      teamAverages.push(avg)
    }
  })
  const minScore = allScores.length > 0 ? Math.min(...allScores) : 0
  const maxScore = allScores.length > 0 ? Math.max(...allScores) : 0
  const minTeamAvg = teamAverages.length > 0 ? Math.min(...teamAverages) : 0
  const maxTeamAvg = teamAverages.length > 0 ? Math.max(...teamAverages) : 0

  const openGenerateModal = () => {
    const teamCountDefault = teams.length > 0 ? teams.length : 13
    const teamSizeDefault =
      teams.length > 0
        ? Math.max(
            1,
            ...teams.map((team: any) => team.assignments?.filter((a: any) => !a.isReserve).length || 0)
          )
        : 6
    setGenerateTeamCount(teamCountDefault)
    setGenerateTeamSize(teamSizeDefault || 6)
    setShowGenerateModal(true)
  }

  const handleDragStart = useCallback((item: DragItem) => {
    setDraggedItem(item)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggedItem(null)
    setDropTarget(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, ballkidId: string, teamId: string) => {
    e.preventDefault()
    if (draggedItem && draggedItem.ballkidId !== ballkidId) {
      setDropTarget({ ballkidId, teamId })
    }
  }, [draggedItem])

  const handleDragLeave = useCallback(() => {
    setDropTarget(null)
  }, [])

  const handleTeamDragOver = useCallback((e: React.DragEvent, teamId: string) => {
    if (!draggedItem?.isReserve) return
    e.preventDefault()
    setReserveDropTeamId(teamId)
  }, [draggedItem])

  const handleTeamDragLeave = useCallback(() => {
    setReserveDropTeamId(null)
  }, [])

  const handleTeamDrop = useCallback((teamId: string, position: number) => {
    if (!draggedItem?.isReserve) return
    assignReserveMutation.mutate({
      ballkidId: draggedItem.ballkidId,
      teamId,
      position,
      isReserve: false,
    })
    setDraggedItem(null)
    setReserveDropTeamId(null)
  }, [assignReserveMutation, draggedItem])

  const handleDrop = useCallback((targetBallkid: any, targetTeamId: string, targetIsReserve: boolean) => {
    if (!draggedItem || draggedItem.ballkidId === targetBallkid.id) return

    const newSwap: PendingSwap = {
      id: `${Date.now()}-${Math.random()}`,
      ballkid1: {
        id: draggedItem.ballkidId,
        name: draggedItem.ballkidName,
        teamId: draggedItem.fromTeamId,
        isReserve: draggedItem.isReserve,
      },
      ballkid2: {
        id: targetBallkid.id,
        name: `${targetBallkid.lastName} ${targetBallkid.firstName}`,
        teamId: targetTeamId,
        isReserve: targetIsReserve,
      },
    }

    setPendingSwaps(prev => [...prev, newSwap])
    setDraggedItem(null)
    setDropTarget(null)
  }, [draggedItem])

  const removeSwap = (swapId: string) => {
    setPendingSwaps(prev => prev.filter(s => s.id !== swapId))
  }

  const clearAllSwaps = () => {
    setPendingSwaps([])
  }

  const applyAllSwaps = async () => {
    if (pendingSwaps.length === 0) return
    
    setIsApplying(true)
    try {
      for (const swap of pendingSwaps) {
        await swapMutation.mutateAsync({
          ballkidId1: swap.ballkid1.id,
          ballkidId2: swap.ballkid2.id,
        })
      }
      toast({ 
        title: 'Échanges appliqués', 
        description: `${pendingSwaps.length} échange(s) effectué(s)` 
      })
      setPendingSwaps([])
      queryClient.invalidateQueries({ queryKey: ['teams'] })
    } catch {
      toast({ variant: 'destructive', title: 'Erreur lors des échanges' })
    } finally {
      setIsApplying(false)
    }
  }



  // Vérifier si un ballkid fait partie des swaps en attente
  const isInPendingSwap = useCallback((ballkidId: string) => {
    return pendingSwaps.some(s => s.ballkid1.id === ballkidId || s.ballkid2.id === ballkidId)
  }, [pendingSwaps])

  const renderBallkidItem = (assignment: any, teamId: string, isReserve: boolean, isDraggable: boolean) => {
    const overallScore = assignment.ballkid.overallAverage ?? assignment.ballkid.averageTrainingScore
    const scoreColor = overallScore != null 
      ? getScoreColor(overallScore, minScore, maxScore) 
      : null
    const isDropTarget = dropTarget?.ballkidId === assignment.ballkid.id
    const isDragging = draggedItem?.ballkidId === assignment.ballkid.id
    const isPending = isInPendingSwap(assignment.ballkid.id)

    return (
      <div
        key={assignment.id}
        draggable={isDraggable && isAdmin}
        onDragStart={() => handleDragStart({
          ballkidId: assignment.ballkid.id,
          ballkidName: `${assignment.ballkid.lastName} ${assignment.ballkid.firstName}`,
          fromTeamId: isReserve ? null : teamId,
          isReserve,
          averageScore: overallScore,
        })}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => handleDragOver(e, assignment.ballkid.id, teamId)}
        onDragLeave={handleDragLeave}
        onDrop={() => handleDrop(assignment.ballkid, teamId, isReserve)}
        className={`
          inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-all text-xs whitespace-nowrap
          ${isReserve ? 'bg-purple-50 border border-purple-200' : 'bg-gray-50 border border-gray-200'}
          ${isDragging ? 'opacity-50 scale-95' : ''}
          ${isDropTarget ? 'ring-2 ring-blue-500 bg-blue-50' : ''}
          ${isPending ? 'ring-2 ring-amber-400 bg-amber-50' : ''}
          ${isDraggable && isAdmin ? 'cursor-grab hover:bg-gray-100' : ''}
        `}
      >
        {isDraggable && isAdmin && (
          <GripVertical className="w-3 h-3 text-gray-400 flex-shrink-0" />
        )}
        <Link 
          to={`/ballkids/${assignment.ballkid.id}?from=teams`}
          className="font-medium hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {assignment.ballkid.lastName} {assignment.ballkid.firstName}
        </Link>
        {overallScore != null && scoreColor && (
          <span 
            className="font-medium px-1 py-px rounded text-[10px] leading-tight flex-shrink-0"
            style={{ backgroundColor: scoreColor.bg, color: scoreColor.text }}
          >
            {overallScore.toFixed(1)}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UsersRound className="w-6 h-6 text-purple-500" />
            Équipes
          </h1>
          <p className="text-muted-foreground text-sm hidden md:block">
            Glissez-déposez pour échanger
          </p>
        </div>
        {/* Day selector - mobile */}
        {days.length > 0 && (
          <div className="flex items-center gap-1 md:hidden">
            <span className="text-sm font-medium text-muted-foreground">Jour :</span>
            {days.map((day: any) => (
              <button
                key={day.dayNumber}
                onClick={() => setSelectedDay(day.dayNumber)}
                className={`w-8 h-8 rounded-full text-sm font-bold transition-colors ${
                  selectedDay === day.dayNumber
                    ? 'bg-primary text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {day.dayNumber}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 flex-wrap"></div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : teams.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <UsersRound className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">Aucune équipe créée</p>
            <p className="text-muted-foreground mb-4">
              Générez les équipes automatiquement basé sur les notes de formation
            </p>
            {isAdmin && (
              <Button onClick={openGenerateModal} disabled={generateMutation.isPending}>
                <Wand2 className="w-4 h-4 mr-2" />
                Générer les équipes
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* === MOBILE VIEW === */}
          <div className="md:hidden space-y-3">
            {teams.map((team: any, teamIndex: number) => {
              const teamMembers = team.assignments?.filter((a: any) => !a.isReserve) || []
              const isExpanded = expandedTeamId === team.id

              return (
                <div key={team.id} className="border rounded-lg bg-white overflow-hidden">
                  {/* Team header - tappable */}
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 border-b"
                    onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}
                  >
                    <span className="w-7 h-7 rounded-full bg-primary text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
                      {teamIndex + 1}
                    </span>
                    <span className="font-semibold text-sm flex-1 text-left">Équipe {teamIndex + 1}</span>
                    <span className="text-xs text-muted-foreground">{teamMembers.length} ramasseurs</span>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </button>

                  {/* Expanded: ballkid cards 2 per row */}
                  {isExpanded && (
                    <div className="grid grid-cols-2 gap-2 p-2">
                      {teamMembers
                        .sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
                        .map((assignment: any) => {
                          const bk = assignment.ballkid
                          const currentScore = mobileScores[bk.id]
                          return (
                            <div key={assignment.id} className="flex flex-col items-center border rounded-lg p-2 bg-gray-50">
                              {/* Photo */}
                              <Link to={`/ballkids/${bk.id}?from=teams`}>
                                {bk.photoUrl ? (
                                  <img
                                    src={bk.photoUrl}
                                    alt={`${bk.firstName} ${bk.lastName}`}
                                    className="w-24 h-32 rounded-lg object-cover"
                                  />
                                ) : (
                                  <div className="w-24 h-32 rounded-lg bg-gray-200 flex items-center justify-center">
                                    <User className="w-10 h-10 text-gray-400" />
                                  </div>
                                )}
                              </Link>
                              {/* Name */}
                              <span className="text-sm font-semibold mt-1 text-center leading-tight">
                                {bk.firstName}
                              </span>
                              <span className="text-xs text-muted-foreground text-center leading-tight">
                                {bk.lastName}
                              </span>
                              {/* Score input */}
                              <div className="mt-1 w-full flex items-center gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  placeholder="Note"
                                  value={currentScore ?? ''}
                                  onChange={(e) => setMobileScores(prev => ({ ...prev, [bk.id]: e.target.value }))}
                                  onBlur={() => handleMobileScore(bk.id)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') handleMobileScore(bk.id) }}
                                  className="w-full h-8 text-center text-sm border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* === DESKTOP VIEW === */}
          <div className="hidden md:block space-y-3">
          {/* Liste des équipes - une par ligne */}
          <div className="space-y-1">
            {teams.map((team: any, teamIndex: number) => {
              const teamMembers = team.assignments?.filter((a: any) => !a.isReserve) || []
              const scoresSum = teamMembers.reduce((sum: number, a: any) => {
                const overallScore = a.ballkid.overallAverage ?? a.ballkid.averageTrainingScore
                return sum + (overallScore || 0)
              }, 0)
              const teamAverage = teamMembers.length > 0 ? scoresSum / teamMembers.length : null
              const teamColor = teamAverage != null ? getTeamAverageColor(teamAverage, maxTeamAvg) : null

              return (
                <div
                  key={team.id}
                  className={`flex items-center gap-2 px-2 py-1 rounded-md border bg-white ${
                    reserveDropTeamId === team.id ? 'ring-2 ring-purple-300' : 'border-gray-200'
                  }`}
                  onDragOver={(e) => handleTeamDragOver(e, team.id)}
                  onDragLeave={handleTeamDragLeave}
                  onDrop={() => handleTeamDrop(team.id, teamMembers.length + 1)}
                >
                  {/* Numéro d'équipe */}
                  <span className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center font-bold text-[10px] flex-shrink-0">
                    {teamIndex + 1}
                  </span>
                  {/* Moyenne */}
                  {teamAverage != null && teamColor && (
                    <span 
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 min-w-[32px] text-center"
                      style={{ backgroundColor: teamColor.bg, color: teamColor.text }}
                    >
                      {teamAverage.toFixed(1)}
                    </span>
                  )}
                  {/* Séparateur */}
                  <div className="w-px h-4 bg-gray-300 flex-shrink-0" />
                  {/* Membres en ligne */}
                  <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
                    {teamMembers
                      .sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
                      .map((assignment: any) => renderBallkidItem(assignment, team.id, false, true))}
                    {teamMembers.length === 0 && (
                      <span className="text-xs text-muted-foreground">Aucun membre</span>
                    )}
                  </div>
                  {/* Bouton ajouter */}
                  {isAdmin && (
                    <button
                      type="button"
                      className="text-[10px] text-purple-400 hover:text-purple-600 flex-shrink-0 px-1"
                      onClick={() => setAddReserveModal({ teamId: team.id, teamNumber: team.number, position: teamMembers.length + 1 })}
                    >
                      +
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Remplaçants & échanges en ligne */}
          <div className="flex gap-3 flex-wrap">
            {/* Remplaçants */}
            {allReserves.length > 0 && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-md border border-purple-200 bg-purple-50/50 flex-wrap">
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 flex-shrink-0 mr-1">
                  <span className="w-4 h-4 rounded-full bg-purple-500 text-white flex items-center justify-center font-bold text-[9px]">
                    R
                  </span>
                  Remplaçants ({allReserves.length})
                </span>
                {allReserves.map((assignment: any) => 
                  renderBallkidItem(assignment, assignment.teamId, true, true)
                )}
              </div>
            )}

            {/* Échanges en attente */}
            {pendingSwaps.length > 0 && (
              <div className="flex items-center gap-2 px-2 py-1 rounded-md border border-blue-300 bg-blue-50/50 flex-wrap">
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 flex-shrink-0">
                  <ArrowLeftRight className="w-3 h-3" />
                  Échanges ({pendingSwaps.length})
                </span>
                {pendingSwaps.map((swap) => (
                  <span key={swap.id} className="inline-flex items-center gap-1 text-[10px] bg-white border rounded px-1 py-0.5">
                    <span className="font-medium">{swap.ballkid1.name}</span>
                    <span className="text-muted-foreground">↔</span>
                    <span className="font-medium">{swap.ballkid2.name}</span>
                    <button onClick={() => removeSwap(swap.id)} className="text-red-400 hover:text-red-600">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <Button size="sm" className="h-5 text-[10px] px-2" onClick={applyAllSwaps} disabled={isApplying}>
                  <Check className="w-3 h-3 mr-0.5" />
                  Appliquer
                </Button>
                <Button size="sm" variant="outline" className="h-5 text-[10px] px-1" onClick={clearAllSwaps} disabled={isApplying}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            )}
          </div>
        </div>
        </>
      )}

      {/* Modal pour ajouter un remplaçant */}
      {addReserveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4 flex flex-col max-h-[90vh]">
            <CardHeader className="flex-shrink-0">
              <CardTitle className="flex items-center justify-between">
                <span>Ajouter à l'équipe {addReserveModal.teamNumber}</span>
                <button
                  onClick={() => setAddReserveModal(null)}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              {allReserves.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Aucun remplaçant disponible</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground mb-3">Sélectionnez un remplaçant :</p>
                  {allReserves.map((assignment: any) => {
                    const ballkid = assignment.ballkid
                    const overallScore = ballkid.overallAverage ?? ballkid.averageTrainingScore
                    const scoreColor = overallScore != null ? getScoreColor(overallScore, minScore, maxScore) : null
                    return (
                      <button
                        key={ballkid.id}
                        type="button"
                        className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-purple-50 hover:border-purple-300 transition-colors text-left"
                        onClick={() => {
                          assignReserveMutation.mutate({
                            ballkidId: ballkid.id,
                            teamId: addReserveModal.teamId,
                            position: addReserveModal.position,
                            isReserve: false,
                          })
                          setAddReserveModal(null)
                        }}
                      >
                        <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                          <User className="w-4 h-4 text-purple-600" />
                        </div>
                        <div className="flex-1">
                          <span className="font-medium">{ballkid.lastName} {ballkid.firstName}</span>
                        </div>
                        {scoreColor && (
                          <span
                            className="text-xs font-semibold px-2 py-1 rounded"
                            style={{ backgroundColor: scoreColor.bg, color: scoreColor.text }}
                          >
                            {overallScore.toFixed(1)}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </CardContent>
            <div className="flex-shrink-0 flex justify-end gap-2 p-4 border-t bg-white rounded-b-lg">
              <Button type="button" variant="outline" onClick={() => setAddReserveModal(null)}>
                Fermer
              </Button>
            </div>
          </Card>
        </div>
      )}

      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4 flex flex-col max-h-[90vh]">
            <CardHeader className="flex-shrink-0">
              <CardTitle className="flex items-center justify-between">
                <span>{teams.length > 0 ? 'Regénérer les équipes' : 'Générer les équipes'}</span>
                <button
                  onClick={() => setShowGenerateModal(false)}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              <form
                id="generate-teams-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (generateTeamCount < 1 || generateTeamSize < 1) return
                  generateMutation.mutate({
                    teamCount: generateTeamCount,
                    teamSize: generateTeamSize,
                  })
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="teamCount">Nombre d'équipes</Label>
                  <Input
                    id="teamCount"
                    type="number"
                    min="1"
                    value={generateTeamCount}
                    onChange={(e) => setGenerateTeamCount(parseInt(e.target.value || '0', 10))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="teamSize">Ramasseurs par équipe</Label>
                  <Input
                    id="teamSize"
                    type="number"
                    min="1"
                    value={generateTeamSize}
                    onChange={(e) => setGenerateTeamSize(parseInt(e.target.value || '0', 10))}
                  />
                </div>
                {teams.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Cette action remplace les équipes existantes.
                  </p>
                )}
              </form>
            </CardContent>
            <div className="flex-shrink-0 flex justify-end gap-2 p-4 border-t bg-white rounded-b-lg">
              <Button type="button" variant="outline" onClick={() => setShowGenerateModal(false)}>
                Annuler
              </Button>
              <Button type="submit" form="generate-teams-form" disabled={generateMutation.isPending}>
                <Wand2 className="w-4 h-4 mr-2" />
                {generateMutation.isPending ? 'Génération...' : 'Valider'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
