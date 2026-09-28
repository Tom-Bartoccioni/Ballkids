import { useRef, useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { 
  GraduationCap, CheckCircle, Clock, Save, Search,
  ArrowUpDown, ArrowUp, ArrowDown, Upload, Download, Users, UserX, Settings, X, Pencil, Star, User
} from 'lucide-react'

type SortKey = 'lastName' | 'firstName' | 'session1' | 'session2' | 'session3' | 'session4' | 'average' | 'sessionsAttended'
type SortOrder = 'asc' | 'desc'

export default function TrainingPage() {
  const { isAdmin } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeSession, setActiveSession] = useState(1)
  const [search, setSearch] = useState('')
  const [scores, setScores] = useState<Record<string, string>>({})
  const [editingTrainingId, setEditingTrainingId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('lastName')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [showCriteriaModal, setShowCriteriaModal] = useState(false)
  const [criteriaDraft, setCriteriaDraft] = useState<Array<{ name: string; maxScore: number; weight: number }>>([])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortOrder(key === 'average' || key.startsWith('session') ? 'desc' : 'asc')
    }
  }

  const SortHeader = ({ column, label, className = '' }: { column: SortKey, label: string, className?: string }) => (
    <th 
      className={`p-4 font-medium cursor-pointer hover:bg-gray-100 select-none ${className}`}
      onClick={() => handleSort(column)}
    >
      <div className="flex items-center justify-center gap-1">
        {label}
        {sortKey === column ? (
          sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ArrowUpDown className="w-3 h-3 text-gray-400" />
        )}
      </div>
    </th>
  )

  const { data: tournament } = useQuery({
    queryKey: ['tournament', 'active'],
    queryFn: async () => {
      const res = await api.get('/tournaments/active')
      return res.data.data.tournament
    },
  })

  const { data: summaryData, isLoading } = useQuery({
    queryKey: ['training', 'summary', tournament?.id],
    queryFn: async () => {
      if (!tournament?.id) return null
      const res = await api.get(`/training/${tournament.id}/summary/all`)
      return res.data.data
    },
    enabled: !!tournament?.id,
  })

  const { data: trainingSessionsData } = useQuery({
    queryKey: ['training', 'sessions', tournament?.id],
    queryFn: async () => {
      if (!tournament?.id) return null
      const res = await api.get(`/training/${tournament.id}`)
      return res.data.data.sessions
    },
    enabled: !!tournament?.id,
  })

  // Get criteria from the first session (criteria are shared across sessions)
  const currentSession = trainingSessionsData?.find((s: any) => s.sessionNumber === activeSession)
  const trainingCriteria = currentSession?.criteria || []
  const hasCriteria = trainingCriteria.length > 0

  const scoreMutation = useMutation({
    mutationFn: ({ ballkidId, score, sessionNumber }: { ballkidId: string, score: number, sessionNumber: number }) => 
      api.post(`/training/${tournament?.id}/${sessionNumber}/score-simple`, { ballkidId, score }),
    onSuccess: (_, variables) => {
      toast({ title: 'Note enregistrée' })
      setScores(prev => {
        const newScores = { ...prev }
        delete newScores[`${variables.ballkidId}-${variables.sessionNumber}`]
        return newScores
      })
      setEditingTrainingId(null)
      queryClient.invalidateQueries({ queryKey: ['training', 'summary'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de l\'enregistrement' })
    },
  })

  const addAbsenceMutation = useMutation({
    mutationFn: ({ ballkidId, sessionNumber }: { ballkidId: string, sessionNumber: number }) => 
      api.post(`/training/${tournament?.id}/${sessionNumber}/absence`, { ballkidId }),
    onSuccess: () => {
      toast({ title: 'Absence enregistrée' })
      queryClient.invalidateQueries({ queryKey: ['training', 'summary'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de l\'enregistrement de l\'absence' })
    },
  })

  const removeAbsenceMutation = useMutation({
    mutationFn: ({ ballkidId, sessionNumber }: { ballkidId: string, sessionNumber: number }) => 
      api.delete(`/training/${tournament?.id}/${sessionNumber}/absence/${ballkidId}`),
    onSuccess: () => {
      toast({ title: 'Absence retirée' })
      queryClient.invalidateQueries({ queryKey: ['training', 'summary'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la suppression de l\'absence' })
    },
  })

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      const res = await api.post(`/training/${tournament?.id}/${activeSession}/import-csv`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return res.data.data
    },
    onSuccess: (data) => {
      const errorCount = data.errors || 0
      toast({
        title: 'Import terminé',
        description: `${data.imported} note(s) importée(s), ${errorCount} erreur(s)`,
      })
      queryClient.invalidateQueries({ queryKey: ['training', 'summary'] })
    },
    onError: (err: any) => {
      toast({
        variant: 'destructive',
        title: 'Erreur lors de l\'import',
        description: err.response?.data?.message || 'Import CSV échoué',
      })
    },
  })

  const updateCriteriaMutation = useMutation({
    mutationFn: async (criteria: Array<{ name: string; maxScore: number; weight: number }>) => {
      const res = await api.put(`/training/${tournament?.id}/criteria`, { criteria })
      return res.data.data
    },
    onSuccess: () => {
      toast({ title: 'Critères mis à jour' })
      queryClient.invalidateQueries({ queryKey: ['training', 'sessions'] })
      setShowCriteriaModal(false)
    },
    onError: (err: any) => {
      toast({
        variant: 'destructive',
        title: 'Erreur',
        description: err.response?.data?.message || 'Mise à jour impossible',
      })
    },
  })

  const handleOpenCriteria = () => {
    const session = trainingSessionsData?.find((s: any) => s.sessionNumber === activeSession)
    const existing = session?.criteria || []
    if (existing.length > 0) {
      setCriteriaDraft(
        existing.map((c: any) => ({
          name: c.name,
          maxScore: c.maxScore ?? 5,
          weight: c.weight ?? 1,
        }))
      )
    } else {
      setCriteriaDraft([
        { name: 'Vitesse', maxScore: 5, weight: 1 },
        { name: 'Précision', maxScore: 5, weight: 1 },
        { name: 'Réflexes', maxScore: 5, weight: 1 },
        { name: 'Concentration', maxScore: 5, weight: 1 },
      ])
    }
    setShowCriteriaModal(true)
  }

  const handleSaveCriteria = () => {
    updateCriteriaMutation.mutate(criteriaDraft)
  }

  const handleImportClick = () => {
    importInputRef.current?.click()
  }

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    importMutation.mutate(file)
    event.target.value = ''
  }

  const sessions = tournament?.trainingSessions || []
  const summary = summaryData?.summary || []

  const totalSelected = summary.length
  const { ratedCount, absentCount, pendingCount } = useMemo(() => {
    if (activeSession > 0) {
      const scoreKey = `session${activeSession}` as keyof (typeof summary)[number]
      const absentKey = `absent${activeSession}` as keyof (typeof summary)[number]
      const rated = summary.filter((item: any) => item[scoreKey] !== null && item[scoreKey] !== undefined).length
      const absent = summary.filter((item: any) => item[absentKey] === true && item[scoreKey] === null).length
      return { ratedCount: rated, absentCount: absent, pendingCount: totalSelected - rated - absent }
    }
    const rated = summary.filter((item: any) => item.sessionsAttended > 0).length
    return { ratedCount: rated, absentCount: 0, pendingCount: totalSelected - rated }
  }, [summary, activeSession, totalSelected])

  // Filtrer et trier
  const filteredSummary = useMemo(() => {
    let result = summary.filter((item: any) => {
      if (!search) return true
      const searchLower = search.toLowerCase()
      return item.lastName.toLowerCase().includes(searchLower) ||
             item.firstName.toLowerCase().includes(searchLower)
    })

    return result.sort((a: any, b: any) => {
      let aVal: any, bVal: any
      
      switch (sortKey) {
        case 'lastName':
          aVal = a.lastName?.toLowerCase() || ''
          bVal = b.lastName?.toLowerCase() || ''
          break
        case 'firstName':
          aVal = a.firstName?.toLowerCase() || ''
          bVal = b.firstName?.toLowerCase() || ''
          break
        case 'session1':
        case 'session2':
        case 'session3':
        case 'session4':
          aVal = a[sortKey] ?? -1
          bVal = b[sortKey] ?? -1
          break
        case 'average':
          aVal = a.average ?? -1
          bVal = b.average ?? -1
          break
        case 'sessionsAttended':
          aVal = a.sessionsAttended ?? 0
          bVal = b.sessionsAttended ?? 0
          break
        default:
          return 0
      }
      
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1
      return 0
    })
  }, [summary, search, sortKey, sortOrder])

  const handleScoreChange = (ballkidId: string, sessionNumber: number, value: string) => {
    if (value === '' || (/^\d*\.?\d*$/.test(value) && parseFloat(value) <= 20)) {
      setScores(prev => ({ ...prev, [`${ballkidId}-${sessionNumber}`]: value }))
    }
  }

  const handleScoreSubmit = (ballkidId: string, sessionNumber: number) => {
    const scoreValue = scores[`${ballkidId}-${sessionNumber}`]
    if (scoreValue && !isNaN(parseFloat(scoreValue))) {
      const score = parseFloat(scoreValue)
      if (score >= 0 && score <= 20) {
        scoreMutation.mutate({ ballkidId, score, sessionNumber })
      }
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent, ballkidId: string, sessionNumber: number) => {
    if (e.key === 'Enter') {
      handleScoreSubmit(ballkidId, sessionNumber)
    }
  }

  // Export de la synthese (demande admin) : meme mecanique que l'export ramasseurs
  const handleExportTraining = async (format: 'xlsx' | 'csv') => {
    if (!tournament?.id) return
    try {
      const res = await api.get(`/export/training/${format}`, { params: { tournamentId: tournament.id }, responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const link = document.createElement('a')
      link.href = url
      link.download = `formation.${format}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err: any) {
      toast({ variant: 'destructive', title: "Erreur lors de l'export", description: err.response?.data?.message || err.message })
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GraduationCap className="w-6 h-6 text-emerald-700" />
          Séances de formation
        </h1>
        <p className="text-muted-foreground">
          4 séances de formation pour les 80 ramasseurs sélectionnés
        </p>
      </div>

      {/* Sessions tabs */}
      <div className="flex gap-2 flex-wrap">
        {[1, 2, 3, 4].map((num) => {
          const session = sessions.find((s: any) => s.sessionNumber === num)
          return (
            <Button
              key={num}
              variant={activeSession === num ? 'default' : 'outline'}
              onClick={() => setActiveSession(num)}
              className="gap-2"
            >
              {session?.isCompleted ? (
                <CheckCircle className="w-4 h-4 text-emerald-600" />
              ) : (
                <Clock className="w-4 h-4" />
              )}
              Séance {num}
            </Button>
          )
        })}
        <Button
          variant={activeSession === 0 ? 'default' : 'outline'}
          onClick={() => setActiveSession(0)}
        >
          Synthèse
        </Button>
      </div>

      {/* Recherche */}
      <div className="relative w-full sm:w-64">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input
          placeholder="Rechercher un ramasseur..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>
      {isAdmin && (
        <p className="text-xs text-muted-foreground">
          Import CSV: colonnes acceptées `email` ou `prenom` + `nom` (ou `nom` seul), et `total` (ou `note`/`score`), valeur 0-20.
        </p>
      )}

      {/* Résumé */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-emerald-100 rounded-lg">
                <Users className="w-6 h-6 text-emerald-700" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{totalSelected}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-emerald-100 rounded-lg">
                <CheckCircle className="w-6 h-6 text-emerald-700" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Notés</p>
                <p className="text-2xl font-bold">{ratedCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-red-100 rounded-lg">
                <UserX className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Absents</p>
                <p className="text-2xl font-bold">{absentCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-amber-100 rounded-lg">
                <Clock className="w-6 h-6 text-amber-800" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">En attente</p>
                <p className="text-2xl font-bold">{pendingCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary view */}
      {activeSession === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Synthèse des 4 séances</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => handleExportTraining('xlsx')} disabled={!tournament?.id}>
                  <Download className="w-4 h-4 mr-2" />
                  Excel
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleExportTraining('csv')} disabled={!tournament?.id}>
                  <Download className="w-4 h-4 mr-2" />
                  CSV
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th 
                      className="text-left p-4 font-medium cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('lastName')}
                    >
                      <div className="flex items-center gap-1">
                        Nom
                        {sortKey === 'lastName' ? (
                          sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ArrowUpDown className="w-3 h-3 text-gray-400" />
                        )}
                      </div>
                    </th>
                    <SortHeader column="session1" label="S1" className="text-center" />
                    <SortHeader column="session2" label="S2" className="text-center" />
                    <SortHeader column="session3" label="S3" className="text-center" />
                    <SortHeader column="session4" label="S4" className="text-center" />
                    <SortHeader column="average" label="Moyenne" className="text-center" />
                    <SortHeader column="sessionsAttended" label="Présences" className="text-center" />
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground">
                        Chargement...
                      </td>
                    </tr>
                  ) : filteredSummary.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground">
                        Aucune donnée disponible
                      </td>
                    </tr>
                  ) : (
                    filteredSummary.map((item: any) => (
                      <tr key={item.id} className="border-b hover:bg-gray-50">
                        <td className="p-4">
                          <Link 
                            to={`/ballkids/${item.id}?from=training`}
                            className="flex items-center gap-3 font-medium hover:text-primary hover:underline"
                          >
                            {item.photoUrl ? (
                              <img src={item.photoUrl} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                                <User className="w-4 h-4 text-gray-400" />
                              </div>
                            )}
                            {item.lastName} {item.firstName}
                          </Link>
                        </td>
                        <td className="p-4 text-center font-mono">
                          {item.session1?.toFixed(1) || '-'}
                        </td>
                        <td className="p-4 text-center font-mono">
                          {item.session2?.toFixed(1) || '-'}
                        </td>
                        <td className="p-4 text-center font-mono">
                          {item.session3?.toFixed(1) || '-'}
                        </td>
                        <td className="p-4 text-center font-mono">
                          {item.session4?.toFixed(1) || '-'}
                        </td>
                        <td className="p-4 text-center">
                          <span className="font-bold text-primary">
                            {item.average?.toFixed(1) || '-'}
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <span
                            className={`px-2 py-1 rounded text-xs ${
                              item.sessionsAttended === 4
                                ? 'bg-emerald-100 text-emerald-800'
                                : item.sessionsAttended >= 2
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {item.sessionsAttended}/4
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Individual session view */}
      {activeSession > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Séance {activeSession}</span>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <>
                    <input
                      ref={importInputRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      className="hidden"
                      onChange={handleImportFile}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleImportClick}
                      disabled={importMutation.isPending || !tournament?.id}
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {importMutation.isPending ? 'Import...' : 'Importer'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleOpenCriteria}>
                      <Settings className="w-4 h-4 mr-2" />
                      Critères
                    </Button>
                  </>
                )}
                {sessions.find((s: any) => s.sessionNumber === activeSession)?.isCompleted && (
                  <span className="text-sm font-normal text-emerald-700 flex items-center gap-1">
                    <CheckCircle className="w-4 h-4" />
                    Terminée
                  </span>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th 
                      className="text-left p-4 font-medium cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('lastName')}
                    >
                      <div className="flex items-center gap-1">
                        Nom
                        {sortKey === 'lastName' ? (
                          sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ArrowUpDown className="w-3 h-3 text-gray-400" />
                        )}
                      </div>
                    </th>
                    <th className="text-center p-4 font-medium">Note</th>
                    <th className="text-center p-4 font-medium">Présent</th>
                    {hasCriteria && <th className="text-center p-4 font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={hasCriteria ? 4 : 3} className="p-8 text-center text-muted-foreground">
                        Chargement...
                      </td>
                    </tr>
                  ) : filteredSummary.length === 0 ? (
                    <tr>
                      <td colSpan={hasCriteria ? 4 : 3} className="p-8 text-center text-muted-foreground">
                        Aucun ramasseur sélectionné
                      </td>
                    </tr>
                  ) : (
                    filteredSummary.map((item: any) => {
                      const sessionKey = `session${activeSession}` as keyof typeof item
                      const currentScore = item[sessionKey]
                      const inputKey = `${item.id}-${activeSession}`
                      
                      return (
                        <tr key={item.id} className="border-b hover:bg-gray-50">
                          <td className="p-4">
                            <Link 
                              to={`/ballkids/${item.id}?from=training`}
                              className="flex items-center gap-3 font-medium hover:text-primary hover:underline"
                            >
                              {item.photoUrl ? (
                                <img src={item.photoUrl} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                                  <User className="w-4 h-4 text-gray-400" />
                                </div>
                              )}
                              {item.lastName} {item.firstName}
                            </Link>
                          </td>
                          <td className="p-4 text-center">
                            <div className="inline-flex items-center justify-center w-40 min-h-[2.25rem]">
                              {!isAdmin ? (
                                currentScore !== null ? (
                                  <span className="font-mono text-lg font-semibold">
                                    {currentScore.toFixed(1)}
                                    <span className="text-muted-foreground text-sm">/20</span>
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )
                              ) : currentScore !== null && editingTrainingId !== inputKey ? (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-2 font-mono text-lg font-semibold text-emerald-700 hover:text-emerald-800"
                                  onClick={() => {
                                    setScores((prev) => ({ ...prev, [inputKey]: currentScore.toFixed(1) }))
                                    setEditingTrainingId(inputKey)
                                  }}
                                  title="Cliquer pour modifier"
                                >
                                  {currentScore.toFixed(1)}
                                  <Pencil className="w-4 h-4 text-muted-foreground" />
                                </button>
                              ) : (
                                <div className="flex items-center justify-center gap-2">
                                  <Input
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="0-20"
                                    value={scores[inputKey] || ''}
                                    onChange={(e) => handleScoreChange(item.id, activeSession, e.target.value)}
                                    onKeyPress={(e) => handleKeyPress(e, item.id, activeSession)}
                                    className="w-20 text-center"
                                  />
                                  <Button
                                    size="sm"
                                    onClick={() => handleScoreSubmit(item.id, activeSession)}
                                    disabled={!scores[inputKey] || scoreMutation.isPending}
                                  >
                                    <Save className="w-4 h-4" />
                                  </Button>
                                  {currentScore !== null && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => {
                                        setEditingTrainingId(null)
                                        setScores((prev) => {
                                          const next = { ...prev }
                                          delete next[inputKey]
                                          return next
                                        })
                                      }}
                                      className="h-9 w-9 p-0"
                                      title="Annuler"
                                    >
                                      <X className="w-4 h-4" />
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="p-4 text-center">
                            {currentScore !== null ? (
                              <CheckCircle className="w-5 h-5 text-emerald-600 mx-auto" />
                            ) : isAdmin ? (
                              <button
                                onClick={() => {
                                  const absentKey = `absent${activeSession}` as keyof typeof item
                                  const isAbsent = item[absentKey]
                                  if (isAbsent) {
                                    removeAbsenceMutation.mutate({ ballkidId: item.id, sessionNumber: activeSession })
                                  } else {
                                    addAbsenceMutation.mutate({ ballkidId: item.id, sessionNumber: activeSession })
                                  }
                                }}
                                disabled={addAbsenceMutation.isPending || removeAbsenceMutation.isPending}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
                                  item[`absent${activeSession}` as keyof typeof item]
                                    ? 'bg-red-100 text-red-700 hover:bg-red-200 shadow-sm'
                                    : 'bg-gray-100 text-gray-500 hover:bg-amber-100 hover:text-amber-800'
                                } disabled:opacity-50`}
                                title={item[`absent${activeSession}` as keyof typeof item] ? 'Cliquez pour retirer l\'absence' : 'Cliquez pour marquer absent'}
                              >
                                <UserX className="w-3.5 h-3.5" />
                                {item[`absent${activeSession}` as keyof typeof item] ? 'Absent' : 'Absent'}
                              </button>
                            ) : item[`absent${activeSession}` as keyof typeof item] ? (
                              <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-red-100 text-red-700 font-medium">
                                <UserX className="w-3.5 h-3.5" />
                                Absent
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          {hasCriteria && (
                            <td className="p-4 text-center">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => navigate(`/training/score/${activeSession}/${item.id}`)}
                              >
                                <Star className="w-4 h-4 mr-1" />
                                Noter
                              </Button>
                            </td>
                          )}
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {showCriteriaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-lg mx-auto flex max-h-[90vh] flex-col">
            <CardHeader className="flex-shrink-0">
              <CardTitle className="flex items-center justify-between">
                <span>Configurer les critères</span>
                <button
                  onClick={() => setShowCriteriaModal(false)}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 overflow-y-auto">
              <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground px-1">
                <span className="col-span-6">Nom du critère</span>
                <span className="col-span-3 text-center">Max</span>
                <span className="col-span-2 text-center">Poids</span>
                <span className="col-span-1 text-center">Suppr.</span>
              </div>
              {criteriaDraft.map((criteria, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-center">
                  <Input
                    className="col-span-6"
                    placeholder="Nom du critère"
                    value={criteria.name}
                    onChange={(e) => {
                      const next = [...criteriaDraft]
                      next[index] = { ...criteria, name: e.target.value }
                      setCriteriaDraft(next)
                    }}
                  />
                  <Input
                    className="col-span-3 text-center"
                    type="number"
                    min="1"
                    max="20"
                    value={criteria.maxScore}
                    onChange={(e) => {
                      const next = [...criteriaDraft]
                      next[index] = { ...criteria, maxScore: parseFloat(e.target.value) || 0 }
                      setCriteriaDraft(next)
                    }}
                  />
                  <Input
                    className="col-span-2 text-center"
                    type="number"
                    min="0"
                    step="0.1"
                    value={criteria.weight}
                    onChange={(e) => {
                      const next = [...criteriaDraft]
                      next[index] = { ...criteria, weight: parseFloat(e.target.value) || 0 }
                      setCriteriaDraft(next)
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="col-span-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={() => setCriteriaDraft(criteriaDraft.filter((_, i) => i !== index))}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
            <div className="flex-shrink-0 border-t bg-white p-4 rounded-b-lg">
              <div className="flex justify-between">
                <Button
                  variant="outline"
                  onClick={() => setCriteriaDraft([...criteriaDraft, { name: '', maxScore: 5, weight: 1 }])}
                >
                  Ajouter un critère
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setShowCriteriaModal(false)}>
                    Annuler
                  </Button>
                  <Button onClick={handleSaveCriteria} disabled={updateCriteriaMutation.isPending}>
                    {updateCriteriaMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Les critères sont appliqués à toutes les séances.
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
