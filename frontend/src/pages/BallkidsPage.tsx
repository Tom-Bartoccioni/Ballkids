import { useRef, useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { Search, Plus, Upload, Download, ChevronLeft, ChevronRight, Clock, User, Star, Award, ArrowUpDown, ArrowUp, ArrowDown, Trash2, CheckCircle, XCircle, UserCheck, Shield, X, ImagePlus } from 'lucide-react'

type SortKey = 'lastName' | 'firstName' | 'phone' | 'email' | 'average' | 'status'
type SortOrder = 'asc' | 'desc'

const statusLabels: Record<string, { label: string; color: string }> = {
  REGISTERED: { label: 'Inscrit', color: 'bg-blue-100 text-blue-700' },
  SELECTED: { label: 'Selectionne', color: 'bg-green-100 text-green-700' },
  RESERVE: { label: 'Remplacant', color: 'bg-purple-100 text-purple-700' },
  REJECTED: { label: 'Refuse', color: 'bg-red-100 text-red-700' },
}

// Fonction pour determiner quelle moyenne afficher et son label
function getScoreDisplay(ballkid: any) {
  if (ballkid.overallAverage !== null && ballkid.overallAverage !== undefined) {
    return { value: ballkid.overallAverage, label: 'Moyenne', color: 'text-green-600' }
  }
  if (ballkid.trainingAverage !== null && ballkid.trainingAverage !== undefined) {
    return { value: ballkid.trainingAverage, label: 'Formation', color: 'text-blue-600' }
  }
  if (ballkid.selectionAverage !== null && ballkid.selectionAverage !== undefined) {
    return { value: ballkid.selectionAverage, label: 'Selection', color: 'text-orange-600' }
  }
  return null
}

export default function BallkidsPage() {
  const { isAdmin } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const photoImportRef = useRef<HTMLInputElement | null>(null)
  const [search, setSearch] = useState('')
  type ImportResult = {
    imported: number; updated: number; errors: number; blankRows?: number
    errorDetails: { line?: number; name: string; error: string }[]
    unmappedColumns?: string[]
  }
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [photoResult, setPhotoResult] = useState<{ matched: number; notFound: number; duplicates: number; ambiguous?: number; details: { matched: { filename: string; ballkidName: string }[]; notFound: string[]; duplicates: string[]; ambiguous?: { filename: string; candidates: string[] }[] } } | null>(null)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('lastName')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

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

  // Recuperer le tournoi actif
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
    queryKey: ['ballkids', tournamentData?.id, page, search, statusFilter],
    queryFn: async () => {
      const params: any = { page, limit: 200, excludePending: true }
      if (tournamentData?.id) params.tournamentId = tournamentData.id
      if (search) params.search = search
      if (statusFilter) params.status = statusFilter
      const res = await api.get('/ballkids', { params })
      return res.data.data
    },
  })

  // Trier les donnees cote client
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

  // Selection helpers
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === sortedBallkids.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(sortedBallkids.map((b: any) => b.id)))
    }
  }

  const clearSelection = () => setSelectedIds(new Set())

  // Bulk mutations
  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      const res = await api.post('/ballkids/bulk/status', { ids, status })
      return res.data.data
    },
    onSuccess: (data, variables) => {
      const label = statusLabels[variables.status]?.label || variables.status
      toast({ title: 'Statut mis a jour', description: `${data.count} ramasseur(s) -> ${label}` })
      queryClient.invalidateQueries({ queryKey: ['ballkids'] })
      clearSelection()
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Echec de la mise a jour' })
    },
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await api.post('/ballkids/bulk/delete', { ids })
      return res.data.data
    },
    onSuccess: (data) => {
      toast({ title: 'Suppression terminee', description: `${data.count} ramasseur(s) supprime(s)` })
      queryClient.invalidateQueries({ queryKey: ['ballkids'] })
      clearSelection()
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Echec de la suppression' })
    },
  })

  const handleBulkStatus = (status: string) => {
    bulkStatusMutation.mutate({ ids: Array.from(selectedIds), status })
  }

  const handleBulkDelete = () => {
    if (confirm(`Supprimer ${selectedIds.size} ramasseur(s) ? Cette action est irreversible.`)) {
      bulkDeleteMutation.mutate(Array.from(selectedIds))
    }
  }

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
        description: err.response?.data?.message || 'Export CSV echoue',
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
      // Le detail (ligne, nom, motif de chaque erreur) s'affiche dans une modale :
      // un simple compteur « N erreur(s) » ne permet pas de retrouver qui manque.
      setImportResult(data)
      queryClient.invalidateQueries({ queryKey: ['ballkids'] })
      queryClient.invalidateQueries({ queryKey: ['ballkids', 'pending'] })
    },
    onError: (err: any) => {
      toast({
        variant: 'destructive',
        title: 'Erreur lors de l\'import',
        description: err.response?.data?.message || err.message || 'Import CSV echoue',
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

  const [uploadingPhotos, setUploadingPhotos] = useState(false)

  const handleBulkPhotoImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return
    setUploadingPhotos(true)
    try {
      const formData = new FormData()
      for (let i = 0; i < files.length; i++) {
        formData.append('photos', files[i])
      }
      const res = await api.post('/ballkids/photos/bulk', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setPhotoResult(res.data.data)
      queryClient.invalidateQueries({ queryKey: ['ballkids'] })
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erreur', description: err.response?.data?.message || 'Import photos echoue' })
    } finally {
      setUploadingPhotos(false)
      event.target.value = ''
    }
  }

  const isBulkLoading = bulkStatusMutation.isPending || bulkDeleteMutation.isPending

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
                    Ces inscriptions necessitent votre approbation avant d'apparaitre ici
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
          <h1 className="text-2xl font-bold">Ramasseurs valides</h1>
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
                title={
                  'Colonnes reconnues : Nom, Prenom, Email, Date de naissance, Sexe, Club, TEL (enfant), ' +
                  'TEL 1 / TEL 2 (responsables legaux, ou pere / mere), Adresse, CP, Ville, Licence, Ancien, ' +
                  'Taille T-shirt, Taille Short, Taille Survetement, Pointure. Casse, accents et espaces ignores. ' +
                  'Un fichier ne contenant que Nom + Prenom + tailles met a jour les fiches existantes.'
                }
              >
                <Upload className="w-4 h-4 mr-2" />
                {importMutation.isPending ? 'Import...' : 'Importer'}
              </Button>
              <input
                ref={photoImportRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                multiple
                className="hidden"
                onChange={handleBulkPhotoImport}
              />
              <Button
                variant="outline"
                onClick={() => photoImportRef.current?.click()}
                disabled={uploadingPhotos}
              >
                <ImagePlus className="w-4 h-4 mr-2" />
                {uploadingPhotos ? 'Upload...' : 'Photos'}
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

      {/* Barre d'actions bulk */}
      {selectedIds.size > 0 && isAdmin && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="py-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-blue-800">
                  {selectedIds.size} selectionne{selectedIds.size > 1 ? 's' : ''}
                </span>
                <Button variant="ghost" size="sm" onClick={clearSelection} className="text-blue-600 hover:text-blue-800">
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" disabled={isBulkLoading} onClick={() => handleBulkStatus('REGISTERED')} className="border-blue-300 text-blue-700 hover:bg-blue-100">
                  <UserCheck className="w-4 h-4 mr-1" />
                  Inscrit
                </Button>
                <Button size="sm" variant="outline" disabled={isBulkLoading} onClick={() => handleBulkStatus('SELECTED')} className="border-green-300 text-green-700 hover:bg-green-100">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  Selectionne
                </Button>
                <Button size="sm" variant="outline" disabled={isBulkLoading} onClick={() => handleBulkStatus('RESERVE')} className="border-purple-300 text-purple-700 hover:bg-purple-100">
                  <Shield className="w-4 h-4 mr-1" />
                  Remplacant
                </Button>
                <Button size="sm" variant="outline" disabled={isBulkLoading} onClick={() => handleBulkStatus('REJECTED')} className="border-orange-300 text-orange-700 hover:bg-orange-100">
                  <XCircle className="w-4 h-4 mr-1" />
                  Refuse
                </Button>
                <Button size="sm" variant="destructive" disabled={isBulkLoading} onClick={handleBulkDelete}>
                  <Trash2 className="w-4 h-4 mr-1" />
                  Supprimer
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher par nom, prenom ou email..."
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
              <option value="SELECTED">Selectionnes</option>
              <option value="RESERVE">Remplacants</option>
              <option value="REJECTED">Refuses</option>
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
                  {isAdmin && (
                    <th className="p-4 w-12">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-gray-300 cursor-pointer"
                        checked={sortedBallkids.length > 0 && selectedIds.size === sortedBallkids.length}
                        onChange={toggleSelectAll}
                      />
                    </th>
                  )}
                  <th className="text-left p-4 font-medium w-12"></th>
                  <SortHeader column="lastName" label="Nom" />
                  <SortHeader column="firstName" label="Prenom" />
                  <SortHeader column="phone" label="Telephone" />
                  <SortHeader column="email" label="Email" />
                  <SortHeader column="average" label="Moyenne" />
                  <SortHeader column="status" label="Statut" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={isAdmin ? 8 : 7} className="p-8 text-center text-muted-foreground">
                      Chargement...
                    </td>
                  </tr>
                ) : sortedBallkids.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 8 : 7} className="p-8 text-center text-muted-foreground">
                      Aucun ramasseur trouve
                    </td>
                  </tr>
                ) : (
                  sortedBallkids.map((ballkid: any) => {
                    const scoreDisplay = getScoreDisplay(ballkid)
                    const isSelected = selectedIds.has(ballkid.id)
                    return (
                      <tr
                        key={ballkid.id}
                        className={`border-b hover:bg-gray-50 cursor-pointer ${isSelected ? 'bg-blue-50' : ''}`}
                      >
                        {isAdmin && (
                          <td className="p-4" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="w-4 h-4 rounded border-gray-300 cursor-pointer"
                              checked={isSelected}
                              onChange={() => toggleSelect(ballkid.id)}
                            />
                          </td>
                        )}
                        <td className="p-4" onClick={() => window.location.href = `/ballkids/${ballkid.id}`}>
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
                        <td className="p-4" onClick={() => window.location.href = `/ballkids/${ballkid.id}`}>
                          <span className="font-medium">{ballkid.lastName}</span>
                        </td>
                        <td className="p-4" onClick={() => window.location.href = `/ballkids/${ballkid.id}`}>
                          <span>{ballkid.firstName}</span>
                        </td>
                        <td className="p-4 text-sm" onClick={() => window.location.href = `/ballkids/${ballkid.id}`}>
                          {ballkid.phone || <span className="text-muted-foreground">-</span>}
                        </td>
                        <td className="p-4 text-sm" onClick={() => window.location.href = `/ballkids/${ballkid.id}`}>{ballkid.email}</td>
                        <td className="p-4" onClick={() => window.location.href = `/ballkids/${ballkid.id}`}>
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
                        <td className="p-4" onClick={() => window.location.href = `/ballkids/${ballkid.id}`}>
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
      {/* Modal resultat import fichier */}
      {importResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Resultat de l'import</h3>
                <button onClick={() => setImportResult(null)} className="text-gray-400 hover:text-gray-600" aria-label="Fermer">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 mb-4">
                <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded-lg">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">{importResult.imported} nouvelle{importResult.imported > 1 ? 's' : ''} fiche{importResult.imported > 1 ? 's' : ''} creee{importResult.imported > 1 ? 's' : ''}</span>
                </div>
                {importResult.updated > 0 && (
                  <div className="flex items-center gap-2 text-blue-700 bg-blue-50 p-3 rounded-lg">
                    <UserCheck className="w-5 h-5" />
                    <span className="font-medium">{importResult.updated} fiche{importResult.updated > 1 ? 's' : ''} deja presente{importResult.updated > 1 ? 's' : ''}, completee{importResult.updated > 1 ? 's' : ''} avec le fichier</span>
                  </div>
                )}
                {importResult.errors > 0 && (
                  <div className="flex items-center gap-2 text-red-700 bg-red-50 p-3 rounded-lg">
                    <XCircle className="w-5 h-5" />
                    <span className="font-medium">{importResult.errors} ligne{importResult.errors > 1 ? 's' : ''} non importee{importResult.errors > 1 ? 's' : ''}</span>
                  </div>
                )}
              </div>

              {importResult.errorDetails?.length > 0 && (
                <div className="mb-3">
                  <p className="text-sm font-medium text-gray-600 mb-1">Lignes non importees (a corriger dans le fichier puis reimporter) :</p>
                  <ul className="text-sm text-red-700 space-y-1">
                    {importResult.errorDetails.map((e, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <XCircle className="w-3 h-3 flex-shrink-0 mt-1" />
                        <span>
                          {e.line ? <span className="text-gray-500">Ligne {e.line} </span> : null}
                          {e.name ? <span className="font-medium">{e.name}</span> : <span className="italic text-gray-500">(sans nom)</span>}
                          <span className="text-gray-400"> : </span>
                          {e.error}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(importResult.unmappedColumns?.length ?? 0) > 0 && (
                <p className="text-xs text-gray-500 mb-3">
                  Colonnes ignorees (non reconnues) : {importResult.unmappedColumns!.join(', ')}
                </p>
              )}
              {(importResult.blankRows ?? 0) > 0 && (
                <p className="text-xs text-gray-500 mb-3">
                  {importResult.blankRows} ligne{importResult.blankRows! > 1 ? 's' : ''} vide{importResult.blankRows! > 1 ? 's' : ''} (numero seul) ignoree{importResult.blankRows! > 1 ? 's' : ''}.
                </p>
              )}

              <div className="flex justify-end">
                <Button onClick={() => setImportResult(null)}>Fermer</Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Modal résultat import photos */}
      {photoResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Resultat de l'import photos</h3>
                <button onClick={() => setPhotoResult(null)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 mb-4">
                <div className={`flex items-center gap-2 p-3 rounded-lg ${photoResult.matched > 0 ? 'text-green-700 bg-green-50' : 'text-orange-700 bg-orange-50'}`}>
                  {photoResult.matched > 0 ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                  <span className="font-medium">{photoResult.matched} photo{photoResult.matched > 1 ? 's' : ''} associee{photoResult.matched > 1 ? 's' : ''}</span>
                </div>
                {photoResult.notFound > 0 && (
                  <div className="flex items-center gap-2 text-red-700 bg-red-50 p-3 rounded-lg">
                    <XCircle className="w-5 h-5" />
                    <span className="font-medium">{photoResult.notFound} non trouvee{photoResult.notFound > 1 ? 's' : ''}</span>
                  </div>
                )}
                {(photoResult.ambiguous ?? 0) > 0 && (
                  <div className="flex items-center gap-2 text-amber-700 bg-amber-50 p-3 rounded-lg">
                    <XCircle className="w-5 h-5" />
                    <span className="font-medium">{photoResult.ambiguous} homonyme{(photoResult.ambiguous ?? 0) > 1 ? 's' : ''} (a associer manuellement)</span>
                  </div>
                )}
                {photoResult.duplicates > 0 && (
                  <div className="flex items-center gap-2 text-orange-700 bg-orange-50 p-3 rounded-lg">
                    <XCircle className="w-5 h-5" />
                    <span className="font-medium">{photoResult.duplicates} doublon{photoResult.duplicates > 1 ? 's' : ''}</span>
                  </div>
                )}
              </div>

              {photoResult.details.matched.length > 0 && (
                <div className="mb-3">
                  <p className="text-sm font-medium text-gray-600 mb-1">Associees :</p>
                  <ul className="text-sm text-gray-700 space-y-1">
                    {photoResult.details.matched.map((m, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />
                        <span className="truncate">{m.filename}</span>
                        <span className="text-gray-400">→</span>
                        <span className="font-medium">{m.ballkidName}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {photoResult.details.notFound.length > 0 && (
                <div className="mb-3">
                  <p className="text-sm font-medium text-gray-600 mb-1">Non trouvees (verifier le nom du fichier) :</p>
                  <ul className="text-sm text-red-600 space-y-1">
                    {photoResult.details.notFound.map((f, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <XCircle className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(photoResult.details.ambiguous?.length ?? 0) > 0 && (
                <div className="mb-3">
                  <p className="text-sm font-medium text-gray-600 mb-1">Homonymes (plusieurs ramasseurs, a associer manuellement depuis la fiche) :</p>
                  <ul className="text-sm text-amber-700 space-y-1">
                    {photoResult.details.ambiguous!.map((a, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <XCircle className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{a.filename}</span>
                        <span className="text-gray-400">→</span>
                        <span className="font-medium">{a.candidates.join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {photoResult.details.duplicates.length > 0 && (
                <div className="mb-3">
                  <p className="text-sm font-medium text-gray-600 mb-1">Doublons (plusieurs fichiers pour le meme ramasseur, seul le premier est garde) :</p>
                  <ul className="text-sm text-orange-600 space-y-1">
                    {photoResult.details.duplicates.map((f, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <XCircle className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 pt-3 border-t">
                <p className="text-xs text-gray-400">Format attendu : Nom Prenom.jpg ou Prenom Nom.jpg (separateur : espace, tiret ou underscore). Les accents, majuscules et l'ordre nom/prenom sont ignores.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
