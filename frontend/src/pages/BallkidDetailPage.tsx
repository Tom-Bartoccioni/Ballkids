import { useState, useRef } from 'react'
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { 
  ArrowLeft, Mail, Phone, MapPin, Shirt, Trash2, Pencil, User, 
  Star, Calendar, Award, Users, Check, X, Save, Camera
} from 'lucide-react'

const statusLabels: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'En attente', color: 'bg-orange-100 text-orange-700' },
  REGISTERED: { label: 'Inscrit', color: 'bg-blue-100 text-blue-700' },
  SELECTED: { label: 'Sélectionné', color: 'bg-green-100 text-green-700' },
  RESERVE: { label: 'Remplaçant', color: 'bg-purple-100 text-purple-700' },
  REJECTED: { label: 'Refusé', color: 'bg-red-100 text-red-700' },
}

export default function BallkidDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { isAdmin, user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [selectionInput, setSelectionInput] = useState('')
  const [editingSelectionScores, setEditingSelectionScores] = useState<Record<string, string>>({})
  const [editingTrainingScores, setEditingTrainingScores] = useState<Record<string, string>>({})
  const [trainingDrafts, setTrainingDrafts] = useState<Record<number, string>>({})
  const [tournamentDrafts, setTournamentDrafts] = useState<Record<number, string>>({})
  const [editingTournamentDay, setEditingTournamentDay] = useState<number | null>(null)
  const [editingTournamentValue, setEditingTournamentValue] = useState('')
  const [editingSelectionId, setEditingSelectionId] = useState<string | null>(null)
  const [editingSelectionValue, setEditingSelectionValue] = useState('')
  const [editingTrainingId, setEditingTrainingId] = useState<string | null>(null)
  const [editingTrainingValue, setEditingTrainingValue] = useState('')
  
  // Déterminer d'où on vient pour le retour
  const fromPage = searchParams.get('from')
  const fromDay = searchParams.get('day')
  const getBackUrl = () => {
    switch (fromPage) {
      case 'pending': return '/ballkids/pending'
    case 'teams': return '/schedule'
      case 'selection': return '/selection'
      case 'training': return '/training'
      case 'schedule': return fromDay ? `/schedule?day=${fromDay}` : '/schedule'
      default: return '/ballkids'
    }
  }

  const { data: ballkid, isLoading } = useQuery({
    queryKey: ['ballkid', id],
    queryFn: async () => {
      const res = await api.get(`/ballkids/${id}`)
      return res.data.data.ballkid
    },
  })

  const { data: tournamentDays = [] } = useQuery({
    queryKey: ['tournamentDays', ballkid?.tournamentId],
    queryFn: async () => {
      if (!ballkid?.tournamentId) return []
      const res = await api.get(`/schedule/${ballkid.tournamentId}`)
      return res.data.data.days || []
    },
    enabled: !!ballkid?.tournamentId,
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/ballkids/${id}`),
    onSuccess: () => {
      toast({ title: 'Ramasseur supprimé' })
      queryClient.invalidateQueries({ queryKey: ['ballkids'] })
      navigate(getBackUrl())
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la suppression' })
    },
  })

  const approveMutation = useMutation({
    mutationFn: () => api.post(`/ballkids/${id}/approve`),
    onSuccess: () => {
      toast({ title: 'Ramasseur validé' })
      queryClient.invalidateQueries({ queryKey: ['ballkids'] })
      navigate('/ballkids/pending')
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la validation' })
    },
  })

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingPhoto(true)
    try {
      const formData = new FormData()
      formData.append('photo', file)
      await api.post(`/ballkids/${id}/photo`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      toast({ title: 'Photo mise à jour' })
      queryClient.invalidateQueries({ queryKey: ['ballkid', id] })
    } catch {
      toast({ variant: 'destructive', title: 'Erreur lors de l\'upload de la photo' })
    } finally {
      setUploadingPhoto(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const rejectMutation = useMutation({
    mutationFn: () => api.post(`/ballkids/${id}/reject`),
    onSuccess: () => {
      toast({ title: 'Ramasseur refusé' })
      queryClient.invalidateQueries({ queryKey: ['ballkids'] })
      navigate('/ballkids/pending')
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors du refus' })
    },
  })

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.put(`/ballkids/${id}/status`, { status }),
    onSuccess: () => {
      toast({ title: 'Statut modifié' })
      queryClient.invalidateQueries({ queryKey: ['ballkid', id] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la modification' })
    },
  })

  const selectionScoreMutation = useMutation({
    mutationFn: ({ score, tournamentId, ballkidId }: { score: number; tournamentId: string; ballkidId: string }) =>
      api.post(`/selection/${tournamentId}/score-simple`, { ballkidId, score }),
    onSuccess: () => {
      toast({ title: 'Note de sélection enregistrée' })
      setSelectionInput('')
      queryClient.invalidateQueries({ queryKey: ['ballkid', id] })
      queryClient.invalidateQueries({ queryKey: ['selection', 'ranking'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de l\'enregistrement' })
    },
  })

  const updateSelectionScoreMutation = useMutation({
    mutationFn: ({ scoreId, score }: { scoreId: string; score: number }) =>
      api.put(`/selection/score/${scoreId}`, { score }),
    onSuccess: () => {
      toast({ title: 'Note de sélection mise à jour' })
      queryClient.invalidateQueries({ queryKey: ['ballkid', id] })
      queryClient.invalidateQueries({ queryKey: ['selection', 'ranking'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la mise à jour' })
    },
  })

  const deleteSelectionScoreMutation = useMutation({
    mutationFn: (scoreId: string) => api.delete(`/selection/score/${scoreId}`),
    onSuccess: () => {
      toast({ title: 'Note de sélection supprimée' })
      queryClient.invalidateQueries({ queryKey: ['ballkid', id] })
      queryClient.invalidateQueries({ queryKey: ['selection', 'ranking'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la suppression' })
    },
  })

  const trainingScoreMutation = useMutation({
    mutationFn: ({
      score,
      sessionNumber,
      tournamentId,
      ballkidId,
    }: {
      score: number;
      sessionNumber: number;
      tournamentId: string;
      ballkidId: string;
    }) =>
      api.post(`/training/${tournamentId}/${sessionNumber}/score-simple`, { ballkidId, score }),
    onSuccess: (_response, variables) => {
      toast({ title: 'Note de formation enregistrée' })
      setTrainingDrafts((prev) => ({
        ...prev,
        [variables.sessionNumber]: '',
      }))
      queryClient.invalidateQueries({ queryKey: ['ballkid', id] })
      queryClient.invalidateQueries({ queryKey: ['training', 'summary'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de l\'enregistrement' })
    },
  })

  const updateTrainingScoreMutation = useMutation({
    mutationFn: ({ scoreId, score }: { scoreId: string; score: number }) =>
      api.put(`/training/score/${scoreId}`, { score }),
    onSuccess: () => {
      toast({ title: 'Note de formation mise à jour' })
      queryClient.invalidateQueries({ queryKey: ['ballkid', id] })
      queryClient.invalidateQueries({ queryKey: ['training', 'summary'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la mise à jour' })
    },
  })

  const deleteTrainingScoreMutation = useMutation({
    mutationFn: (scoreId: string) => api.delete(`/training/score/${scoreId}`),
    onSuccess: () => {
      toast({ title: 'Note de formation supprimée' })
      queryClient.invalidateQueries({ queryKey: ['ballkid', id] })
      queryClient.invalidateQueries({ queryKey: ['training', 'summary'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la suppression' })
    },
  })

  const deleteTournamentScoreMutation = useMutation({
    mutationFn: ({
      dayNumber,
      tournamentId,
      ballkidId,
    }: {
      dayNumber: number;
      tournamentId: string;
      ballkidId: string;
    }) =>
      api.delete(`/schedule/${tournamentId}/day/${dayNumber}/score-simple/${ballkidId}`),
    onSuccess: () => {
      toast({ title: 'Note du jour supprimée' })
      queryClient.invalidateQueries({ queryKey: ['ballkid', id] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la suppression' })
    },
  })

  const tournamentScoreMutation = useMutation({
    mutationFn: ({
      score,
      dayNumber,
      tournamentId,
      ballkidId,
    }: {
      score: number;
      dayNumber: number;
      tournamentId: string;
      ballkidId: string;
    }) => api.post(`/schedule/${tournamentId}/day/${dayNumber}/score-simple`, { ballkidId, score }),
    onSuccess: (_response, variables) => {
      toast({ title: 'Note du jour enregistrée' })
      setTournamentDrafts((prev) => ({
        ...prev,
        [variables.dayNumber]: '',
      }))
      queryClient.invalidateQueries({ queryKey: ['ballkid', id] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de l\'enregistrement' })
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!ballkid) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Ramasseur non trouvé</p>
        <Link to="/ballkids">
          <Button variant="link">Retour à la liste</Button>
        </Link>
      </div>
    )
  }

  const age = new Date().getFullYear() - new Date(ballkid.birthDate).getFullYear()

  // Calculer les moyennes
  const selectionAvg = ballkid.selectionScores?.length > 0
    ? ballkid.selectionScores.reduce((sum: number, s: any) => sum + s.totalScore, 0) / ballkid.selectionScores.length
    : null

  const selectionScoreForUser = isAdmin && user
    ? ballkid.selectionScores?.find((s: any) => s.scorerId === user.id) || null
    : ballkid.selectionScores?.[0] || null
  const selectionHasScore = selectionScoreForUser?.totalScore != null

  const trainingAvg = ballkid.trainingScores?.length > 0
    ? ballkid.trainingScores.reduce((sum: number, s: any) => sum + s.totalScore, 0) / ballkid.trainingScores.length
    : null

  const trainingScoresBySession = new Map<number, any>()
  ballkid.trainingScores?.forEach((score: any) => {
    const sessionNumber = score.trainingSession?.sessionNumber
    if (!sessionNumber || trainingScoresBySession.has(sessionNumber)) return
    trainingScoresBySession.set(sessionNumber, score)
  })

  const tournamentScoresByDayNumber = new Map<number, number[]>()
  ballkid.tournamentScores?.forEach((score: any) => {
    const day = score.tournamentDay
    if (!day || score.totalScore == null) return
    const list = tournamentScoresByDayNumber.get(day.dayNumber) || []
    list.push(score.totalScore)
    tournamentScoresByDayNumber.set(day.dayNumber, list)
  })

  const tournamentNotes = (tournamentDays.length
    ? tournamentDays.map((day: any) => ({
        dayNumber: day.dayNumber,
        date: day.date,
        scores: tournamentScoresByDayNumber.get(day.dayNumber) || [],
      }))
    : (() => {
        const scores = ballkid.tournamentScores || []
        const grouped: Record<string, { dayNumber: number; date: string; scores: number[] }> = {}
        scores.forEach((s: any) => {
          const day = s.tournamentDay
          if (!day) return
          if (!grouped[day.id]) {
            grouped[day.id] = {
              dayNumber: day.dayNumber,
              date: day.date,
              scores: [],
            }
          }
          if (s.totalScore !== null && s.totalScore !== undefined) {
            grouped[day.id].scores.push(s.totalScore)
          }
        })
        return Object.values(grouped)
      })()
  ).sort((a: any, b: any) => a.dayNumber - b.dayNumber)

  // Moyenne tournoi = moyenne des moyennes par jour (comme l'endpoint liste GET /api/ballkids)
  const tournamentDayAverages = tournamentNotes
    .filter((d: any) => d.scores.length > 0)
    .map((d: any) => d.scores.reduce((a: number, b: number) => a + b, 0) / d.scores.length)
  const tournamentAvg = tournamentDayAverages.length > 0
    ? tournamentDayAverages.reduce((a: number, b: number) => a + b, 0) / tournamentDayAverages.length
    : null

  const handleSelectionSubmit = () => {
    const value = selectionInput.trim()
    if (!value) return
    const score = parseFloat(value.replace(',', '.'))
    if (!Number.isNaN(score) && score >= 0) {
      selectionScoreMutation.mutate({
        score,
        tournamentId: ballkid.tournamentId,
        ballkidId: ballkid.id,
      })
    } else {
      toast({ variant: 'destructive', title: 'Note invalide (nombre positif attendu)' })
    }
  }

  const handleTrainingSubmit = (sessionNumber: number, inputValue: string) => {
    const value = inputValue.trim()
    if (!value) return
    const score = parseFloat(value.replace(',', '.'))
    if (!Number.isNaN(score) && score >= 0) {
      trainingScoreMutation.mutate({
        score,
        sessionNumber,
        tournamentId: ballkid.tournamentId,
        ballkidId: ballkid.id,
      })
    } else {
      toast({ variant: 'destructive', title: 'Note invalide (nombre positif attendu)' })
    }
  }

  const handleUpdateSelectionScore = (scoreId: string, currentScore: number) => {
    const value = editingSelectionScores[scoreId]
    const raw = value !== undefined ? value : currentScore.toFixed(1)
    const score = parseFloat(raw.replace(',', '.'))
    if (!Number.isNaN(score) && score >= 0) {
      updateSelectionScoreMutation.mutate({ scoreId, score })
      setEditingSelectionScores((prev) => {
        const next = { ...prev }
        delete next[scoreId]
        return next
      })
    } else {
      toast({ variant: 'destructive', title: 'Note invalide (nombre positif attendu)' })
    }
  }

  const handleUpdateTrainingScore = (scoreId: string, currentScore: number) => {
    const value = editingTrainingScores[scoreId]
    const raw = value !== undefined ? value : currentScore.toFixed(1)
    const score = parseFloat(raw.replace(',', '.'))
    if (!Number.isNaN(score) && score >= 0) {
      updateTrainingScoreMutation.mutate({ scoreId, score })
      setEditingTrainingScores((prev) => {
        const next = { ...prev }
        delete next[scoreId]
        return next
      })
    } else {
      toast({ variant: 'destructive', title: 'Note invalide (nombre positif attendu)' })
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link to={getBackUrl()}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        
        <div className="flex-1 flex gap-6">
          {/* Photo */}
          <div className="flex-shrink-0 relative group">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handlePhotoUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="relative cursor-pointer rounded-xl overflow-hidden focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              title="Cliquer pour changer la photo"
            >
              {ballkid.photoUrl ? (
                <img 
                  src={ballkid.photoUrl} 
                  alt={`${ballkid.firstName} ${ballkid.lastName}`}
                  className="w-24 h-24 rounded-xl object-cover shadow-md"
                />
              ) : (
                <div className="w-24 h-24 rounded-xl bg-gray-200 flex items-center justify-center shadow-md">
                  <User className="w-10 h-10 text-gray-400" />
                </div>
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors rounded-xl flex items-center justify-center">
                <Camera className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              {uploadingPhoto && (
                <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </button>
          </div>

          {/* Nom et infos principales */}
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">
                {ballkid.lastName} {ballkid.firstName}
              </h1>
              {ballkid.isVeteran && (
                <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-full flex items-center gap-1">
                  <Award className="w-3 h-3" />
                  Ancien
                </span>
              )}
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  statusLabels[ballkid.status]?.color || 'bg-gray-100'
                }`}
              >
                {statusLabels[ballkid.status]?.label || ballkid.status}
              </span>
            </div>
            <p className="text-muted-foreground mt-1">
              {ballkid.gender === 'MALE' ? 'Garçon' : 'Fille'} • {age} ans • 
              Né(e) le {new Date(ballkid.birthDate).toLocaleDateString('fr-FR')}
            </p>
            {ballkid.club && (
              <p className="text-sm text-muted-foreground mt-1">
                Club : <span className="font-medium text-foreground">{ballkid.club}</span>
                {ballkid.licenseNumber && (
                  <> • Licence : <span className="font-medium text-foreground">{ballkid.licenseNumber}</span></>
                )}
              </p>
            )}
          </div>
        </div>

        {isAdmin && (
          <Link to={`/ballkids/${id}/edit${fromPage ? `?from=${fromPage}` : ''}`}>
            <Button variant="outline">
              <Pencil className="w-4 h-4 mr-2" />
              Modifier
            </Button>
          </Link>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Contact */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="w-5 h-5" />
              Contact
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Email</p>
              <p className="font-medium flex items-center gap-2">
                <Mail className="w-4 h-4 text-muted-foreground" />
                {ballkid.email}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Téléphone</p>
              <p className="font-medium">
                {ballkid.phone || <span className="text-muted-foreground italic">Non renseigné</span>}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2 border-t">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Tél. Père</p>
                <p className="font-medium text-sm">
                  {ballkid.phoneFather || <span className="text-muted-foreground italic">-</span>}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Tél. Mère</p>
                <p className="font-medium text-sm">
                  {ballkid.phoneMother || <span className="text-muted-foreground italic">-</span>}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Adresse */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              Adresse
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ballkid.address ? (
              <>
                <p className="font-medium">{ballkid.address}</p>
                <p className="text-muted-foreground">
                  {ballkid.postalCode} {ballkid.city}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground italic">Adresse non renseignée</p>
            )}
          </CardContent>
        </Card>

        {/* Équipement */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shirt className="w-5 h-5" />
              Équipement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">T-shirt</p>
                <p className="font-medium">{ballkid.tshirtSize || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Short</p>
                <p className="font-medium">{ballkid.shortSize || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Survêtement</p>
                <p className="font-medium">{ballkid.tracksuitSize || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Pointure</p>
                <p className="font-medium">{ballkid.shoeSize || '-'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notes - Sélection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-600">
              <Star className="w-5 h-5" />
              Notes Sélection
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isAdmin || ballkid.selectionScores?.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Total points</span>
                  <span className="text-2xl font-bold text-orange-600">
                    {selectionAvg != null ? `${Number.isInteger(selectionAvg) ? selectionAvg : selectionAvg.toFixed(1)} pts` : '-'}
                  </span>
                </div>
                <div className="space-y-2 pt-2 border-t">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">Note</span>
                    <div className="flex items-center gap-2">
                      {!isAdmin && (
                        <span className="font-medium">
                          {selectionScoreForUser ? selectionScoreForUser.totalScore.toFixed(1) : '-'}
                        </span>
                      )}
                      {isAdmin && selectionScoreForUser && selectionHasScore && (
                        <>
                          {editingSelectionId === selectionScoreForUser.id ? (
                            <Input
                              type="text"
                              inputMode="decimal"
                              value={editingSelectionValue}
                              onChange={(e) => setEditingSelectionValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  const raw = editingSelectionValue.trim()
                                  const score = parseFloat(raw.replace(',', '.'))
                                  if (!Number.isNaN(score) && score >= 0) {
                                    updateSelectionScoreMutation.mutate({
                                      scoreId: selectionScoreForUser.id,
                                      score,
                                    })
                                    setEditingSelectionId(null)
                                  } else if (raw) {
                                    toast({ variant: 'destructive', title: 'Note invalide (nombre positif attendu)' })
                                  }
                                } else if (e.key === 'Escape') {
                                  setEditingSelectionId(null)
                                }
                              }}
                              onBlur={() => setEditingSelectionId(null)}
                              className="w-20 text-center"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSelectionId(selectionScoreForUser.id)
                                setEditingSelectionValue(selectionScoreForUser.totalScore.toFixed(1))
                              }}
                              className="font-medium text-blue-600 hover:underline"
                            >
                              {selectionScoreForUser.totalScore.toFixed(1)}
                            </button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (confirm('Supprimer cette note ?')) {
                                deleteSelectionScoreMutation.mutate(selectionScoreForUser.id)
                              }
                            }}
                            disabled={deleteSelectionScoreMutation.isPending}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      {isAdmin && (!selectionScoreForUser || !selectionHasScore) && (
                        <>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="Points"
                            value={selectionInput}
                            onChange={(e) => setSelectionInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                handleSelectionSubmit()
                              }
                            }}
                            className="w-20 text-center"
                          />
                          <Button
                            size="sm"
                            onClick={handleSelectionSubmit}
                            disabled={!selectionInput || selectionScoreMutation.isPending}
                          >
                            <Save className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground italic text-center py-4">
                Pas encore évalué
              </p>
            )}
          </CardContent>
        </Card>

        {/* Notes - Formation */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-blue-600">
              <Calendar className="w-5 h-5" />
              Notes Formation
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isAdmin || ballkid.trainingScores?.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Moyenne</span>
                  <span className="text-2xl font-bold text-blue-600">
                    {trainingAvg != null ? `${Number.isInteger(trainingAvg) ? trainingAvg : trainingAvg.toFixed(1)} pts` : '-'}
                  </span>
                </div>
                <div className="space-y-2 pt-2 border-t max-h-32 overflow-y-auto">
                  {[1, 2, 3, 4].map((sessionNumber) => {
                    const score = trainingScoresBySession.get(sessionNumber)
                    const hasScore = score?.totalScore != null
                    const draftValue = trainingDrafts[sessionNumber] ?? ''
                    return (
                      <div key={sessionNumber} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">Séance {sessionNumber}</span>
                        <div className="flex items-center gap-2">
                          {!isAdmin && (
                            <span className="font-medium">
                              {score ? score.totalScore.toFixed(1) : '-'}
                            </span>
                          )}
                          {isAdmin && score && hasScore && (
                            <>
                              {editingTrainingId === score.id ? (
                                <Input
                                  type="text"
                                  inputMode="decimal"
                                  value={editingTrainingValue}
                                  onChange={(e) => setEditingTrainingValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      const raw = editingTrainingValue.trim()
                                      const nextScore = parseFloat(raw.replace(',', '.'))
                                      if (!Number.isNaN(nextScore) && nextScore >= 0) {
                                        updateTrainingScoreMutation.mutate({
                                          scoreId: score.id,
                                          score: nextScore,
                                        })
                                        setEditingTrainingId(null)
                                      } else if (raw) {
                                        toast({ variant: 'destructive', title: 'Note invalide (nombre positif attendu)' })
                                      }
                                    } else if (e.key === 'Escape') {
                                      setEditingTrainingId(null)
                                    }
                                  }}
                                  onBlur={() => setEditingTrainingId(null)}
                                  className="w-20 text-center"
                                />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTrainingId(score.id)
                                    setEditingTrainingValue(score.totalScore.toFixed(1))
                                  }}
                                  className="font-medium text-blue-600 hover:underline"
                                >
                                  {score.totalScore.toFixed(1)}
                                </button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  if (confirm('Supprimer cette note ?')) {
                                    deleteTrainingScoreMutation.mutate(score.id)
                                  }
                                }}
                                disabled={deleteTrainingScoreMutation.isPending}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                          {isAdmin && (!score || !hasScore) && (
                            <>
                              <Input
                                type="text"
                                inputMode="decimal"
                                placeholder="Points"
                                value={draftValue}
                                onChange={(e) =>
                                  setTrainingDrafts((prev) => ({
                                    ...prev,
                                    [sessionNumber]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    handleTrainingSubmit(sessionNumber, draftValue)
                                  }
                                }}
                                className="w-20 text-center"
                              />
                              <Button
                                size="sm"
                                onClick={() => handleTrainingSubmit(sessionNumber, draftValue)}
                                disabled={!draftValue || trainingScoreMutation.isPending}
                              >
                                <Save className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground italic text-center py-4">
                Pas encore de note de formation
              </p>
            )}
          </CardContent>
        </Card>

        {/* Notes - Tournoi */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <Users className="w-5 h-5" />
              Notes Tournoi
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(isAdmin || tournamentNotes.length > 0) ? (
              tournamentNotes.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Moyenne</span>
                    <span className="text-2xl font-bold text-green-600">
                      {tournamentAvg != null ? `${Number.isInteger(tournamentAvg) ? tournamentAvg : tournamentAvg.toFixed(1)} pts` : '-'}
                    </span>
                  </div>
                  <div className="space-y-2 pt-2 border-t">
                  {tournamentNotes.map((day: any) => {
                    const avg = day.scores.length
                      ? day.scores.reduce((a: number, b: number) => a + b, 0) / day.scores.length
                      : null
                    const draftValue = tournamentDrafts[day.dayNumber] ?? ''
                    return (
                      <div key={day.dayNumber} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          Jour {day.dayNumber} ({new Date(day.date).toLocaleDateString('fr-FR')})
                        </span>
                        <div className="flex items-center gap-2">
                          {!isAdmin && (
                            <span className="font-medium">
                              {avg !== null ? avg.toFixed(1) : '-'}
                            </span>
                          )}
                          {isAdmin && avg !== null && (
                            <>
                              {editingTournamentDay === day.dayNumber ? (
                                <Input
                                  type="text"
                                  inputMode="decimal"
                                  value={editingTournamentValue}
                                  onChange={(e) => setEditingTournamentValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      const raw = editingTournamentValue.trim()
                                      const score = parseFloat(raw.replace(',', '.'))
                                      if (!Number.isNaN(score) && score >= 0) {
                                        tournamentScoreMutation.mutate({
                                          score,
                                          dayNumber: day.dayNumber,
                                          tournamentId: ballkid.tournamentId,
                                          ballkidId: ballkid.id,
                                        })
                                        setEditingTournamentDay(null)
                                      } else if (raw) {
                                        toast({ variant: 'destructive', title: 'Note invalide (nombre positif attendu)' })
                                      }
                                    } else if (e.key === 'Escape') {
                                      setEditingTournamentDay(null)
                                    }
                                  }}
                                  onBlur={() => setEditingTournamentDay(null)}
                                  className="w-20 text-center"
                                />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingTournamentDay(day.dayNumber)
                                    setEditingTournamentValue(avg.toFixed(1))
                                  }}
                                  className="font-medium text-blue-600 hover:underline"
                                >
                                  {avg.toFixed(1)}
                                </button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-red-500 hover:text-red-600"
                                disabled={deleteTournamentScoreMutation.isPending}
                                onClick={() => {
                                  if (window.confirm('Supprimer la note du jour ?')) {
                                    deleteTournamentScoreMutation.mutate({
                                      dayNumber: day.dayNumber,
                                      tournamentId: ballkid.tournamentId,
                                      ballkidId: ballkid.id,
                                    })
                                  }
                                }}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                          {isAdmin && avg === null && (
                            <>
                              <Input
                                type="text"
                                inputMode="decimal"
                                placeholder="Points"
                                value={draftValue}
                                onChange={(e) =>
                                  setTournamentDrafts((prev) => ({
                                    ...prev,
                                    [day.dayNumber]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    const raw = draftValue.trim()
                                    const score = parseFloat(raw.replace(',', '.'))
                                    if (!Number.isNaN(score) && score >= 0) {
                                      tournamentScoreMutation.mutate({
                                        score,
                                        dayNumber: day.dayNumber,
                                        tournamentId: ballkid.tournamentId,
                                        ballkidId: ballkid.id,
                                      })
                                    } else if (raw) {
                                      toast({ variant: 'destructive', title: 'Note invalide (nombre positif attendu)' })
                                    }
                                  }
                                }}
                                className="w-20 text-center"
                              />
                              <Button
                                size="sm"
                                onClick={() => {
                                  const raw = draftValue.trim()
                                  const score = parseFloat(raw.replace(',', '.'))
                                  if (!Number.isNaN(score) && score >= 0) {
                                    tournamentScoreMutation.mutate({
                                      score,
                                      dayNumber: day.dayNumber,
                                      tournamentId: ballkid.tournamentId,
                                      ballkidId: ballkid.id,
                                    })
                                  } else if (raw) {
                                    toast({ variant: 'destructive', title: 'Note invalide (nombre positif attendu)' })
                                  }
                                }}
                                disabled={!draftValue || tournamentScoreMutation.isPending}
                              >
                                <Save className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground italic text-center py-4">
                  Aucun jour de tournoi
                </p>
              )
            ) : (
              <p className="text-muted-foreground italic text-center py-4">
                Pas encore de note de tournoi
              </p>
            )}
          </CardContent>
        </Card>

        {/* Équipe */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Équipe
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ballkid.teamAssignments?.length > 0 ? (
              <div className="space-y-2">
                {ballkid.teamAssignments
                  .filter((a: any) => !a.tournamentDayId)
                  .filter((a: any, index: number, self: any[]) => 
                    index === self.findIndex((t) => t.teamId === a.teamId)
                  )
                  .map((assignment: any) => (
                    <div key={assignment.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <span className="font-medium">{assignment.team.name}</span>
                      {assignment.isReserve && (
                        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">
                          Remplaçant
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-muted-foreground italic text-center py-4">
                Pas encore assigné à une équipe
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Actions pour ramasseur en attente */}
      {isAdmin && fromPage === 'pending' && ballkid.status === 'PENDING' && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="text-orange-700">Valider cette inscription</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Ce ramasseur est en attente de validation. Vous pouvez l'accepter ou le refuser.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending}
                className="flex-1"
              >
                <X className="w-4 h-4 mr-2" />
                Refuser
              </Button>
              <Button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
                className="flex-1"
              >
                <Check className="w-4 h-4 mr-2" />
                Valider
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions admin */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Actions administrateur</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2">Changer le statut</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(statusLabels).map(([status, { label }]) => (
                  <Button
                    key={status}
                    variant={ballkid.status === status ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => statusMutation.mutate(status)}
                    disabled={statusMutation.isPending}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="pt-4 border-t">
              <Button
                variant="destructive"
                onClick={() => {
                  if (confirm('Supprimer ce ramasseur ?')) {
                    deleteMutation.mutate()
                  }
                }}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Supprimer
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
