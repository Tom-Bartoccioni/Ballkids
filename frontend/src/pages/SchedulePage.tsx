import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { Calendar, Users, MapPin, Download, Upload, Plus, Pencil, X, Save, UserPlus, User, AlertTriangle, Scale, Wand2, AlignJustify, Trash2, Search, UserX } from 'lucide-react'

function getScoreColor(score: number, minScore: number, maxScore: number): { bg: string; text: string } {
  const range = maxScore - minScore
  const normalized = range > 0 ? (score - minScore) / range : 0.5

  if (normalized < 0.5) {
    const ratio = normalized * 2
    return {
      bg: `rgb(${255}, ${Math.round(200 * ratio)}, ${Math.round(100 * ratio)})`,
      text: ratio < 0.3 ? 'white' : '#7c2d12',
    }
  }
  const ratio = (normalized - 0.5) * 2
  return {
    bg: `rgb(${Math.round(255 - 120 * ratio)}, ${Math.round(200 + 30 * ratio)}, ${Math.round(100 + 50 * ratio)})`,
    text: '#14532d',
  }
}

function getTeamAverageColor(score: number): { bg: string; text: string } {
  const normalized = Math.max(0, Math.min(1, score / 20))
  const hue = 120 * normalized
  return {
    bg: `hsl(${hue}, 70%, 45%)`,
    text: 'white',
  }
}

