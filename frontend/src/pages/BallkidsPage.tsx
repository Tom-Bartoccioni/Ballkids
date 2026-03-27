import { useRef, useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { Search, Plus, Upload, Download, ChevronLeft, ChevronRight, Clock, User, Star, Award, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'

type SortKey = 'lastName' | 'firstName' | 'phone' | 'email' | 'average' | 'status'
type SortOrder = 'asc' | 'desc'

const statusLabels: Record<string, { label: string; color: string }> = {
  REGISTERED: { label: 'Inscrit', color: 'bg-blue-100 text-blue-700' },
  SELECTED: { label: 'Sélectionné', color: 'bg-green-100 text-green-700' },
  RESERVE: { label: 'Remplaçant', color: 'bg-purple-100 text-purple-700' },
  REJECTED: { label: 'Refusé', color: 'bg-red-100 text-red-700' },
}

// Fonction pour déterminer quelle moyenne afficher et son label
function getScoreDisplay(ballkid: any) {
  if (ballkid.overallAverage !== null && ballkid.overallAverage !== undefined) {
    return { value: ballkid.overallAverage, label: 'Moyenne', color: 'text-green-600' }
  }
  if (ballkid.trainingAverage !== null && ballkid.trainingAverage !== undefined) {
    return { value: ballkid.trainingAverage, label: 'Formation', color: 'text-blue-600' }
  }
  if (ballkid.selectionAverage !== null && ballkid.selectionAverage !== undefined) {
    return { value: ballkid.selectionAverage, label: 'Sélection', color: 'text-orange-600' }
  }
  return null
}

export default function BallkidsPage() {
  const { isAdmin } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('lastName')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortOrder('asc')
    }
  }

  const SortHeader = ({ column, label }: { column: SortKey; label: string }) => (
    <th 
      className="text-left p-4 font-medium cursor-pointer hover:bg-gray-100 select-none"
      onClick={() => handleSort(column)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortKey === column ? (
          sortOrder === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
        ) : (
          <ArrowUpDown className="w-4 h-4 text-gray-400" />
        )}
      </div>
    </th>
  )
  
  // Récupérer le tournoi actif
  const { data: tournamentData } = useQuery({
    queryKey: ['tournament', 'active'],
    queryFn: async () => {
      const res = await api.get('/tournaments/active')
      return res.data.data.tournament
    },
  })

  // Compter les ramasseurs en attente
  const { data: pendingData } = useQuery({
    queryKey: ['ballkids', 'pending-count'],
    queryFn: async () => {
      const res = await api.get('/ballkids/pending')
      return res.data.data
    },
  })
  const pendingCount = pendingData?.ballkids?.length || 0

  const { data, isLoading } = useQuery({
    queryKey: ['ballkids', page, search, statusFilter],
    queryFn: async () => {
      const params: any = { page, limit: 200, excludePending: true }
      if (search) params.search = search
      if (statusFilter) params.status = statusFilter
      const res = await api.get('/ballkids', { params })
      return res.data.data
    },
  })

  // Trier les données côté client
  const sortedBallkids = useMemo(() => {
    if (!data?.ballkids) return []
    
    return [...data.ballkids].sort((a: any, b: any) => {
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
        case 'phone':
          aVal = a.phone || ''
          bVal = b.phone || ''
          break
        case 'email':
          aVal = a.email?.toLowerCase() || ''
          bVal = b.email?.toLowerCase() || ''
          break
        case 'average':
          aVal = a.overallAverage ?? a.trainingAverage ?? a.selectionAverage ?? -1
          bVal = b.overallAverage ?? b.trainingAverage ?? b.selectionAverage ?? -1
          break
        case 'status':
          aVal = a.status || ''
          bVal = b.status || ''
          break
        default:
          return 0
      }
      
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1
      return 0
    })
  }, [data?.ballkids, sortKey, sortOrder])

  const handleExport = async () => {
    try {
      const params: Record<string, string> = {}
      if (tournamentData?.id) params.tournamentId = tournamentData.id
      if (statusFilter) params.status = statusFilter
      const res = await api.get('/export/ballkids/csv', {
        params,
        responseType: 'blob',
      })
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'ramasseurs.csv'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Erreur lors de l\'export',
        description: err.response?.data?.message || 'Export CSV échoué',
      })
    }
  }

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!tournamentData?.id) {
        throw new Error('Tournoi actif introuvable')
      }
      const formData = new FormData()
      formData.append('file', file)
      formData.append('tournamentId', tournamentData.id)
      const res = await api.post('/ballkids/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return res.data.data
    },
    onSuccess: (data) => {
      const errorCount = data.errors || 0
      toast({
        title: 'Import terminé',
        description: `${data.imported} ramasseur(s) importé(s), ${errorCount} erreur(s)`,
      })
      queryClient.invalidateQueries({ queryKey: ['ballkids'] })
      queryClient.invalidateQueries({ queryKey: ['ballkids', 'pending'] })
    },
    onError: (err: any) => {
      toast({
        variant: 'destructive',
        title: 'Erreur lors de l\'import',
        description: err.response?.data?.message || err.message || 'Import CSV échoué',
      })
    },
  })

  const handleImportClick = () => {
    importInputRef.current?.click()
  }

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    importMutation.mutate(file)
    event.target.value = ''
  }

  return (
    <div className="space-y-6">
      {/* Alerte ramasseurs en attente */}
      {pendingCount > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 rounded-full">
                  <Clock className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="font-medium text-orange-800">
                    {pendingCount} ramasseur{pendingCount > 1 ? 's' : ''} en attente de validation
                  </p>
                  <p className="text-sm text-orange-600">
                    Ces inscriptions nécessitent votre approbation avant d'apparaître ici
                  </p>
                </div>
              </div>
              <Link to="/ballkids/pending">
                <Button variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-100">
                  Voir les inscriptions
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Ramasseurs validés</h1>
          <p className="text-muted-foreground">
            {data?.pagination?.total || 0} ramasseurs au total
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Exporter
          </Button>
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
                onClick={handleImportClick}
                disabled={importMutation.isPending || !tournamentData?.id}
              >
                <Upload className="w-4 h-4 mr-2" />
                {importMutation.isPending ? 'Import...' : 'Importer'}
              </Button>
            </>
          )}
          <Link to="/ballkids/new">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Ajouter
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher par nom, prénom ou email..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                className="pl-9"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value)
                setPage(1)
              }}
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Tous les statuts</option>
              <option value="REGISTERED">Inscrits</option>
              <option value="SELECTED">Sélectionnés</option>
              <option value="RESERVE">Remplaçants</option>
              <option value="REJECTED">Refusés</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-4 font-medium w-12"></th>
                  <SortHeader column="lastName" label="Nom" />
                  <SortHeader column="firstName" label="Prénom" />
                  <SortHeader column="phone" label="Téléphone" />
                  <SortHeader column="email" label="Email" />
                  <SortHeader column="average" label="Moyenne" />
                  <SortHeader column="status" label="Statut" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      Chargement...
                    </td>
                  </tr>
                ) : sortedBallkids.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      Aucun ramasseur trouvé
                    </td>
                  </tr>
                ) : (
                  sortedBallkids.map((ballkid: any) => {
                    const scoreDisplay = getScoreDisplay(ballkid)
                    return (
                      <tr 
                        key={ballkid.id} 
                        className="border-b hover:bg-gray-50 cursor-pointer"
                        onClick={() => window.location.href = `/ballkids/${ballkid.id}`}
                      >
                        <td className="p-4">
                          {ballkid.photoUrl ? (
                            <img 
                              src={ballkid.photoUrl} 
                              alt={`${ballkid.firstName} ${ballkid.lastName}`}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
                              <User className="w-5 h-5 text-gray-500" />
                            </div>
                          )}
                        </td>
                        <td className="p-4">
                          <span className="font-medium">{ballkid.lastName}</span>
                        </td>
                        <td className="p-4">
                          <span>{ballkid.firstName}</span>
                        </td>
                        <td className="p-4 text-sm">
                          {ballkid.phone || <span className="text-muted-foreground">-</span>}
                        </td>
                        <td className="p-4 text-sm">{ballkid.email}</td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            {scoreDisplay ? (
                              <div className="flex items-center gap-1.5">
                                <Star className={`w-4 h-4 ${scoreDisplay.color}`} />
                                <span className={`font-semibold ${scoreDisplay.color}`}>
                                  {scoreDisplay.value.toFixed(1)}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  ({scoreDisplay.label})
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                            {ballkid.isVeteran && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full" title="Ancien">
                                <Award className="w-3 h-3" />
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-4">
                          <span
                            className={`text-xs px-2 py-1 rounded-full ${
                              statusLabels[ballkid.status]?.color || 'bg-gray-100'
                            }`}
                          >
                            {statusLabels[ballkid.status]?.label || ballkid.status}
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data?.pagination && data.pagination.pages > 1 && (
            <div className="flex items-center justify-between p-4 border-t">
              <p className="text-sm text-muted-foreground">
                Page {data.pagination.page} sur {data.pagination.pages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(data.pagination.pages, p + 1))}
                  disabled={page === data.pagination.pages}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
