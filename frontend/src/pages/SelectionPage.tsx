import React, { useRef, useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { 
  Trophy, Users, CheckCircle, Star, Search, AlertTriangle, Award, 
  User, Save, List, Edit3, ArrowUpDown, ArrowUp, ArrowDown, Upload, Settings, X, Pencil
} from 'lucide-react'

type Tab = 'notation' | 'classement'
type SortKey = 'lastName' | 'firstName' | 'average' | 'status' | 'rank' | 'current'
type SortOrder = 'asc' | 'desc'

// Grille de sélection de l'admin (même liste que DEFAULT_SELECTION_CRITERIA côté serveur).
// Proposée quand aucun critère n'existe, et rechargeable depuis l'éditeur.
const ADMIN_GRID: Array<{ name: string; maxScore: number; weight: number }> = [
  { name: 'Poubelle avec rebond', maxScore: 20, weight: 1 },
  { name: 'Poubelle sans rebond', maxScore: 20, weight: 3 },
  { name: 'Roulé 1/2', maxScore: 20, weight: 1 },
  { name: 'Roulé', maxScore: 20, weight: 2 },
  { name: 'Vitesse (roulé)', maxScore: 20, weight: 3 },
  { name: 'Rebond', maxScore: 20, weight: 2 },
  { name: 'Vitesse', maxScore: 20, weight: 3 },
  { name: 'Parcours poubelle', maxScore: 20, weight: 2 },
  { name: 'Parcours boîtes 1', maxScore: 20, weight: 1 },
  { name: 'Parcours boîtes 2', maxScore: 20, weight: 2 },
  { name: 'Parcours vitesse', maxScore: 20, weight: 3 },
  { name: 'Ancien (bonus)', maxScore: 40, weight: 1 },
]

export default function SelectionPage() {
  const { isAdmin } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>('notation')
  const [search, setSearch] = useState('')
  const [scores, setScores] = useState<Record<string, string>>({})
  const [editingSelectionId, setEditingSelectionId] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('rank')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [showCriteriaModal, setShowCriteriaModal] = useState(false)
  const [criteriaDraft, setCriteriaDraft] = useState<Array<{ name: string; maxScore: number; weight: number }>>([])

  // Réinitialiser le tri quand on change d'onglet
  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab)
    if (tab === 'classement') {
      setSortKey('rank')
      setSortOrder('asc')
    } else {
      setSortKey('lastName')
      setSortOrder('asc')
    }
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortOrder(key === 'rank' || key === 'average' ? 'asc' : 'asc')
    }
  }

  const SortHeader = ({
    column,
    label,
    align = 'left',
  }: {
    column: SortKey
    label: string
    align?: 'left' | 'center' | 'right'
  }) => (
    <th 
      className={`p-4 font-medium cursor-pointer hover:bg-gray-100 select-none ${
        align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'
      }`}
      onClick={() => handleSort(column)}
    >
      <div
        className={`flex items-center gap-1 ${
          align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : ''
        }`}
      >
        {label}
        {sortKey === column ? (
          sortOrder === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
        ) : (
          <ArrowUpDown className="w-4 h-4 text-gray-400" />
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

  const { data: rankingData, isLoading: rankingLoading } = useQuery({
    queryKey: ['selection', 'ranking', tournament?.id],
    queryFn: async () => {
      if (!tournament?.id) return null
      const res = await api.get(`/selection/${tournament.id}/ranking`)
      return res.data.data
    },
    enabled: !!tournament?.id,
  })

  const { data: selectionSessionData } = useQuery({
    queryKey: ['selection', 'session', tournament?.id],
    queryFn: async () => {
      if (!tournament?.id) return null
      const res = await api.get(`/selection/${tournament.id}`)
      return res.data.data.session
    },
    enabled: !!tournament?.id,
  })

  const selectionCriteria = selectionSessionData?.criteria || []
  const hasCriteria = selectionCriteria.length > 0

  const { data: ballkidsData, isLoading: ballkidsLoading } = useQuery({
    queryKey: ['ballkids', 'for-selection'],
    queryFn: async () => {
      const res = await api.get('/ballkids', { 
        params: { excludePending: true, limit: 200 } 
      })
      return res.data.data
    },
    enabled: !!tournament?.id,
  })

  const scoreMutation = useMutation({
    mutationFn: ({ ballkidId, score }: { ballkidId: string, score: number }) => 
      api.post(`/selection/${tournament?.id}/score-simple`, { ballkidId, score }),
    onSuccess: async (_, variables) => {
      toast({ title: 'Note enregistrée' })
      // Attendre le refetch avant de nettoyer le state
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['selection'] }),
        queryClient.invalidateQueries({ queryKey: ['ballkids'] }),
      ])
      setScores(prev => {
        const newScores = { ...prev }
        delete newScores[variables.ballkidId]
        return newScores
      })
      setEditingSelectionId(null)
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de l\'enregistrement' })
    },
  })

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      const res = await api.post(`/selection/${tournament?.id}/import-csv`, formData, {
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
      queryClient.invalidateQueries({ queryKey: ['selection'] })
      queryClient.invalidateQueries({ queryKey: ['ballkids'] })
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
      const res = await api.put(`/selection/${tournament?.id}/criteria`, { criteria })
      return res.data.data
    },
    onSuccess: () => {
      toast({ title: 'Critères mis à jour' })
      queryClient.invalidateQueries({ queryKey: ['selection', 'session'] })
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
    const existing = selectionSessionData?.criteria || []
    if (existing.length > 0) {
      setCriteriaDraft(
        existing.map((c: any) => ({
          name: c.name,
          maxScore: c.maxScore ?? 5,
          weight: c.weight ?? 1,
        }))
      )
    } else {
      setCriteriaDraft(ADMIN_GRID.map((c) => ({ ...c })))
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

  // Objectif de l'admin : N selectionnes (78 par defaut) + quelques remplacants
  const [selectCount, setSelectCount] = useState(78)
  const [reserveCount, setReserveCount] = useState(4)
  const selectionTotal = selectCount

  const selectMutation = useMutation({
    mutationFn: () => api.post(`/selection/${tournament?.id}/select`, { count: selectCount, reserveCount }),
    onSuccess: (res) => {
      toast({
        title: 'Sélection effectuée !',
        description: `${res.data.data.selected} sélectionnés, ${res.data.data.reserves} remplaçants`,
      })
      queryClient.invalidateQueries({ queryKey: ['selection'] })
      queryClient.invalidateQueries({ queryKey: ['ballkids'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la sélection' })
    },
  })

  const ranking = rankingData?.ranking || []
  const allBallkids = ballkidsData?.ballkids || []
  
  // Créer un map des notes existantes
  const scoreMap = new Map<string, any>(ranking.map((r: any) => [r.id, r]))

  // Stats
  const registeredBallkids = allBallkids.filter((b: any) => 
    ['REGISTERED', 'SELECTED', 'RESERVE'].includes(b.status)
  )
  const totalRegistered = registeredBallkids.length
  const notedCount = ranking.length
  const selectedCount = ranking.filter((r: any) => r.status === 'SELECTED').length

  // Filtrer les ramasseurs pour l'onglet notation
  const filteredBallkids = registeredBallkids.filter((b: any) => {
    if (!search) return true
    const searchLower = search.toLowerCase()
    return b.lastName.toLowerCase().includes(searchLower) ||
           b.firstName.toLowerCase().includes(searchLower)
  })

  // Filtrer le classement
  const filteredRanking = ranking.filter((item: any) => {
    if (!search) return true
    const searchLower = search.toLowerCase()
    return item.lastName.toLowerCase().includes(searchLower) ||
           item.firstName.toLowerCase().includes(searchLower)
  })

  // Trier les données selon la colonne sélectionnée
  const sortData = (data: any[]) => {
    return [...data].sort((a: any, b: any) => {
      let aVal: any, bVal: any
      
      switch (sortKey) {
        case 'current':
          aVal = scoreMap.get(a.id)?.averageScore ?? -1
          bVal = scoreMap.get(b.id)?.averageScore ?? -1
          break
        case 'lastName':
          aVal = a.lastName?.toLowerCase() || ''
          bVal = b.lastName?.toLowerCase() || ''
          break
        case 'firstName':
          aVal = a.firstName?.toLowerCase() || ''
          bVal = b.firstName?.toLowerCase() || ''
          break
        case 'average':
          aVal = a.selectionAverage ?? a.average ?? -1
          bVal = b.selectionAverage ?? b.average ?? -1
          break
        case 'status':
          aVal = a.status || ''
          bVal = b.status || ''
          break
        case 'rank':
          aVal = a.rank ?? 9999
          bVal = b.rank ?? 9999
          break
        default:
          return 0
      }
      
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1
      return 0
    })
  }

  const sortedBallkids = useMemo(() => sortData(filteredBallkids), [filteredBallkids, sortKey, sortOrder])
  const sortedRanking = useMemo(() => sortData(filteredRanking), [filteredRanking, sortKey, sortOrder])

  const handleScoreChange = (ballkidId: string, value: string) => {
    // Permettre seulement les nombres entre 0 et 20
    if (value === '' || (/^\d*\.?\d*$/.test(value) && parseFloat(value) <= 20)) {
      setScores(prev => ({ ...prev, [ballkidId]: value }))
    }
  }

  const handleScoreSubmit = (ballkidId: string) => {
    const scoreValue = scores[ballkidId]
    if (scoreValue && !isNaN(parseFloat(scoreValue))) {
      const score = parseFloat(scoreValue)
      if (score >= 0 && score <= 20) {
        scoreMutation.mutate({ ballkidId, score })
      }
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent, ballkidId: string) => {
    if (e.key === 'Enter') {
      handleScoreSubmit(ballkidId)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Trophy className="w-6 h-6 text-amber-800" />
            Sélection initiale
          </h1>
          <p className="text-muted-foreground">
            Notez les ramasseurs et sélectionnez les meilleurs (78 + remplaçants par défaut)
          </p>
        </div>
        {isAdmin && notedCount > 0 && selectedCount === 0 && (
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <label htmlFor="selectCount" className="text-xs text-muted-foreground">Sélectionnés</label>
              <Input id="selectCount" type="number" min="1" className="w-24" value={selectCount}
                onChange={(e) => setSelectCount(Math.max(1, parseInt(e.target.value) || 0))} />
            </div>
            <div className="space-y-1">
              <label htmlFor="reserveCount" className="text-xs text-muted-foreground">Remplaçants</label>
              <Input id="reserveCount" type="number" min="0" className="w-24" value={reserveCount}
                onChange={(e) => setReserveCount(Math.max(0, parseInt(e.target.value) || 0))} />
            </div>
            <Button
              onClick={() => {
                if (confirm(`Sélectionner les ${selectCount} meilleurs + ${reserveCount} remplaçants sur ${notedCount} notés ?`)) {
                  selectMutation.mutate()
                }
              }}
              disabled={selectMutation.isPending || notedCount < selectCount}
              size="lg"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Sélectionner {selectCount} + {reserveCount}
            </Button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-emerald-100 rounded-lg">
                <Users className="w-6 h-6 text-emerald-700" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total inscrits</p>
                <p className="text-2xl font-bold">{totalRegistered}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-red-100 rounded-lg">
                <Star className="w-6 h-6 text-red-700" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Notés</p>
                <p className="text-2xl font-bold">{notedCount} <span className="text-sm font-normal text-muted-foreground">/ {totalRegistered}</span></p>
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
                <p className="text-sm text-muted-foreground">Sélectionnés</p>
                <p className="text-2xl font-bold">{selectedCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-purple-100 rounded-lg">
                <Award className="w-6 h-6 text-purple-800" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Objectif</p>
                <p className="text-2xl font-bold">{selectionTotal}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerte si pas assez de notes */}
      {notedCount < selectCount && notedCount > 0 && selectedCount === 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-700" />
              <p className="text-red-800">
                <span className="font-medium">{notedCount}</span> ramasseurs notés sur les {selectCount} à sélectionner.
                Il manque <span className="font-medium">{selectCount - notedCount}</span> notes pour pouvoir faire la sélection.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sélection terminée */}
      {selectedCount > 0 && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-700" />
              <p className="text-emerald-800">
                La sélection est terminée : <span className="font-medium">{selectedCount}</span> ramasseurs sélectionnés.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <div className="border-b">
        <nav className="flex gap-4">
          <button
            onClick={() => handleTabChange('notation')}
            className={`pb-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'notation'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Edit3 className="w-4 h-4 inline-block mr-2" />
            Notation ({totalRegistered})
          </button>
          <button
            onClick={() => handleTabChange('classement')}
            className={`pb-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'classement'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <List className="w-4 h-4 inline-block mr-2" />
            Classement ({notedCount})
          </button>
        </nav>
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
      {/* Onglet Notation */}
      {activeTab === 'notation' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div>
              <CardTitle>Noter les ramasseurs</CardTitle>
              {isAdmin && (
                <p className="text-xs text-muted-foreground mt-1">
                  Import CSV: colonnes `email` ou `prenom` + `nom`, et `total` (ou `note`/`score`), valeur 0-20.
                </p>
              )}
            </div>
            {isAdmin && (
              <div className="flex gap-2">
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
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <SortHeader column="lastName" label="Ramasseur" />
                    <SortHeader column="current" label="Total points" align="center" />
                    <SortHeader column="status" label="Statut" />
                    {hasCriteria && <th className="p-4 font-medium text-center">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {ballkidsLoading ? (
                    <tr>
                      <td colSpan={hasCriteria ? 4 : 3} className="p-8 text-center text-muted-foreground">
                        Chargement...
                      </td>
                    </tr>
                  ) : sortedBallkids.length === 0 ? (
                    <tr>
                      <td colSpan={hasCriteria ? 4 : 3} className="p-8 text-center text-muted-foreground">
                        Aucun ramasseur trouvé
                      </td>
                    </tr>
                  ) : (
                    sortedBallkids.map((ballkid: any) => {
                      const existingScore = scoreMap.get(ballkid.id)
                      const hasScore = !!existingScore
                      
                      return (
                        <tr
                          key={ballkid.id}
                          className="border-b hover:bg-gray-50"
                        >
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              {ballkid.photoUrl ? (
                                <img
                                  src={ballkid.photoUrl}
                                  alt=""
                                  className="w-10 h-10 rounded-full object-cover"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                                  <User className="w-5 h-5 text-gray-400" />
                                </div>
                              )}
                              <div>
                                <Link
                                  to={`/ballkids/${ballkid.id}?from=selection`}
                                  className="font-medium hover:text-primary hover:underline"
                                >
                                  {ballkid.lastName} {ballkid.firstName}
                                </Link>
                                <p className="text-sm text-muted-foreground">
                                  {ballkid.club || 'Sans club'}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-center">
                            <div className="inline-flex items-center justify-center w-40 min-h-[2.25rem]">
                              {hasScore && editingSelectionId !== ballkid.id ? (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-2 font-mono text-lg font-semibold text-emerald-700 hover:text-emerald-800"
                                  onClick={() => {
                                    setScores((prev) => ({
                                      ...prev,
                                      [ballkid.id]: String(existingScore.averageScore),
                                    }))
                                    setEditingSelectionId(ballkid.id)
                                  }}
                                  title="Cliquer pour modifier"
                                >
                                  {Number.isInteger(existingScore.averageScore) ? existingScore.averageScore : existingScore.averageScore.toFixed(1)} pts
                                  <Pencil className="w-4 h-4 text-muted-foreground" />
                                </button>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <Input
                                    type="text"
                                    placeholder="0-20"
                                    value={scores[ballkid.id] || ''}
                                    onChange={(e) => handleScoreChange(ballkid.id, e.target.value)}
                                    onKeyPress={(e) => handleKeyPress(e, ballkid.id)}
                                    className="w-20 text-center"
                                  />
                                  <Button
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleScoreSubmit(ballkid.id)
                                    }}
                                    disabled={!scores[ballkid.id] || scoreMutation.isPending}
                                  >
                                    <Save className="w-4 h-4" />
                                  </Button>
                                  {hasScore && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => {
                                        setEditingSelectionId(null)
                                        setScores((prev) => {
                                          const next = { ...prev }
                                          delete next[ballkid.id]
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
                          <td className="p-4">
                            {ballkid.status === 'SELECTED' && (
                              <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-800">
                                Sélectionné
                              </span>
                            )}
                            {(ballkid.status === 'REGISTERED' || ballkid.status === 'RESERVE') && (
                              <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-800">
                                Inscrit
                              </span>
                            )}
                          </td>
                          {hasCriteria && (
                            <td className="p-4 text-center">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  navigate(`/selection/score/${ballkid.id}`)
                                }}
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

      {/* Onglet Classement */}
      {activeTab === 'classement' && (
        <Card>
          <CardHeader>
            <CardTitle>Classement ({notedCount} ramasseurs notés)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <SortHeader column="rank" label="Rang" />
                    <SortHeader column="lastName" label="Nom" />
                    <SortHeader column="average" label="Total points" />
                    <th className="text-center p-4 font-medium">Notes</th>
                    <SortHeader column="status" label="Statut" />
                  </tr>
                </thead>
                <tbody>
                  {rankingLoading ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground">
                        Chargement...
                      </td>
                    </tr>
                  ) : sortedRanking.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground">
                        {ranking.length === 0 
                          ? 'Aucun ramasseur noté. Utilisez l\'onglet "Notation" pour noter les ramasseurs.' 
                          : 'Aucun résultat pour cette recherche'}
                      </td>
                    </tr>
                  ) : (
                    <>
                      {sortedRanking.map((item: any) => {
                        const originalIndex = ranking.findIndex((r: any) => r.id === item.id)
                        const isSelected = originalIndex < selectionTotal
                        
                        return (
                          <React.Fragment key={item.id}>
                            <tr
                              className={`border-b hover:bg-gray-50 transition-colors ${
                                item.status === 'SELECTED' 
                                  ? 'bg-emerald-50' 
                                  : isSelected 
                                  ? 'bg-emerald-50/30' 
                                  : ''
                              }`}
                              onClick={() => navigate(`/ballkids/${item.id}?from=selection`)}
                            >
                              <td className="p-4">
                                <span
                                  className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                                    originalIndex < 3
                                      ? 'bg-amber-100 text-amber-800'
                                      : isSelected
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-gray-100 text-gray-600'
                                  }`}
                                >
                                  {originalIndex + 1}
                                </span>
                              </td>
                              <td className="p-4">
                                <Link 
                                  to={`/ballkids/${item.id}?from=selection`}
                                  className="font-medium hover:text-primary hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {item.lastName} {item.firstName}
                                </Link>
                              </td>
                              <td className="p-4">
                                {/* Total brut des points (somme des notes x coef), jamais ramene sur 20 */}
                                <span className="font-mono text-lg font-semibold">
                                  {Number.isInteger(item.averageScore) ? item.averageScore : item.averageScore.toFixed(1)}
                                </span>
                                <span className="text-muted-foreground text-sm"> pts</span>
                              </td>
                              <td className="p-4 text-center text-sm text-muted-foreground">
                                {item.scoresCount} note{item.scoresCount > 1 ? 's' : ''}
                              </td>
                              <td className="p-4">
                                {item.status === 'SELECTED' && (
                                  <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 font-medium">
                                    ✓ Sélectionné
                                  </span>
                                )}
                                {item.status === 'REGISTERED' && isSelected && (
                                  <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-800">
                                    À sélectionner
                                  </span>
                                )}
                                {item.status === 'REGISTERED' && !isSelected && (
                                  <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                                    Non sélectionné
                                  </span>
                                )}
                              </td>
                            </tr>
                          </React.Fragment>
                        )
                      })}
                    </>
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
                <span className="col-span-3 text-center">Note max</span>
                <span className="col-span-2 text-center">Coef.</span>
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
              {/* Total maximum = Σ note max × coef, comme la colonne TOTAL du classeur. Pas de pourcentage : l'admin veut des points bruts. */}
              {criteriaDraft.length > 0 && (() => {
                const totalMax = criteriaDraft.reduce((sum, c) => sum + (c.maxScore || 0) * (c.weight || 0), 0)
                return (
                  <div className="rounded-md bg-gray-50 border p-3 text-xs space-y-1">
                    <p className="font-medium">Total maximum : {totalMax} pts</p>
                    <div className="grid grid-cols-2 gap-x-4 text-muted-foreground">
                      {criteriaDraft.map((c, i) => (
                        <span key={i}>
                          {c.name || `Critère ${i + 1}`} : {c.maxScore || 0} × {c.weight || 0} = {(c.maxScore || 0) * (c.weight || 0)} pts
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </CardContent>
            <div className="flex-shrink-0 border-t bg-white p-4 rounded-b-lg">
              <div className="flex justify-between">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setCriteriaDraft([...criteriaDraft, { name: '', maxScore: 20, weight: 1 }])}
                  >
                    Ajouter un critère
                  </Button>
                  <Button
                    variant="outline"
                    title="Remplace la liste par la grille du classeur : 11 critères avec coefficients + bonus ancien/jour"
                    onClick={() => {
                      if (criteriaDraft.length === 0 || confirm('Remplacer les critères actuels par la grille par défaut ?')) {
                        setCriteriaDraft(ADMIN_GRID.map((c) => ({ ...c })))
                      }
                    }}
                  >
                    Charger la grille par défaut
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setShowCriteriaModal(false)}>
                    Annuler
                  </Button>
                  <Button onClick={handleSaveCriteria} disabled={updateCriteriaMutation.isPending}>
                    {updateCriteriaMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