export default function SchedulePage() {
  const [selectedDay, setSelectedDay] = useState(1)
  const [showDayModal, setShowDayModal] = useState(false)
  const [editingDay, setEditingDay] = useState<any>(null)
  const [showCourtModal, setShowCourtModal] = useState(false)
  const [editingCourt, setEditingCourt] = useState<any>(null)
  const [showTeamAssignModal, setShowTeamAssignModal] = useState(false)
  const [assigningCourt, setAssigningCourt] = useState<any>(null)
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([])
  const [assigningCoachCourt, setAssigningCoachCourt] = useState<any>(null)
  const [selectedCoachIds, setSelectedCoachIds] = useState<string[]>([])
  const [tournamentScores, setTournamentScores] = useState<Record<string, string>>({})
  const [editingTournamentScores, setEditingTournamentScores] = useState<Record<string, boolean>>({})
  const [draggedDayItem, setDraggedDayItem] = useState<{
    ballkidId: string
    ballkidName: string
    fromTeamId: string | null
    fromIsReserve: boolean
  } | null>(null)
  const draggedDayItemRef = useRef<{
    ballkidId: string
    ballkidName: string
    fromTeamId: string | null
    fromIsReserve: boolean
  } | null>(null)
  const [reserveDropTeamId, setReserveDropTeamId] = useState<string | null>(null)
  const [reserveDropActive, setReserveDropActive] = useState(false)
  const [dropTargetBallkidId, setDropTargetBallkidId] = useState<string | null>(null)
  const [showReservesDrawer, setShowReservesDrawer] = useState(false)
  const [addReserveModal, setAddReserveModal] = useState<{ teamId: string; teamNumber: number; position: number } | null>(null)
  const [baseCourts, setBaseCourts] = useState<Array<{ name: string; teamCount: number }>>([
    { name: 'Court 1', teamCount: 2 },
  ])
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [showGenerateTeamsModal, setShowGenerateTeamsModal] = useState(false)
  const [generateTeamCount, setGenerateTeamCount] = useState(13)
  const [generateTeamSize, setGenerateTeamSize] = useState(6)
  const [showAbsenceModal, setShowAbsenceModal] = useState(false)
  const [absenceSearch, setAbsenceSearch] = useState('')
  const { isAdmin, user } = useAuth()
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: tournament } = useQuery({
    queryKey: ['tournament', 'active'],
    queryFn: async () => {
      const res = await api.get('/tournaments/active')
      return res.data.data.tournament
    },
  })

  const { data: scheduleData, isLoading } = useQuery({
    queryKey: ['schedule', tournament?.id],
    queryFn: async () => {
      if (!tournament?.id) return null
      const res = await api.get(`/schedule/${tournament.id}`)
      return res.data.data
    },
    enabled: !!tournament?.id,
  })

  const { data: dayData } = useQuery({
    queryKey: ['schedule', 'day', tournament?.id, selectedDay],
    queryFn: async () => {
      if (!tournament?.id) return null
      const res = await api.get(`/schedule/${tournament.id}/day/${selectedDay}`)
      return res.data.data
    },
    enabled: !!tournament?.id && !!selectedDay,
  })

  // Récupérer toutes les équipes du tournoi
  const { data: teamsData } = useQuery({
    queryKey: ['teams', tournament?.id],
    queryFn: async () => {
      if (!tournament?.id) return null
      const res = await api.get(`/teams/${tournament.id}`)
      return res.data.data
    },
    enabled: !!tournament?.id,
  })

  const { data: teamsDayData } = useQuery({
    queryKey: ['teams', 'day', tournament?.id, selectedDay],
    queryFn: async () => {
      if (!tournament?.id) return null
      const res = await api.get(`/teams/${tournament.id}/day/${selectedDay}`)
      return res.data.data
    },
    enabled: !!tournament?.id && !!selectedDay,
  })

  // Récupérer tous les coachs du tournoi
  const { data: coachesData } = useQuery({
    queryKey: ['coaches', tournament?.id],
    queryFn: async () => {
      if (!tournament?.id) return null
      const res = await api.get(`/coaches/${tournament.id}`)
      return res.data.data
    },
    enabled: !!tournament?.id,
  })

  // Récupérer les coachs disponibles pour le jour sélectionné
  const { data: availableCoachesData } = useQuery({
    queryKey: ['coaches', 'available', tournament?.id, selectedDay],
    queryFn: async () => {
      if (!tournament?.id) return null
      const res = await api.get(`/coaches/${tournament.id}/day/${selectedDay}/available`)
      return res.data.data
    },
    enabled: !!tournament?.id,
  })

  // Récupérer les ramasseurs sélectionnés pour le modal d'absence
  const { data: selectedBallkidsData } = useQuery({
    queryKey: ['ballkids', 'selected', tournament?.id],
    queryFn: async () => {
      const res = await api.get('/ballkids', {
        params: { status: 'SELECTED', limit: 200 },
      })
      return res.data.data
    },
    enabled: !!tournament?.id && showAbsenceModal,
  })

  const days = scheduleData?.days || []
  const currentDay = dayData?.day
  const allTeams = teamsDayData?.teams || teamsData?.teams || []
  const allCoaches = coachesData?.coaches || []
  const availableCoachesForDay = availableCoachesData?.availableCoaches || []
  const teamCaptains = currentDay?.teamCaptains || []
  const dayAbsences = currentDay?.absences || []
  const absentBallkidIds = useMemo(() => new Set(dayAbsences.map((a: any) => a.ballkidId)), [dayAbsences])
  const previousDay = useMemo(() => {
    if (!currentDay) return null
    return days.find((day: any) => day.dayNumber === currentDay.dayNumber - 1) || null
  }, [days, currentDay])
  const isBallkidCountMismatch =
    currentDay && previousDay && currentDay.ballkidCount !== previousDay.ballkidCount

  const defaultBallkidCounts = [78, 78, 78, 78, 78, 78, 36, 20, 20]
  const formatDate = (date: Date) => date.toISOString().split('T')[0]

  const captainByTeamId = useMemo(() => {
    const map = new Map<string, any>()
    teamCaptains.forEach((captain: any) => {
      map.set(captain.teamId, captain)
    })
    return map
  }, [teamCaptains])

  const trainingAverageByBallkidId = useMemo(() => {
    const map = new Map<string, number | null>()
    allTeams.forEach((team: any) => {
      team.assignments?.forEach((assignment: any) => {
        const ballkidId = assignment.ballkidId || assignment.ballkid?.id
        if (!ballkidId) return
        const score = assignment.ballkid?.averageTrainingScore ?? null
        map.set(ballkidId, score)
      })
    })
    return map
  }, [allTeams])

  const coachAlertDays = useMemo(() => {
    const map = new Map<string, Set<number>>()
    const days = scheduleData?.days || []
    const coachDays = new Map<string, number[]>()

    days.forEach((day: any) => {
      day.coachAssignments?.forEach((assignment: any) => {
        const coachId = assignment.coach?.id
        if (!coachId) return
        const list = coachDays.get(coachId) || []
        list.push(day.dayNumber)
        coachDays.set(coachId, list)
      })
    })

    coachDays.forEach((dayNumbers, coachId) => {
      const sorted = Array.from(new Set(dayNumbers)).sort((a, b) => a - b)
      if (sorted.length === 0) return
      let runStart = sorted[0]
      let prev = sorted[0]
      for (let i = 1; i <= sorted.length; i++) {
        const current = sorted[i]
        if (current === prev + 1) {
          prev = current
          continue
        }
        const runLength = prev - runStart + 1
        if (runLength > 6) {
          const alertSet = map.get(coachId) || new Set<number>()
          for (let d = runStart; d <= prev; d++) {
            alertSet.add(d)
          }
          map.set(coachId, alertSet)
        }
        if (current !== undefined) {
          runStart = current
          prev = current
        }
      }
    })

    return map
  }, [scheduleData?.days])

  const hasDayAssignments = (currentDay?.teamAssignments?.length || 0) > 0
  const hasCourts = (currentDay?.courts?.length || 0) > 0

  // Always show all teams in "Équipes du jour", regardless of court assignment
  const dayTeamsSource = useMemo(() => {
    return allTeams
  }, [allTeams])

  const dayTeams = useMemo(() => {
    const teamsMap = new Map<string, { team: any; members: any[] }>()
    dayTeamsSource.forEach((team: any) => {
      const assignments = team.assignments || []
      const dayAssignments = assignments.filter(
        (assignment: any) => assignment.tournamentDayId === currentDay?.id
      )
      const mergedAssignments = hasDayAssignments ? dayAssignments : dayAssignments
      const selectedAssignments = mergedAssignments.filter(
        (assignment: any) => !assignment.isReserve
      )
      if (!teamsMap.has(team.id)) {
        teamsMap.set(team.id, { team, members: selectedAssignments })
      }
    })
    return Array.from(teamsMap.values()).sort(
      (a, b) => (a.team.order || 0) - (b.team.order || 0)
    )
  }, [currentDay?.id, dayTeamsSource])

  const dayReserves = useMemo(() => {
    const reserves: any[] = []
    dayTeamsSource.forEach((team: any) => {
      const assignments = team.assignments || []
      const dayAssignments = assignments.filter(
        (assignment: any) => assignment.tournamentDayId === currentDay?.id
      )
      const mergedAssignments = hasDayAssignments ? dayAssignments : dayAssignments
      const selectedAssignments = mergedAssignments.filter(
        (assignment: any) => assignment.isReserve
      )
      reserves.push(...selectedAssignments)
    })
    return reserves.sort((a: any, b: any) => {
      const scoreA = a.ballkid?.overallAverage ?? a.ballkid?.averageTrainingScore ?? -1
      const scoreB = b.ballkid?.overallAverage ?? b.ballkid?.averageTrainingScore ?? -1
      return scoreB - scoreA
    })
  }, [currentDay?.id, dayTeamsSource])

  const dayTeamsView = useMemo(() => {
    const seen = new Set<string>()
    return dayTeams.map(({ team, members }) => {
      const filteredMembers = members.filter((assignment: any) => {
        const id = assignment.ballkidId || assignment.ballkid?.id
        if (!id || seen.has(id)) return false
        seen.add(id)
        return true
      })
      return { team, members: filteredMembers }
    })
  }, [dayTeams])

  const dayReservesView = useMemo(() => {
    const seen = new Set<string>()
    dayTeamsView.forEach(({ members }) => {
      members.forEach((assignment: any) => {
        const id = assignment.ballkidId || assignment.ballkid?.id
        if (id) seen.add(id)
      })
    })
    return dayReserves.filter((assignment: any) => {
      const id = assignment.ballkidId || assignment.ballkid?.id
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })
  }, [dayReserves, dayTeamsView])

  // Set of ballkid IDs assigned to a team for this day (to show warning on absences)
  const assignedBallkidIds = useMemo(() => {
    const ids = new Set<string>()
    dayTeamsView.forEach(({ members }) => {
      members.forEach((assignment: any) => {
        const id = assignment.ballkidId || assignment.ballkid?.id
        if (id) ids.add(id)
      })
    })
    dayReservesView.forEach((assignment: any) => {
      const id = assignment.ballkidId || assignment.ballkid?.id
      if (id) ids.add(id)
    })
    return ids
  }, [dayTeamsView, dayReservesView])

  // Count of absences that are also assigned to a team (needs warning)
  const absencesWithTeamCount = useMemo(() => {
    return dayAbsences.filter((a: any) => assignedBallkidIds.has(a.ballkidId)).length
  }, [dayAbsences, assignedBallkidIds])


  const dayScoreByBallkidId = useMemo(() => {
    const map = new Map<string, number>()
    const groups = new Map<string, number[]>()
    const scores = currentDay?.tournamentScores || []
    scores.forEach((score: any) => {
      if (!score.ballkidId || score.totalScore == null) return
      const list = groups.get(score.ballkidId) || []
      list.push(score.totalScore)
      groups.set(score.ballkidId, list)
    })
    groups.forEach((values, ballkidId) => {
      const avg = values.reduce((sum, value) => sum + value, 0) / values.length
      map.set(ballkidId, avg)
    })
    return map
  }, [currentDay?.tournamentScores])

  const { minDayScore, maxDayScore } = useMemo(() => {
    const values = Array.from(dayScoreByBallkidId.values())
    if (values.length === 0) return { minDayScore: 0, maxDayScore: 20 }
    return {
      minDayScore: Math.min(...values),
      maxDayScore: Math.max(...values),
    }
  }, [dayScoreByBallkidId])

  const { minOverallScore, maxOverallScore } = useMemo(() => {
    const scores: number[] = []
    dayTeamsView.forEach(({ members }) => {
      members.forEach((assignment: any) => {
        const ballkid = assignment.ballkid
        if (!ballkid) return
        const value = ballkid.overallAverage ?? ballkid.averageTrainingScore
        if (value != null) scores.push(value)
      })
    })
    dayReservesView.forEach((assignment: any) => {
      const ballkid = assignment.ballkid
      if (!ballkid) return
      const value = ballkid.overallAverage ?? ballkid.averageTrainingScore
      if (value != null) scores.push(value)
    })
    if (scores.length === 0) return { minOverallScore: 0, maxOverallScore: 20 }
    return {
      minOverallScore: Math.min(...scores),
      maxOverallScore: Math.max(...scores),
    }
  }, [dayReservesView, dayTeamsView])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (showTeamAssignModal) setShowTeamAssignModal(false)
      if (showCourtModal) setShowCourtModal(false)
      if (showDayModal) setShowDayModal(false)
      if (showGenerateTeamsModal) setShowGenerateTeamsModal(false)
      if (assigningCoachCourt) setAssigningCoachCourt(null)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [assigningCoachCourt, showCourtModal, showDayModal, showGenerateTeamsModal, showTeamAssignModal])


  useEffect(() => {
    const dayParam = searchParams.get('day')
    if (!dayParam) return
    const parsed = Number.parseInt(dayParam, 10)
    if (!Number.isNaN(parsed)) {
      setSelectedDay(parsed)
    }
  }, [searchParams])

  useEffect(() => {
    if (!showGenerateTeamsModal) return
    const teamCountDefault = dayTeams.length > 0 ? dayTeams.length : 13
    const teamSizeDefault =
      dayTeams.length > 0
        ? Math.max(
            1,
            ...dayTeams.map(({ members }) => members.length || 0)
          )
        : 6
    setGenerateTeamCount(teamCountDefault)
    setGenerateTeamSize(teamSizeDefault || 6)
  }, [showGenerateTeamsModal, dayTeams])

  // Mutations pour les jours
  const saveDayMutation = useMutation({
    mutationFn: async (data: { dayNumber: number; date: string; ballkidCount: number }) => {
      return api.post(`/schedule/${tournament?.id}/day`, data)
    },
    onSuccess: (_data, variables) => {
      toast({ title: 'Jour enregistré avec succès' })
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
      queryClient.invalidateQueries({ queryKey: ['schedule', 'day'] })
      if (variables?.dayNumber) {
        setSelectedDay(variables.dayNumber)
      }
      setShowDayModal(false)
      setEditingDay(null)
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de l\'enregistrement' })
    },
  })

  const deleteDayMutation = useMutation({
    mutationFn: async (dayNumber: number) => {
      return api.delete(`/schedule/${tournament?.id}/day/${dayNumber}`)
    },
    onSuccess: (_data, dayNumber) => {
      toast({ title: 'Jour supprimé' })
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
      queryClient.invalidateQueries({ queryKey: ['schedule', 'day'] })
      if (selectedDay === dayNumber) {
        const remainingDays = days.filter((d: any) => d.dayNumber !== dayNumber)
        const fallback = remainingDays.length > 0 ? remainingDays[0].dayNumber : null
        setSelectedDay(fallback ?? 0)
      }
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la suppression' })
    },
  })

  const setWeekMutation = useMutation({
    mutationFn: async () => {
      if (!tournament?.id) return
      const start = tournament.startDate ? new Date(tournament.startDate) : new Date()

      const defaultCourts = baseCourts
        .map((court) => ({
          name: court.name.trim(),
          teamCount: Number.isFinite(court.teamCount) && court.teamCount > 0 ? court.teamCount : 1,
        }))
        .filter((court) => court.name.length > 0)

      await api.post(`/schedule/${tournament.id}/day`, {
        dayNumber: 1,
        date: formatDate(start),
        ballkidCount: defaultBallkidCounts[0],
        ...(defaultCourts.length > 0 ? { courts: defaultCourts } : {}),
      })
      await api.post(`/teams/${tournament.id}/init`, {
        teamCount: 13,
      })
    },
    onSuccess: () => {
      toast({ title: 'Jour 1 créé' })
      queryClient.invalidateQueries({ queryKey: ['tournament'] })
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la configuration de la semaine' })
    },
  })

  const handleAddDay = () => {
    const nextDayNumber = days.length > 0 ? Math.max(...days.map((d: any) => d.dayNumber)) + 1 : 1
    const lastDate = days.length > 0 
      ? new Date(days[days.length - 1].date)
      : tournament?.startDate
        ? new Date(tournament.startDate)
        : new Date()
    lastDate.setDate(lastDate.getDate() + 1)
    const lastBallkidCount = days.length > 0 ? days[days.length - 1].ballkidCount : 78

    saveDayMutation.mutate({
      dayNumber: nextDayNumber,
      date: lastDate.toISOString().split('T')[0],
      ballkidCount: lastBallkidCount,
    })
  }

  const handleEditDay = (day: any) => {
    setEditingDay({
      dayNumber: day.dayNumber,
      date: new Date(day.date).toISOString().split('T')[0],
      ballkidCount: day.ballkidCount,
      isNew: false,
    })
    setShowDayModal(true)
  }

  const handleDeleteDay = (dayNumber: number) => {
    if (confirm(`Supprimer le jour ${dayNumber} ?`)) {
      deleteDayMutation.mutate(dayNumber)
    }
  }

  // Mutations pour les terrains
  const saveCourtMutation = useMutation({
    mutationFn: async (data: { id?: number; name: string; teamCount: number }) => {
      if (data.id) {
        return api.put(`/schedule/court/${data.id}`, data)
      }
      return api.post(`/schedule/${tournament?.id}/day/${selectedDay}/court`, data)
    },
    onSuccess: () => {
      toast({ title: 'Terrain enregistré avec succès' })
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
      setShowCourtModal(false)
      setEditingCourt(null)
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de l\'enregistrement du terrain' })
    },
  })

  const deleteCourtMutation = useMutation({
    mutationFn: async (courtId: number) => {
      return api.delete(`/schedule/court/${courtId}`)
    },
    onSuccess: () => {
      toast({ title: 'Terrain supprimé' })
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la suppression du terrain' })
    },
  })

  const handleAddCourt = () => {
    const existingCourts = currentDay?.courts || []
    const nextCourtNumber = existingCourts.length + 1
    
    setEditingCourt({
      name: `Court ${nextCourtNumber}`,
      teamCount: 2,
      isNew: true,
    })
    setShowCourtModal(true)
  }

  const handleEditCourt = (court: any) => {
    setEditingCourt({
      id: court.id,
      name: court.name,
      teamCount: court.teamCount,
      isNew: false,
    })
    setShowCourtModal(true)
  }

  const handleDeleteCourt = (courtId: number, courtName: string) => {
    if (confirm(`Supprimer le terrain "${courtName}" ?`)) {
      deleteCourtMutation.mutate(courtId)
    }
  }

  // Mutation pour assigner des équipes à un terrain
  const assignTeamsMutation = useMutation({
    mutationFn: async ({ courtId, teamIds }: { courtId: string; teamIds: string[] }) => {
      return api.put(`/schedule/court/${courtId}/teams`, { teamIds })
    },
    onSuccess: () => {
      toast({ title: 'Équipes assignées avec succès' })
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
      setShowTeamAssignModal(false)
      setAssigningCourt(null)
      setSelectedTeamIds([])
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de l\'assignation des équipes' })
    },
  })

  // Mutation pour assigner des coachs à un terrain
  const assignCoachMutation = useMutation({
    mutationFn: async ({ courtId, coachIds }: { courtId: string; coachIds: string[] }) => {
      return api.put(`/schedule/court/${courtId}/coach`, { coachIds })
    },
    onSuccess: () => {
      toast({ title: 'Coachs assignés avec succès' })
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
      queryClient.invalidateQueries({ queryKey: ['coaches'] })
      setAssigningCoachCourt(null)
      setSelectedCoachIds([])
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de l\'assignation des coachs' })
    },
  })

  const handleOpenTeamAssign = (court: any) => {
    setAssigningCourt(court)
    // Récupérer les équipes déjà assignées
    const existingTeamIds = court.courtTeams?.map((ct: any) => ct.team?.id || ct.teamId) || []
    setSelectedTeamIds(existingTeamIds)
    setShowTeamAssignModal(true)
  }

  const toggleTeamSelection = (teamId: string) => {
    setSelectedTeamIds(prev => {
      if (prev.includes(teamId)) {
        return prev.filter(id => id !== teamId)
      }
      return [...prev, teamId]
    })
  }

  const downloadFile = async (endpoint: string, filename: string, mimeType: string) => {
    if (!tournament?.id) return
    try {
      const res = await api.get(endpoint, {
        params: { tournamentId: tournament.id, dayNumber: selectedDay },
        responseType: 'blob',
      })
      const blob = new Blob([res.data], { type: mimeType })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Erreur lors de l\'export',
        description: err.response?.data?.message || 'Export échoué',
      })
    }
  }

  const handleExportDay = () => {
    downloadFile('/export/schedule/csv', `planning-jour-${selectedDay}.csv`, 'text/csv;charset=utf-8;')
  }

  const handleExportPDF = () => {
    downloadFile('/export/schedule/pdf', `planning-jour-${selectedDay}.pdf`, 'application/pdf')
  }

  const downloadTeamsFile = async (endpoint: string, filename: string, mimeType: string) => {
    if (!tournament?.id) return
    try {
      const res = await api.get(endpoint, {
        params: { tournamentId: tournament.id, dayNumber: selectedDay },
        responseType: 'blob',
      })
      const blob = new Blob([res.data], { type: mimeType })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Erreur lors de l\'export',
        description: err.response?.data?.message || 'Export échoué',
      })
    }
  }

  const handleExportTeams = () => {
    downloadTeamsFile('/export/teams/csv', 'equipes.csv', 'text/csv;charset=utf-8;')
  }

  const handleExportTeamsPDF = () => {
    downloadTeamsFile('/export/teams/pdf', `equipes-jour-${selectedDay}.pdf`, 'application/pdf')
  }

  const balanceTeamsMutation = useMutation({
    mutationFn: () => api.post(`/teams/${tournament?.id}/balance`),
    onSuccess: (res) => {
      toast({
        title: 'Équipes équilibrées',
        description: res.data.data.message,
      })
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
      queryClient.invalidateQueries({ queryKey: ['schedule', 'day'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de l\'équilibrage' })
    },
  })

  const generateTeamsMutation = useMutation({
    mutationFn: (data: { teamCount: number; teamSize: number }) =>
      api.post(`/teams/${tournament?.id}/generate`, {
        ...data,
        tournamentDayId: currentDay?.id,
      }),
    onSuccess: (res) => {
      toast({
        title: 'Équipes générées',
        description: `${res.data.data.ballkidsAssigned} ramasseurs répartis dans ${res.data.data.teamsCreated} équipes`,
      })
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
      queryClient.invalidateQueries({ queryKey: ['schedule', 'day'] })
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      setShowGenerateTeamsModal(false)
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la génération' })
    },
  })

  const openGenerateTeamsModal = () => {
    setShowGenerateTeamsModal(true)
  }

  const assignDayMutation = useMutation({
    mutationFn: (data: { ballkidId: string; teamId: string; position?: number; isReserve: boolean }) =>
      api.put(`/teams/${tournament?.id}/assign`, {
        ...data,
        tournamentDayId: currentDay?.id,
      }),
    onSuccess: (response) => {
      const assignment = response?.data?.data?.assignment
      if (assignment && currentDay?.id) {
        const findExistingBallkid = (oldTeams: any[], targetBallkidId: string) => {
          for (const team of oldTeams) {
            for (const assignmentItem of team.assignments || []) {
              const existingId = assignmentItem.ballkidId || assignmentItem.ballkid?.id
              if (existingId === targetBallkidId) {
                return assignmentItem.ballkid
              }
            }
          }
          return null
        }

        const normalizeBallkid = (ballkid: any, fallback: any) => {
          if (!ballkid) return ballkid
          const overall =
            ballkid.overallAverage ??
            ballkid.averageTrainingScore ??
            fallback?.overallAverage ??
            fallback?.averageTrainingScore ??
            null
          return {
            ...fallback,
            ...ballkid,
            overallAverage: overall,
            averageTrainingScore: ballkid.averageTrainingScore ?? overall,
          }
        }
        const updateTeamsCache = (oldData: any) => {
          if (!oldData?.teams) return oldData
          const ballkidId = assignment.ballkidId || assignment.ballkid?.id
          if (!ballkidId) return oldData
          const dayId = assignment.tournamentDayId || currentDay.id
          const fallbackBallkid = findExistingBallkid(oldData.teams, ballkidId)
          const teams = oldData.teams.map((team: any) => ({
            ...team,
            assignments: (team.assignments || []).filter(
              (a: any) => !(a.ballkidId === ballkidId && a.tournamentDayId === dayId)
            ),
          }))
          const targetIndex = teams.findIndex((team: any) => team.id === assignment.teamId)
          if (targetIndex >= 0) {
            teams[targetIndex] = {
              ...teams[targetIndex],
              assignments: [
                ...(teams[targetIndex].assignments || []),
                {
                  ...assignment,
                  ballkidId,
                  tournamentDayId: dayId,
                  ballkid: normalizeBallkid(assignment.ballkid, fallbackBallkid),
                },
              ].sort((a: any, b: any) => (a.position ?? 9999) - (b.position ?? 9999)),
            }
          }
          return { ...oldData, teams }
        }

        queryClient.setQueryData(
          ['teams', 'day', tournament?.id, selectedDay],
          updateTeamsCache
        )
        queryClient.setQueryData(['teams', tournament?.id], updateTeamsCache)
      }
      queryClient.invalidateQueries({ queryKey: ['schedule'] })
      queryClient.invalidateQueries({ queryKey: ['schedule', 'day'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de l\'assignation' })
    },
  })

  const readDragPayload = (event?: React.DragEvent) => {
    if (!event) return null
    const raw =
      event.dataTransfer?.getData('application/json') ||
      event.dataTransfer?.getData('text/plain')
    if (!raw) return null
    try {
      return JSON.parse(raw) as {
        ballkidId: string
        ballkidName: string
        fromTeamId: string | null
        fromIsReserve: boolean
      }
    } catch {
      return null
    }
  }

  const handleDaySwap = async (
    target: { ballkidId: string; ballkidName: string; teamId: string | null; isReserve: boolean },
    sourceOverride?: { ballkidId: string; ballkidName: string; fromTeamId: string | null; fromIsReserve: boolean } | null
  ) => {
    const activeItem = sourceOverride || draggedDayItemRef.current || draggedDayItem
    if (!activeItem || !currentDay?.id) return
    if (activeItem.ballkidId === target.ballkidId) return
    try {
      await assignDayMutation.mutateAsync({
        ballkidId: activeItem.ballkidId,
        teamId: target.teamId,
        isReserve: target.isReserve,
      })
      await assignDayMutation.mutateAsync({
        ballkidId: target.ballkidId,
        teamId: activeItem.fromTeamId,
        isReserve: activeItem.fromIsReserve,
      })
    } finally {
      setDraggedDayItem(null)
      draggedDayItemRef.current = null
      setDropTargetBallkidId(null)
      setReserveDropTeamId(null)
    }
  }

  const handleReserveDrop = async (
    teamId: string,
    position: number,
    sourceOverride?: { ballkidId: string; ballkidName: string; fromTeamId: string | null; fromIsReserve: boolean } | null
  ) => {
    const activeItem = sourceOverride || draggedDayItemRef.current || draggedDayItem
    if (!activeItem?.fromIsReserve || !currentDay?.id) return
    await assignDayMutation.mutateAsync({
      ballkidId: activeItem.ballkidId,
      teamId,
      position,
      isReserve: false,
    })
    setDraggedDayItem(null)
    draggedDayItemRef.current = null
    setReserveDropTeamId(null)
  }

  const handleTeamMove = async (
    teamId: string,
    position: number,
    sourceOverride?: { ballkidId: string; ballkidName: string; fromTeamId: string | null; fromIsReserve: boolean } | null
  ) => {
    const activeItem = sourceOverride || draggedDayItemRef.current || draggedDayItem
    if (!activeItem || activeItem.fromIsReserve || !currentDay?.id) return
    await assignDayMutation.mutateAsync({
      ballkidId: activeItem.ballkidId,
      teamId,
      position,
      isReserve: false,
    })
    setDraggedDayItem(null)
    draggedDayItemRef.current = null
    setReserveDropTeamId(null)
  }

  const handleReserveZoneDrop = async (
    sourceOverride?: { ballkidId: string; ballkidName: string; fromTeamId: string | null; fromIsReserve: boolean } | null
  ) => {
    const activeItem = sourceOverride || draggedDayItemRef.current || draggedDayItem
    if (!activeItem || activeItem.fromIsReserve || !currentDay?.id) return
    await assignDayMutation.mutateAsync({
      ballkidId: activeItem.ballkidId,
      teamId: activeItem.fromTeamId,
      isReserve: true,
    })
    setDraggedDayItem(null)
    draggedDayItemRef.current = null
    setReserveDropActive(false)
  }

  const tournamentScoreMutation = useMutation({
    mutationFn: async ({ ballkidId, score }: { ballkidId: string; score: number }) => {
      return api.post(`/schedule/${tournament?.id}/day/${selectedDay}/score-simple`, { ballkidId, score })
    },
    onSuccess: (data, variables) => {
      const payload = data?.data?.data
      if (payload?.tournamentScore) {
        queryClient.setQueryData(
          ['schedule', 'day', tournament?.id, selectedDay],
          (oldData: any) => {
            if (!oldData?.day) return oldData
            const day = { ...oldData.day }
            const scores = Array.isArray(day.tournamentScores) ? [...day.tournamentScores] : []
            const idx = scores.findIndex(
              (s: any) =>
                s.tournamentDayId === payload.tournamentScore.tournamentDayId &&
                s.ballkidId === payload.tournamentScore.ballkidId &&
                s.scorerId === payload.tournamentScore.scorerId
            )
            if (idx >= 0) {
              scores[idx] = { ...scores[idx], ...payload.tournamentScore }
            } else {
              scores.push(payload.tournamentScore)
            }
            day.tournamentScores = scores

            if (payload.overallAverage != null) {
              day.courts?.forEach((court: any) => {
                court.courtTeams?.forEach((ct: any) => {
                  ct.team?.assignments?.forEach((assignment: any) => {
                    if (assignment.ballkid?.id === payload.tournamentScore.ballkidId) {
                      assignment.ballkid.overallAverage = payload.overallAverage
                    }
                  })
                })
              })
            }

            return { ...oldData, day }
          }
        )

        if (payload.overallAverage != null) {
          queryClient.setQueryData(['teams', tournament?.id], (oldTeams: any) => {
            if (!oldTeams?.teams) return oldTeams
            const teams = oldTeams.teams.map((team: any) => ({
              ...team,
              assignments: team.assignments?.map((assignment: any) => {
                if (assignment.ballkid?.id === payload.tournamentScore.ballkidId) {
                  return {
                    ...assignment,
                    ballkid: {
                      ...assignment.ballkid,
                      overallAverage: payload.overallAverage,
                    },
                  }
                }
                return assignment
              }),
            }))
            return { ...oldTeams, teams }
          })

          queryClient.setQueryData(['teams', 'day', tournament?.id, selectedDay], (oldTeams: any) => {
            if (!oldTeams?.teams) return oldTeams
            const teams = oldTeams.teams.map((team: any) => ({
              ...team,
              assignments: team.assignments?.map((assignment: any) => {
                if (assignment.ballkid?.id === payload.tournamentScore.ballkidId) {
                  return {
                    ...assignment,
                    ballkid: {
                      ...assignment.ballkid,
                      overallAverage: payload.overallAverage,
                    },
                  }
                }
                return assignment
              }),
            }))
            return { ...oldTeams, teams }
          })
        }
      }
      toast({ title: 'Note enregistrée' })
      queryClient.invalidateQueries({ queryKey: ['schedule', 'day'] })
      setEditingTournamentScores((prev) => ({ ...prev, [variables.ballkidId]: false }))
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de l\'enregistrement' })
    },
  })

  const importScoresMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!tournament?.id) throw new Error('Tournoi actif introuvable')
      const formData = new FormData()
      formData.append('file', file)
      const res = await api.post(
        `/schedule/${tournament.id}/day/${selectedDay}/import-csv`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      return res.data.data
    },
    onSuccess: (data) => {
      const errorCount = data.errors || 0
      toast({
        title: 'Import terminé',
        description: `${data.imported} note(s) importée(s), ${errorCount} erreur(s)`,
      })
      queryClient.invalidateQueries({ queryKey: ['schedule', 'day'] })
    },
    onError: (err: any) => {
      toast({
        variant: 'destructive',
        title: 'Erreur lors de l\'import',
        description: err.response?.data?.message || 'Import CSV échoué',
      })
    },
  })

  const captainMutation = useMutation({
    mutationFn: async ({ teamId, ballkidId }: { teamId: string; ballkidId: string }) => {
      return api.put(`/schedule/${tournament?.id}/day/${selectedDay}/team/${teamId}/captain`, { ballkidId })
    },
    onSuccess: () => {
      toast({ title: 'Capitaine mis à jour' })
      queryClient.invalidateQueries({ queryKey: ['schedule', 'day'] })
    },
    onError: (err: any) => {
      toast({
        variant: 'destructive',
        title: 'Erreur lors de la mise à jour',
        description: err.response?.data?.message || 'Impossible de définir le capitaine',
      })
    },
  })

  // Mutation pour ajouter une absence
  const addAbsenceMutation = useMutation({
    mutationFn: async (ballkidId: string) => {
      return api.post(`/schedule/${tournament?.id}/day/${selectedDay}/absence`, { ballkidId })
    },
    onSuccess: () => {
      toast({ title: 'Absence enregistrée' })
      queryClient.invalidateQueries({ queryKey: ['schedule', 'day'] })
    },
    onError: (err: any) => {
      toast({
        variant: 'destructive',
        title: 'Erreur lors de l\'enregistrement',
        description: err.response?.data?.message || 'Impossible d\'ajouter l\'absence',
      })
    },
  })

  // Mutation pour supprimer une absence
  const removeAbsenceMutation = useMutation({
    mutationFn: async (absenceId: string) => {
      return api.delete(`/schedule/absence/${absenceId}`)
    },
    onSuccess: () => {
      toast({ title: 'Absence supprimée' })
      queryClient.invalidateQueries({ queryKey: ['schedule', 'day'] })
    },
    onError: (err: any) => {
      toast({
        variant: 'destructive',
        title: 'Erreur lors de la suppression',
        description: err.response?.data?.message || 'Impossible de supprimer l\'absence',
      })
    },
  })

  const handleTournamentScoreSubmit = (ballkidId: string) => {
    const value = tournamentScores[ballkidId]
    if (!value) return
    const score = parseFloat(value.replace(',', '.'))
    if (!Number.isNaN(score) && score >= 0 && score <= 20) {
      tournamentScoreMutation.mutate({ ballkidId, score })
      setTournamentScores((prev) => {
        const next = { ...prev }
        delete next[ballkidId]
        return next
      })
    } else {
      toast({ variant: 'destructive', title: 'Note invalide (0-20)' })
    }
  }

  const handleImportClick = () => {
    importInputRef.current?.click()
  }

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    importScoresMutation.mutate(file)
    event.target.value = ''
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calendar className="w-6 h-6 text-blue-500" />
            Planning du tournoi
          </h1>
          <p className="text-muted-foreground">
            {days.length} jours de compétition
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleExportDay}
            title="Export CSV du planning du jour (terrains, équipes, ramasseurs)"
          >
            <Upload className="w-4 h-4 mr-2" />
            CSV Jour {selectedDay}
          </Button>
          <Button
            variant="outline"
            onClick={handleExportPDF}
            title="Export PDF du planning du jour (par terrain et équipes)"
          >
            <Upload className="w-4 h-4 mr-2" />
            PDF
          </Button>
        </div>
      </div>

      {isAdmin && days.length === 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Initialiser le tournoi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Première étape : définissez les terrains disponibles et créez le Jour 1.
            </p>
            <div className="space-y-2">
              <Label>Terrains par défaut</Label>
              <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
                {baseCourts.map((court, index) => (
                  <div key={`base-court-${index}`} className="flex items-center justify-center gap-2 rounded-md border px-2 py-1.5">
                    <Input
                      value={court.name}
                      onChange={(e) =>
                        setBaseCourts((prev) =>
                          prev.map((item, idx) =>
                            idx === index ? { ...item, name: e.target.value } : item
                          )
                        )
                      }
                      className="h-7 w-[140px] text-xs border-none shadow-none focus-visible:ring-0"
                      placeholder="Nom du terrain"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() =>
                        setBaseCourts((prev) => prev.filter((_, idx) => idx !== index))
                      }
                      title="Supprimer"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setBaseCourts((prev) => [
                      ...prev,
                      { name: `Court ${prev.length + 1}`, teamCount: 2 },
                    ])
                  }
                  className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground hover:border-primary hover:text-primary transition text-center"
                >
                  <div>Ajouter un terrain</div>
                  <div className="mt-2 flex justify-center">
                    <Plus className="w-5 h-5" />
                  </div>
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Ces terrains seront proposés chaque jour (même base que la veille).
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Chaque nouveau jour reprendra automatiquement les terrains, coachs et équipes du jour précédent.
            </p>
            <div className="flex justify-start">
              <Button
                onClick={() => setWeekMutation.mutate()}
                disabled={setWeekMutation.isPending}
              >
                <Calendar className="w-4 h-4 mr-2" />
                {setWeekMutation.isPending ? 'Création...' : 'Créer le Jour 1'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Days selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Jours du tournoi</CardTitle>
        </CardHeader>
        <CardContent>
          {days.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Aucun jour configuré. {isAdmin && 'Initialisez le tournoi pour créer les jours.'}
            </p>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {days.map((day: any) => {
                return (
                  <div key={day.dayNumber} className="relative group">
                    <Button
                      variant={selectedDay === day.dayNumber ? 'default' : 'outline'}
                      onClick={() => setSelectedDay(day.dayNumber)}
                      className="flex-col h-auto py-2 px-4 min-w-[80px]"
                    >
                      <span className="text-xs opacity-70 flex items-center gap-1">
                        Jour
                      </span>
                      <span className="text-lg font-bold">{day.dayNumber}</span>
                      <span className="text-xs opacity-70">
                        {new Date(day.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                      </span>
                    </Button>
                    {isAdmin && (
                      <div className="absolute -top-2 -right-2 hidden group-hover:flex gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleEditDay(day) }}
                          className="p-1 bg-blue-500 text-white rounded-full hover:bg-blue-600"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteDay(day.dayNumber) }}
                          className="p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
              {isAdmin && (
                <button
                  type="button"
                  onClick={handleAddDay}
                  className="flex-col h-auto py-2 px-4 min-w-[80px] rounded-md border border-dashed text-xs text-muted-foreground hover:border-primary hover:text-primary transition"
                >
                  <div>Ajouter</div>
                  <div className="mt-2 flex justify-center">
                    <Plus className="w-5 h-5" />
                  </div>
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : !currentDay ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Sélectionnez un jour pour voir le planning
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Day info */}
          <Card className="relative">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  Jour {currentDay.dayNumber}
                </span>
                <span className="text-sm font-normal text-muted-foreground">
                  {new Date(currentDay.date).toLocaleDateString('fr-FR', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Users className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Ramasseurs</p>
                    <p className="font-bold">{currentDay.ballkidCount}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <MapPin className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Terrains</p>
                    <p className="font-bold">{currentDay.courts?.length || 0}</p>
                  </div>
                </div>
                {isAdmin ? (
                  <button
                    onClick={() => setShowAbsenceModal(true)}
                    className="flex items-center gap-3 p-2 -m-2 rounded-lg hover:bg-orange-50 transition-colors"
                  >
                    <div className="p-2 bg-orange-100 rounded-lg">
                      <UserX className="w-5 h-5 text-orange-600" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm text-muted-foreground">Absences</p>
                      <p className="font-bold flex items-center gap-2">
                        {dayAbsences.length || 0}
                        {absencesWithTeamCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded-full">
                            <AlertTriangle className="w-3 h-3" />
                            {absencesWithTeamCount}
                          </span>
                        )}
                      </p>
                    </div>
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-100 rounded-lg">
                      <UserX className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Absences</p>
                      <p className="font-bold">{dayAbsences.length || 0}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Courts */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <MapPin className="w-5 h-5" />
                Terrains
              </h3>
              {isAdmin && (
                <Button size="sm" onClick={handleAddCourt}>
                  <Plus className="w-4 h-4 mr-1" />
                  Ajouter un terrain
                </Button>
              )}
            </div>
            
            <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
              {currentDay.courts?.map((court: any) => {
                const coachAssignments = court.coachAssignments || []
                const coaches = coachAssignments.map((ca: any) => ca.coach?.user).filter(Boolean)
                const coachIds = coachAssignments.map((ca: any) => ca.coach?.id).filter(Boolean)
                const hasCoachAlert = coachIds.some((coachId: string) =>
                  currentDay?.dayNumber && coachAlertDays.get(coachId)?.has(currentDay.dayNumber)
                )
                return (
                  <Card key={court.id} className="group relative flex flex-col">
                    {isAdmin && (
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => handleEditCourt(court)}
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => handleDeleteCourt(court.id, court.name)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    )}
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-muted-foreground" />
                        {court.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col flex-1">
                      <div className="space-y-3 flex-1">
                        <div>
                          <p className="text-xs text-muted-foreground">Coach{coaches.length > 1 ? 's' : ''}</p>
                          {isAdmin ? (
                            <button
                              onClick={() => {
                                setAssigningCoachCourt(court)
                                setSelectedCoachIds(coachIds)
                              }}
                              className="flex items-center gap-2 font-medium hover:text-blue-600 transition-colors"
                            >
                              {coaches.length > 0 ? (
                                <>
                                  <User className="w-4 h-4" />
                                  {coaches.map((c: any) => `${c.firstName} ${c.lastName}`).join(', ')}
                                  {hasCoachAlert && (
                                    <span
                                      className="inline-flex items-center gap-1 text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full"
                                      title="Coach assigné plus de 6 jours consécutifs"
                                    >
                                      <AlertTriangle className="w-3 h-3" />
                                      7j+
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-blue-500 flex items-center gap-1">
                                  <Plus className="w-3 h-3" />
                                  Assigner un coach
                                </span>
                              )}
                            </button>
                          ) : (
                            <p className="font-medium flex items-center gap-2">
                              {coaches.length > 0
                                ? coaches.map((c: any) => `${c.firstName} ${c.lastName}`).join(', ')
                                : 'Non assigné'}
                              {hasCoachAlert && (
                                <span
                                  className="inline-flex items-center gap-1 text-xs text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full"
                                  title="Coach assigné plus de 6 jours consécutifs"
                                >
                                  <AlertTriangle className="w-3 h-3" />
                                  7j+
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Équipes</p>
                          {court.courtTeams && court.courtTeams.length > 0 ? (
                            <div className="space-y-1 mt-1">
                              {court.courtTeams.map((ct: any) => (
                                <span
                                  key={ct.id}
                                  className="inline-block px-2 py-0.5 bg-green-100 text-green-700 rounded text-sm mr-1"
                                >
                                  Équipe {ct.team?.order || '?'}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">Aucune équipe</p>
                          )}
                          {court.courtTeams?.length > 0 && (
                            <div className="mt-3 space-y-2">
                              <p className="text-xs text-muted-foreground">Capitaine du jour</p>
                              {court.courtTeams.map((ct: any) => {
                                const members = (ct.team?.assignments || [])
                                  .filter((assignment: any) => !assignment.isReserve)
                                  .map((assignment: any) => assignment.ballkid)
                                const savedCaptain = captainByTeamId.get(ct.teamId)
                                const defaultCaptain = members.reduce((best: any, current: any) => {
                                  if (!best) return current
                                  const bestScore = trainingAverageByBallkidId.get(best.id) ?? -1
                                  const currentScore = trainingAverageByBallkidId.get(current.id) ?? -1
                                  return currentScore > bestScore ? current : best
                                }, null as any)
                                const selectedCaptainId =
                                  savedCaptain?.ballkidId || defaultCaptain?.id || ''

                                return (
                                  <div key={`${ct.id}-captain`} className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-muted-foreground w-20">
                                      Équipe {ct.team?.order || '?'}
                                    </span>
                                    <select
                                      className="w-full max-w-[220px] rounded-md border border-input bg-white px-2 py-1 text-sm"
                                      value={selectedCaptainId}
                                      disabled={!isAdmin || members.length === 0}
                                      onChange={(e) => {
                                        if (!e.target.value) return
                                        captainMutation.mutate({
                                          teamId: ct.teamId,
                                          ballkidId: e.target.value,
                                        })
                                      }}
                                    >
                                      {members.length === 0 ? (
                                        <option value="">Aucun membre</option>
                                      ) : (
                                        members.map((member: any) => (
                                          <option key={member.id} value={member.id}>
                                            {member.lastName} {member.firstName}
                                          </option>
                                        ))
                                      )}
                                    </select>
                                    <span className="inline-flex min-w-[44px] justify-end">
                                      {savedCaptain ? (
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-700">
                                          Cap
                                        </span>
                                      ) : (
                                        selectedCaptainId && (
                                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                                            Auto
                                          </span>
                                        )
                                      )}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                      {isAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 self-start"
                          onClick={() => handleOpenTeamAssign(court)}
                        >
                          <UserPlus className="w-3 h-3 mr-1" />
                          {court.courtTeams?.length > 0 ? 'Modifier' : 'Assigner'}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                )
              })}

              {(!currentDay.courts || currentDay.courts.length === 0) && (
                <Card className="col-span-full">
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <p>Aucun terrain configuré pour ce jour</p>
                    {isAdmin && (
                      <Button variant="outline" size="sm" className="mt-3" onClick={handleAddCourt}>
                        <Plus className="w-4 h-4 mr-1" />
                        Ajouter un terrain
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Notes tournoi */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Équipes du jour
                </CardTitle>
                {isAdmin && (
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleExportTeams}>
                      <Download className="w-4 h-4 mr-1" />
                      CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleExportTeamsPDF}>
                      <Download className="w-4 h-4 mr-1" />
                      PDF
                    </Button>
                    {dayTeams.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => balanceTeamsMutation.mutate()}
                        disabled={balanceTeamsMutation.isPending}
                      >
                        <Scale className="w-4 h-4 mr-1" />
                        Équilibrer
                      </Button>
                    )}
                    <Button
                      variant={dayTeams.length > 0 ? 'outline' : 'default'}
                      size="sm"
                      onClick={openGenerateTeamsModal}
                      disabled={generateTeamsMutation.isPending}
                    >
                      <Wand2 className="w-4 h-4 mr-1" />
                      {dayTeams.length > 0 ? 'Regénérer' : 'Générer'}
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent
              className={`relative ${showReservesDrawer ? 'md:pr-[21rem]' : ''}`}
            >
              {dayTeams.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowReservesDrawer((prev) => !prev)}
                  className="absolute right-3 top-3 z-20 flex flex-col items-center gap-2 rounded-full border border-purple-200 bg-white px-2.5 py-3 text-purple-600 shadow-lg hover:bg-purple-50"
                >
                  <AlignJustify className="w-4 h-4" />
                  {dayReservesView.length > 0 && (
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700">
                      {dayReservesView.length}
                    </span>
                  )}
                </button>
              )}
              {dayTeams.length ? (
                <div
                  className={`grid gap-3 md:grid-cols-2 lg:grid-cols-3 ${
                    showReservesDrawer ? 'xl:grid-cols-4' : 'xl:grid-cols-5'
                  }`}
                >
                  {dayTeamsView.map(({ team, members }) => (
                    (() => {
                      const memberScores = members
                        .map((assignment: any) => dayScoreByBallkidId.get(assignment.ballkid?.id || ''))
                        .filter((value: any) => value != null) as number[]
                      const teamAvg = memberScores.length > 0
                        ? memberScores.reduce((sum, value) => sum + value, 0) / memberScores.length
                        : null
                      const teamColor = teamAvg != null ? getTeamAverageColor(teamAvg) : null

                      return (
                    <Card key={team.id} className="overflow-hidden">
                      <CardHeader className="py-2 px-3">
                        <CardTitle className="text-sm flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center font-bold text-xs">
                              {team.order || team.name}
                            </span>
                            Équipe {team.order || team.name}
                          </span>
                          {teamAvg != null && teamColor && (
                            <span
                              className="text-xs font-medium px-1.5 py-0.5 rounded"
                              style={{ backgroundColor: teamColor.bg, color: teamColor.text }}
                            >
                              {teamAvg.toFixed(1)}
                            </span>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-2 pb-2">
                        <div className="space-y-1">
                          {members
                            .sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
                            .map((assignment: any) => {
                              const ballkid = assignment.ballkid
                              if (!ballkid) return null
                              const scores = currentDay.tournamentScores?.filter(
                                (s: any) => s.ballkidId === ballkid.id
                              ) || []
                              const currentUserScore = scores.find((s: any) => s.scorerId === user?.id)
                              const avgScore = ballkid.overallAverage ?? ballkid.averageTrainingScore ?? null
                              const canEdit = isAdmin
                              const isEditing = editingTournamentScores[ballkid.id]

                              return (
                                  <div
                                    key={ballkid.id}
                                    className={`flex items-center gap-2 p-2 rounded bg-gray-50 ${
                                      dropTargetBallkidId === ballkid.id ? 'ring-2 ring-blue-400 bg-blue-50' : ''
                                    }`}
                                    draggable={isAdmin}
                                    onDragStart={(event) => {
                                      const nextItem = {
                                        ballkidId: ballkid.id,
                                        ballkidName: `${ballkid.lastName} ${ballkid.firstName}`,
                                        fromTeamId: team.id,
                                        fromIsReserve: false,
                                      }
                                      event.dataTransfer?.setData('application/json', JSON.stringify(nextItem))
                                      event.dataTransfer?.setData('text/plain', JSON.stringify(nextItem))
                                      event.dataTransfer?.setDragImage(event.currentTarget, 20, 20)
                                      setDraggedDayItem(nextItem)
                                      draggedDayItemRef.current = nextItem
                                    }}
                                    onDragEnd={() => {
                                      setDraggedDayItem(null)
                                      draggedDayItemRef.current = null
                                      setDropTargetBallkidId(null)
                                      setReserveDropActive(false)
                                    }}
                                  onDragOver={(e) => {
                                    e.preventDefault()
                                    if (!draggedDayItem && !draggedDayItemRef.current) return
                                    const activeId = draggedDayItemRef.current?.ballkidId || draggedDayItem?.ballkidId
                                    if (activeId && activeId !== ballkid.id) {
                                      setDropTargetBallkidId(ballkid.id)
                                    }
                                  }}
                                  onDragLeave={() => setDropTargetBallkidId(null)}
                                    onDrop={(event) => {
                                      event.preventDefault()
                                      handleDaySwap(
                                        {
                                          ballkidId: ballkid.id,
                                          ballkidName: `${ballkid.lastName} ${ballkid.firstName}`,
                                          teamId: team.id,
                                          isReserve: false,
                                        },
                                        readDragPayload(event)
                                      )
                                    }}
                                  >
                                  {ballkid.photoUrl ? (
                                    <img
                                      src={ballkid.photoUrl}
                                      alt={`${ballkid.firstName} ${ballkid.lastName}`}
                                      className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                                    />
                                  ) : (
                                    <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                                      <User className="w-3 h-3 text-gray-400" />
                                    </div>
                                  )}
                                  <Link
                                    to={`/ballkids/${ballkid.id}?from=schedule&day=${selectedDay}`}
                                    className={`text-sm font-medium flex-1 truncate hover:underline ${absentBallkidIds.has(ballkid.id) ? 'text-red-600' : ''}`}
                                  >
                                    {ballkid.lastName} {ballkid.firstName}
                                  </Link>
                                  {avgScore != null && (() => {
                                    const scoreColor = getScoreColor(avgScore, minOverallScore, maxOverallScore)
                                    return (
                                      <span
                                        className="text-[11px] font-medium px-1.5 py-0.5 rounded"
                                        style={{ backgroundColor: scoreColor.bg, color: scoreColor.text }}
                                      >
                                        {avgScore.toFixed(1)}
                                      </span>
                                    )
                                  })()}
                                  {canEdit && (!currentUserScore || isEditing) ? (
                                    <div className="flex items-center gap-1.5">
                                      <Input
                                        type="text"
                                        inputMode="decimal"
                                        placeholder="0-20"
                                        value={tournamentScores[ballkid.id] || ''}
                                        onChange={(e) =>
                                          setTournamentScores((prev) => ({
                                            ...prev,
                                            [ballkid.id]: e.target.value,
                                          }))
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault()
                                            handleTournamentScoreSubmit(ballkid.id)
                                          }
                                        }}
                                        onBlur={() => {
                                          if (tournamentScores[ballkid.id]) {
                                            handleTournamentScoreSubmit(ballkid.id)
                                          }
                                        }}
                                        className="h-6 w-12 text-center text-[11px] px-1"
                                      />
                                      {currentUserScore && isEditing && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 w-7 p-0"
                                          onClick={() => {
                                            setEditingTournamentScores((prev) => ({
                                              ...prev,
                                              [ballkid.id]: false,
                                            }))
                                            setTournamentScores((prev) => {
                                              const next = { ...prev }
                                              delete next[ballkid.id]
                                              return next
                                            })
                                          }}
                                          title="Annuler"
                                        >
                                          <X className="w-3 h-3" />
                                        </Button>
                                      )}
                                    </div>
                                  ) : currentUserScore ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (!canEdit) return
                                        setEditingTournamentScores((prev) => ({
                                          ...prev,
                                          [ballkid.id]: true,
                                        }))
                                        setTournamentScores((prev) => ({
                                          ...prev,
                                          [ballkid.id]: currentUserScore.totalScore?.toFixed(1) || '',
                                        }))
                                      }}
                                      className="inline-flex items-center gap-1 font-mono text-sm font-semibold text-blue-600 hover:text-blue-700"
                                      title={canEdit ? 'Cliquer pour modifier' : undefined}
                                    >
                                      {currentUserScore.totalScore?.toFixed(1)}
                                      {canEdit && <Pencil className="w-3 h-3" />}
                                    </button>
                                  ) : (
                                    avgScore != null ? (() => {
                                      const scoreColor = getScoreColor(avgScore, minOverallScore, maxOverallScore)
                                      return (
                                        <span
                                          className="text-xs font-medium px-1.5 py-0.5 rounded"
                                          style={{ backgroundColor: scoreColor.bg, color: scoreColor.text }}
                                        >
                                          {avgScore.toFixed(1)}
                                        </span>
                                      )
                                    })() : (
                                      <span className="text-xs text-muted-foreground">-</span>
                                    )
                                  )}
                                </div>
                              )
                            })}
                          {members.length === 0 && (
                            <p className="text-xs text-muted-foreground text-center py-4">
                              Aucun membre
                            </p>
                          )}
                        </div>
                        {isAdmin && (
                          <div 
                            className="mt-2"
                            onDragOver={(e) => {
                              e.preventDefault()
                              const activeItem = draggedDayItemRef.current || draggedDayItem
                              if (!activeItem) return
                              setReserveDropTeamId(team.id)
                            }}
                            onDragLeave={() => setReserveDropTeamId(null)}
                            onDrop={(event) => {
                              event.preventDefault()
                              const payload = readDragPayload(event)
                              if (payload?.fromIsReserve) {
                                handleReserveDrop(team.id, members.length + 1, payload)
                                return
                              }
                              if (payload) {
                                handleTeamMove(team.id, members.length + 1, payload)
                              }
                            }}
                          >
                            <button
                              type="button"
                              className={`flex items-center justify-center w-full h-10 rounded-md border border-dashed text-sm cursor-pointer transition-colors ${
                                reserveDropTeamId === team.id
                                  ? 'border-purple-400 text-purple-600 bg-purple-50'
                                  : 'border-purple-200 text-purple-400 hover:border-purple-400 hover:text-purple-600 hover:bg-purple-50'
                              }`}
                              onClick={() => setAddReserveModal({ teamId: team.id, teamNumber: team.number, position: members.length + 1 })}
                            >
                              + Ajouter
                            </button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                      )
                    })()
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-6">
                  Aucun ramasseur assigné à ce jour
                </p>
              )}
              {dayTeams.length > 0 && (
                <div
                  className={`absolute right-3 top-12 z-30 w-80 max-w-[90vw] transform transition-all duration-200 ${
                    showReservesDrawer
                      ? 'translate-x-0 opacity-100'
                      : 'translate-x-4 opacity-0 pointer-events-none'
                  }`}
                >
                  <Card className="max-h-[70vh] rounded-2xl border-purple-200 shadow-2xl">
                    <CardHeader className="py-2 px-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-purple-500 text-white flex items-center justify-center font-bold text-xs">
                            R
                          </span>
                          Remplaçants
                        <span className="text-xs font-normal text-muted-foreground ml-1">
                          {dayReservesView.length}
                        </span>
                        </CardTitle>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => setShowReservesDrawer(false)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="px-2 pb-2 max-h-[calc(70vh-52px)] overflow-hidden">
                      <div className="space-y-1 max-h-[45vh] overflow-y-auto pr-1">
                        {dayReservesView.map((assignment: any) => {
                          const ballkid = assignment.ballkid
                          if (!ballkid) return null
                            const scores = currentDay.tournamentScores?.filter(
                              (s: any) => s.ballkidId === ballkid.id
                            ) || []
                            const currentUserScore = scores.find((s: any) => s.scorerId === user?.id)
                            const avgScore = ballkid.overallAverage ?? ballkid.averageTrainingScore ?? null
                            const canEdit = isAdmin
                            const isEditing = editingTournamentScores[ballkid.id]

                            return (
                              <div
                                key={ballkid.id}
                                className={`flex items-center gap-2 p-2 rounded bg-purple-50 ${
                                  dropTargetBallkidId === ballkid.id ? 'ring-2 ring-blue-400 bg-blue-50' : ''
                                }`}
                                draggable={isAdmin}
                                onDragStart={(event) => {
                                  const nextItem = {
                                    ballkidId: ballkid.id,
                                    ballkidName: `${ballkid.lastName} ${ballkid.firstName}`,
                                    fromTeamId: assignment.teamId,
                                    fromIsReserve: true,
                                  }
                                  event.dataTransfer?.setData('application/json', JSON.stringify(nextItem))
                                  event.dataTransfer?.setData('text/plain', JSON.stringify(nextItem))
                                  event.dataTransfer?.setDragImage(event.currentTarget, 20, 20)
                                  setDraggedDayItem(nextItem)
                                  draggedDayItemRef.current = nextItem
                                }}
                                onDragEnd={() => {
                                  setDraggedDayItem(null)
                                  draggedDayItemRef.current = null
                                  setDropTargetBallkidId(null)
                                  setReserveDropActive(false)
                                }}
                                onDragOver={(e) => {
                                  e.preventDefault()
                                  const activeId = draggedDayItemRef.current?.ballkidId || draggedDayItem?.ballkidId
                                  if (activeId && activeId !== ballkid.id) {
                                    setDropTargetBallkidId(ballkid.id)
                                  }
                                }}
                                onDragLeave={() => setDropTargetBallkidId(null)}
                                onDrop={(event) => {
                                  event.preventDefault()
                                  handleDaySwap(
                                    {
                                      ballkidId: ballkid.id,
                                      ballkidName: `${ballkid.lastName} ${ballkid.firstName}`,
                                      teamId: assignment.teamId,
                                      isReserve: true,
                                    },
                                    readDragPayload(event)
                                  )
                                }}
                              >
                                {ballkid.photoUrl ? (
                                  <img
                                    src={ballkid.photoUrl}
                                    alt={`${ballkid.firstName} ${ballkid.lastName}`}
                                    className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                                  />
                                ) : (
                                  <div className="w-7 h-7 rounded-full bg-purple-200 flex items-center justify-center flex-shrink-0">
                                    <User className="w-3 h-3 text-purple-400" />
                                  </div>
                                )}
                                <Link
                                  to={`/ballkids/${ballkid.id}?from=schedule&day=${selectedDay}`}
                                  className={`text-sm font-medium flex-1 truncate hover:underline ${absentBallkidIds.has(ballkid.id) ? 'text-red-600' : ''}`}
                                >
                                  {ballkid.lastName} {ballkid.firstName}
                                </Link>
                                {avgScore != null && (() => {
                                  const scoreColor = getScoreColor(avgScore, minOverallScore, maxOverallScore)
                                  return (
                                    <span
                                      className="text-[11px] font-medium px-1.5 py-0.5 rounded"
                                      style={{ backgroundColor: scoreColor.bg, color: scoreColor.text }}
                                    >
                                      {avgScore.toFixed(1)}
                                    </span>
                                  )
                                })()}
                                {canEdit && (!currentUserScore || isEditing) ? (
                                  <div className="flex items-center gap-1.5">
                                    <Input
                                      type="text"
                                      inputMode="decimal"
                                      placeholder="0-20"
                                      value={tournamentScores[ballkid.id] || ''}
                                      onChange={(e) =>
                                        setTournamentScores((prev) => ({
                                          ...prev,
                                          [ballkid.id]: e.target.value,
                                        }))
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault()
                                          handleTournamentScoreSubmit(ballkid.id)
                                        }
                                      }}
                                      onBlur={() => {
                                        if (tournamentScores[ballkid.id]) {
                                          handleTournamentScoreSubmit(ballkid.id)
                                        }
                                      }}
                                      className="h-6 w-12 text-center text-[11px] px-1"
                                    />
                                    {currentUserScore && isEditing && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 w-7 p-0"
                                        onClick={() => {
                                          setEditingTournamentScores((prev) => ({
                                            ...prev,
                                            [ballkid.id]: false,
                                          }))
                                          setTournamentScores((prev) => {
                                            const next = { ...prev }
                                            delete next[ballkid.id]
                                            return next
                                          })
                                        }}
                                        title="Annuler"
                                      >
                                        <X className="w-3 h-3" />
                                      </Button>
                                    )}
                                  </div>
                                ) : currentUserScore ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!canEdit) return
                                      setEditingTournamentScores((prev) => ({
                                        ...prev,
                                        [ballkid.id]: true,
                                      }))
                                      setTournamentScores((prev) => ({
                                        ...prev,
                                        [ballkid.id]: currentUserScore.totalScore?.toFixed(1) || '',
                                      }))
                                    }}
                                    className="inline-flex items-center gap-1 font-mono text-sm font-semibold text-blue-600 hover:text-blue-700"
                                    title={canEdit ? 'Cliquer pour modifier' : undefined}
                                  >
                                    {currentUserScore.totalScore?.toFixed(1)}
                                    {canEdit && <Pencil className="w-3 h-3" />}
                                  </button>
                                ) : (
                                  avgScore != null ? (() => {
                                    const scoreColor = getScoreColor(avgScore, minOverallScore, maxOverallScore)
                                    return (
                                      <span
                                        className="text-xs font-medium px-1.5 py-0.5 rounded"
                                        style={{ backgroundColor: scoreColor.bg, color: scoreColor.text }}
                                      >
                                        {avgScore.toFixed(1)}
                                      </span>
                                    )
                                  })() : (
                                    <span className="text-xs text-muted-foreground">-</span>
                                  )
                                )}
                              </div>
                            )
                          })}
                        </div>
                      {isAdmin && (
                        <div className="mt-2">
                          <div
                            className={`flex items-center justify-center w-full h-10 rounded-md border border-dashed text-sm ${
                              reserveDropActive
                                ? 'border-blue-400 text-blue-600 bg-blue-50'
                                : 'border-blue-200 text-blue-400'
                            }`}
                            title="Déplacer vers remplaçants"
                            onDragOver={(e) => {
                              e.preventDefault()
                              const activeItem = draggedDayItemRef.current || draggedDayItem
                              if (!activeItem || activeItem.fromIsReserve) return
                              setReserveDropActive(true)
                            }}
                            onDragLeave={() => setReserveDropActive(false)}
                            onDrop={(event) => {
                              event.preventDefault()
                              handleReserveZoneDrop(readDragPayload(event))
                            }}
                          >
                            +
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </CardContent>
          </Card>
    </div>
  )}

  {showGenerateTeamsModal && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-md mx-4 flex flex-col max-h-[90vh]">
        <CardHeader className="flex-shrink-0">
          <CardTitle className="flex items-center justify-between">
            <span>{dayTeams.length > 0 ? 'Regénérer les équipes' : 'Générer les équipes'}</span>
            <button
              onClick={() => setShowGenerateTeamsModal(false)}
              className="p-1 hover:bg-gray-100 rounded"
            >
              <X className="w-5 h-5" />
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto">
          <form
            id="generate-teams-day-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (generateTeamCount < 1 || generateTeamSize < 1) return
              generateTeamsMutation.mutate({
                teamCount: generateTeamCount,
                teamSize: generateTeamSize,
              })
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="dayTeamCount">Nombre d'équipes</Label>
              <Input
                id="dayTeamCount"
                type="number"
                min="1"
                value={generateTeamCount}
                onChange={(e) => setGenerateTeamCount(parseInt(e.target.value || '0', 10))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dayTeamSize">Ramasseurs par équipe</Label>
              <Input
                id="dayTeamSize"
                type="number"
                min="1"
                value={generateTeamSize}
                onChange={(e) => setGenerateTeamSize(parseInt(e.target.value || '0', 10))}
              />
            </div>
            {dayTeams.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Cette action remplace les équipes existantes.
              </p>
            )}
          </form>
        </CardContent>
        <div className="flex-shrink-0 flex justify-end gap-2 p-4 border-t bg-white rounded-b-lg">
          <Button type="button" variant="outline" onClick={() => setShowGenerateTeamsModal(false)}>
            Annuler
          </Button>
          <Button type="submit" form="generate-teams-day-form" disabled={generateTeamsMutation.isPending}>
            <Wand2 className="w-4 h-4 mr-2" />
            {generateTeamsMutation.isPending ? 'Génération...' : 'Valider'}
          </Button>
        </div>
      </Card>
    </div>
  )}

  {/* Modal d'édition de jour */}
      {showDayModal && editingDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4 flex flex-col max-h-[90vh]">
            <CardHeader className="flex-shrink-0">
              <CardTitle className="flex items-center justify-between">
                <span>{editingDay.isNew ? 'Ajouter un jour' : `Modifier le jour ${editingDay.dayNumber}`}</span>
                <button
                  onClick={() => { setShowDayModal(false); setEditingDay(null) }}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              <form
                id="day-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  saveDayMutation.mutate({
                    dayNumber: editingDay.dayNumber,
                    date: editingDay.date,
                    ballkidCount: editingDay.ballkidCount,
                  })
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="dayNumber">Numéro du jour</Label>
                  <Input
                    id="dayNumber"
                    type="number"
                    min="1"
                    value={editingDay.dayNumber}
                    onChange={(e) => setEditingDay({ ...editingDay, dayNumber: parseInt(e.target.value) })}
                    disabled={!editingDay.isNew}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="date">Date</Label>
                  <Input
                    id="date"
                    type="date"
                    value={editingDay.date}
                    onChange={(e) => setEditingDay({ ...editingDay, date: e.target.value })}
                  />
                </div>
              </form>
            </CardContent>
            <div className="flex-shrink-0 flex justify-end gap-2 p-4 border-t bg-white rounded-b-lg">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setShowDayModal(false); setEditingDay(null) }}
              >
                Annuler
              </Button>
              <Button type="submit" form="day-form" disabled={saveDayMutation.isPending}>
                <Save className="w-4 h-4 mr-2" />
                {saveDayMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Modal d'édition de terrain */}
      {showCourtModal && editingCourt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4 flex flex-col max-h-[90vh]">
            <CardHeader className="flex-shrink-0">
              <CardTitle className="flex items-center justify-between">
                <span>{editingCourt.isNew ? 'Ajouter un terrain' : `Modifier ${editingCourt.name}`}</span>
                <button
                  onClick={() => { setShowCourtModal(false); setEditingCourt(null) }}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              <form
                id="court-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  saveCourtMutation.mutate({
                    id: editingCourt.isNew ? undefined : editingCourt.id,
                    name: editingCourt.name,
                    teamCount: editingCourt.teamCount,
                  })
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="courtName">Nom du terrain</Label>
                  <Input
                    id="courtName"
                    value={editingCourt.name}
                    onChange={(e) => setEditingCourt({ ...editingCourt, name: e.target.value })}
                    placeholder="Ex: Court Central, Court 1, Suzanne Lenglen..."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="teamCount">Nombre d'équipes</Label>
                  <Input
                    id="teamCount"
                    type="number"
                    min="1"
                    max="4"
                    value={editingCourt.teamCount}
                    onChange={(e) => setEditingCourt({ ...editingCourt, teamCount: parseInt(e.target.value) })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Généralement 2 équipes par terrain (rotation)
                  </p>
                </div>
              </form>
            </CardContent>
            <div className="flex-shrink-0 flex justify-end gap-2 p-4 border-t bg-white rounded-b-lg">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setShowCourtModal(false); setEditingCourt(null) }}
              >
                Annuler
              </Button>
              <Button type="submit" form="court-form" disabled={saveCourtMutation.isPending}>
                <Save className="w-4 h-4 mr-2" />
                {saveCourtMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Modal d'assignation d'équipes */}
      {showTeamAssignModal && assigningCourt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <CardHeader className="flex-shrink-0">
              <CardTitle className="flex items-center justify-between">
                <span>Assigner des équipes à {assigningCourt.name}</span>
                <button
                  onClick={() => { setShowTeamAssignModal(false); setAssigningCourt(null); setSelectedTeamIds([]) }}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              <p className="text-sm text-muted-foreground mb-4">
                Sélectionnez jusqu'à {assigningCourt.teamCount} équipe(s) pour ce terrain.
                ({selectedTeamIds.length}/{assigningCourt.teamCount} sélectionnée(s))
              </p>
              
              {(teamsData?.teams || []).length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  Aucune équipe créée. Générez-les depuis "Équipes du jour".
                </p>
              ) : (
                <div className="space-y-2">
                  {(teamsData?.teams || []).map((team: any) => {
                    const isSelected = selectedTeamIds.includes(team.id)
                    // Vérifier si l'équipe est déjà assignée à un autre terrain ce jour
                    const isAssignedElsewhere = currentDay?.courts?.some((c: any) => 
                      c.id !== assigningCourt.id && 
                      c.courtTeams?.some((ct: any) => ct.team?.id === team.id || ct.teamId === team.id)
                    )
                    // Récupérer uniquement les membres (pas les remplaçants)
                    const members = team.assignments?.filter((a: any) => !a.isReserve) || []
                    
                    return (
                      <div
                        key={team.id}
                        onClick={() => !isAssignedElsewhere && toggleTeamSelection(team.id)}
                        className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                          isSelected 
                            ? 'border-green-500 bg-green-50' 
                            : isAssignedElsewhere
                            ? 'border-gray-200 bg-gray-100 cursor-not-allowed opacity-60'
                            : 'border-gray-200 hover:border-gray-400'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <p className="text-sm font-semibold text-muted-foreground">Équipe {team.order}</p>
                              {isSelected && (
                                <div className="w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
                                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                </div>
                              )}
                              {isAssignedElsewhere && !isSelected && (
                                <span className="text-xs text-orange-600">Déjà assignée</span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {members.map((a: any) => (
                                <div 
                                  key={a.id} 
                                  className="flex items-center gap-1 bg-gray-100 rounded-full pl-0.5 pr-2 py-0.5"
                                >
                                  {a.ballkid.photoUrl ? (
                                    <img 
                                      src={a.ballkid.photoUrl}
                                      alt=""
                                      className="w-5 h-5 rounded-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-5 h-5 rounded-full bg-gray-300 flex items-center justify-center">
                                      <User className="w-3 h-3 text-gray-500" />
                                    </div>
                                  )}
                                  <span className="text-xs truncate max-w-[80px]">
                                    {a.ballkid.firstName}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              
            </CardContent>
            <div className="flex-shrink-0 flex justify-end gap-2 p-4 border-t bg-white rounded-b-lg">
              <Button
                variant="outline"
                onClick={() => { setShowTeamAssignModal(false); setAssigningCourt(null); setSelectedTeamIds([]) }}
              >
                Annuler
              </Button>
              <Button 
                onClick={() => assignTeamsMutation.mutate({ 
                  courtId: assigningCourt.id, 
                  teamIds: selectedTeamIds 
                })}
                disabled={assignTeamsMutation.isPending}
              >
                <Save className="w-4 h-4 mr-2" />
                {assignTeamsMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Modal d'assignation de coach */}
      {assigningCoachCourt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
            <CardHeader className="flex-shrink-0">
              <CardTitle className="flex items-center justify-between">
                <span>Assigner des coachs à {assigningCoachCourt.name}</span>
                <button
                  onClick={() => {
                    setAssigningCoachCourt(null)
                    setSelectedCoachIds([])
                  }}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              <p className="text-sm text-muted-foreground mb-4">
                Sélectionnez un ou plusieurs coachs pour ce terrain.
                ({selectedCoachIds.length} sélectionné{selectedCoachIds.length > 1 ? 's' : ''})
              </p>
              {availableCoachesForDay.length === 0 ? (
                <div className="text-center py-8">
                  <AlertTriangle className="w-8 h-8 text-orange-500 mx-auto mb-2" />
                  <p className="text-muted-foreground">Aucun coach disponible pour ce jour.</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Gérez les disponibilités dans l'onglet "Coachs".
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Coachs disponibles */}
                  {availableCoachesForDay.map((coach: any) => {
                    const isSelected = selectedCoachIds.includes(coach.id)
                    // Compter le nombre de terrains où ce coach est déjà assigné ce jour
                    const assignedCourtsCount = currentDay?.courts?.filter((c: any) => 
                      c.id !== assigningCoachCourt.id && 
                      c.coachAssignments?.some((ca: any) => ca.coach?.id === coach.id)
                    ).length || 0
                    
                    return (
                      <div
                        key={coach.id}
                        onClick={() => {
                          setSelectedCoachIds(prev => 
                            prev.includes(coach.id)
                              ? prev.filter(id => id !== coach.id)
                              : [...prev, coach.id]
                          )
                        }}
                        className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                          isSelected 
                            ? 'border-green-500 bg-green-50' 
                            : 'border-gray-200 hover:border-gray-400'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-muted-foreground" />
                            <p className="font-medium">{coach.firstName} {coach.lastName}</p>
                            {assignedCourtsCount > 0 && (
                              <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                {assignedCourtsCount} autre{assignedCourtsCount > 1 ? 's' : ''} court{assignedCourtsCount > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                          {isSelected && (
                            <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {/* Afficher les coachs non disponibles comme info */}
                  {allCoaches.filter((c: any) => !availableCoachesForDay.some((ac: any) => ac.id === c.id)).length > 0 && (
                    <div className="mt-4 pt-4 border-t">
                      <p className="text-xs text-muted-foreground mb-2">Coachs non disponibles ce jour :</p>
                      <div className="space-y-1">
                        {allCoaches
                          .filter((c: any) => !availableCoachesForDay.some((ac: any) => ac.id === c.id))
                          .map((coach: any) => (
                            <div key={coach.id} className="text-sm text-muted-foreground flex items-center gap-2 opacity-50">
                              <User className="w-3 h-3" />
                              {coach.user?.firstName} {coach.user?.lastName}
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
            <div className="flex-shrink-0 flex justify-end gap-2 p-4 border-t bg-white rounded-b-lg">
              <Button
                variant="outline"
                onClick={() => {
                  setAssigningCoachCourt(null)
                  setSelectedCoachIds([])
                }}
              >
                Annuler
              </Button>
              <Button
                onClick={() => assignCoachMutation.mutate({
                  courtId: assigningCoachCourt.id,
                  coachIds: selectedCoachIds,
                })}
                disabled={assignCoachMutation.isPending}
              >
                <Save className="w-4 h-4 mr-2" />
                {assignCoachMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
            </div>
          </Card>
        </div>
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
              {dayReservesView.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Aucun remplaçant disponible</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground mb-3">Sélectionnez un remplaçant :</p>
                  {dayReservesView.map((assignment: any) => {
                    const ballkid = assignment.ballkid
                    const avgScore = ballkid?.overallAverage ?? ballkid?.averageTrainingScore
                    const scoreColor = avgScore != null ? getScoreColor(avgScore, minOverallScore, maxOverallScore) : null
                    return (
                      <button
                        key={ballkid.id}
                        type="button"
                        className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-purple-50 hover:border-purple-300 transition-colors text-left"
                        onClick={() => {
                          handleReserveDrop(addReserveModal.teamId, addReserveModal.position, {
                            ballkidId: ballkid.id,
                            ballkidName: `${ballkid.lastName} ${ballkid.firstName}`,
                            fromTeamId: assignment.teamId,
                            fromIsReserve: true,
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
                            {avgScore.toFixed(1)}
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

      {/* Modal de gestion des absences */}
      {showAbsenceModal && currentDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <CardHeader className="flex-shrink-0">
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <UserX className="w-5 h-5" />
                  Absences du jour {currentDay.dayNumber}
                </span>
                <button
                  onClick={() => {
                    setShowAbsenceModal(false)
                    setAbsenceSearch('')
                  }}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto space-y-4">
              {/* Search bar */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Rechercher un ramasseur..."
                  value={absenceSearch}
                  onChange={(e) => setAbsenceSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Search results */}
              {absenceSearch.length >= 2 && (
                <div className="border rounded-lg max-h-48 overflow-y-auto">
                  {(() => {
                    const searchLower = absenceSearch.toLowerCase()
                    const filtered = (selectedBallkidsData?.ballkids || []).filter(
                      (b: any) =>
                        !absentBallkidIds.has(b.id) &&
                        (`${b.lastName} ${b.firstName}`.toLowerCase().includes(searchLower) ||
                          `${b.firstName} ${b.lastName}`.toLowerCase().includes(searchLower))
                    )
                    if (filtered.length === 0) {
                      return (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          Aucun ramasseur trouvé
                        </p>
                      )
                    }
                    return filtered.slice(0, 10).map((ballkid: any) => {
                      const isAssigned = assignedBallkidIds.has(ballkid.id)
                      return (
                        <button
                          key={ballkid.id}
                          onClick={() => {
                            addAbsenceMutation.mutate(ballkid.id)
                            setAbsenceSearch('')
                          }}
                          disabled={addAbsenceMutation.isPending}
                          className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 border-b last:border-b-0 text-left"
                        >
                          {ballkid.photoUrl ? (
                            <img
                              src={ballkid.photoUrl}
                              alt=""
                              className="w-8 h-8 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                              <User className="w-4 h-4 text-gray-400" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">
                              {ballkid.lastName} {ballkid.firstName}
                            </p>
                          </div>
                          {isAssigned && (
                            <span className="inline-flex items-center gap-1 text-xs text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">
                              <AlertTriangle className="w-3 h-3" />
                              En équipe
                            </span>
                          )}
                          <Plus className="w-4 h-4 text-muted-foreground" />
                        </button>
                      )
                    })
                  })()}
                </div>
              )}

              {/* Current absences list */}
              <div>
                <p className="text-sm font-medium mb-2">
                  Absents ({dayAbsences.length})
                </p>
                {dayAbsences.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4 border rounded-lg">
                    Aucune absence enregistrée
                  </p>
                ) : (
                  <div className="border rounded-lg divide-y">
                    {dayAbsences.map((absence: any) => {
                      const ballkid = absence.ballkid
                      const isAssigned = assignedBallkidIds.has(absence.ballkidId)
                      return (
                        <div
                          key={absence.id}
                          className="flex items-center gap-3 p-3"
                        >
                          {ballkid?.photoUrl ? (
                            <img
                              src={ballkid.photoUrl}
                              alt=""
                              className="w-8 h-8 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                              <User className="w-4 h-4 text-gray-400" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">
                              {ballkid?.lastName} {ballkid?.firstName}
                            </p>
                          </div>
                          {isAssigned && (
                            <span className="inline-flex items-center gap-1 text-xs text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">
                              <AlertTriangle className="w-3 h-3" />
                              En équipe
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => removeAbsenceMutation.mutate(absence.id)}
                            disabled={removeAbsenceMutation.isPending}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </CardContent>
            <div className="flex-shrink-0 flex justify-end gap-2 p-4 border-t bg-white rounded-b-lg">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAbsenceModal(false)
                  setAbsenceSearch('')
                }}
              >
                Fermer
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
