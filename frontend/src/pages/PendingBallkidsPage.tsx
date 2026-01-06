import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { Check, X, Clock, User, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'

type SortKey = 'lastName' | 'firstName' | 'email' | 'createdAt'
type SortOrder = 'asc' | 'desc'

export default function PendingBallkidsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortOrder('asc')
    }
  }

  const SortButton = ({ column, label }: { column: SortKey, label: string }) => (
    <Button
      variant="outline"
      size="sm"
      onClick={() => handleSort(column)}
      className={sortKey === column ? 'bg-gray-100' : ''}
    >
      {label}
      {sortKey === column ? (
        sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />
      ) : (
        <ArrowUpDown className="w-3 h-3 ml-1" />
      )}
    </Button>
  )

  const { data, isLoading } = useQuery({
    queryKey: ['ballkids', 'pending'],
    queryFn: async () => {
      const res = await api.get('/ballkids/pending')
      return res.data.data
    },
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/ballkids/${id}/approve`),
    onSuccess: () => {
      toast({ title: 'Ramasseur validé' })
      queryClient.invalidateQueries({ queryKey: ['ballkids'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur' })
    },
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.post(`/ballkids/${id}/reject`),
    onSuccess: () => {
      toast({ title: 'Ramasseur refusé' })
      queryClient.invalidateQueries({ queryKey: ['ballkids'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur' })
    },
  })

  const approveAllMutation = useMutation({
    mutationFn: async () => {
      const ids = data?.ballkids?.map((b: any) => b.id) || []
      await Promise.all(ids.map((id: string) => api.post(`/ballkids/${id}/approve`)))
    },
    onSuccess: () => {
      toast({ title: 'Tous les ramasseurs ont été validés' })
      queryClient.invalidateQueries({ queryKey: ['ballkids'] })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur' })
    },
  })

  const pendingCount = data?.ballkids?.length || 0

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
        case 'email':
          aVal = a.email?.toLowerCase() || ''
          bVal = b.email?.toLowerCase() || ''
          break
        case 'createdAt':
          aVal = new Date(a.createdAt).getTime()
          bVal = new Date(b.createdAt).getTime()
          break
        default:
          return 0
      }
      
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1
      return 0
    })
  }, [data?.ballkids, sortKey, sortOrder])

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="w-6 h-6 text-orange-500" />
            En attente de validation
          </h1>
          <p className="text-muted-foreground">
            {pendingCount} inscription{pendingCount > 1 ? 's' : ''} en attente
          </p>
        </div>
        {pendingCount > 0 && (
          <Button
            onClick={() => approveAllMutation.mutate()}
            disabled={approveAllMutation.isPending}
          >
            <Check className="w-4 h-4 mr-2" />
            Tout valider ({pendingCount})
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : pendingCount === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Check className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <p className="text-lg font-medium">Aucune inscription en attente</p>
            <p className="text-muted-foreground">
              Toutes les inscriptions ont été traitées
            </p>
            <Link to="/ballkids">
              <Button variant="link" className="mt-4">
                Voir tous les ramasseurs
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Boutons de tri */}
          <div className="flex gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground self-center">Trier par :</span>
            <SortButton column="lastName" label="Nom" />
            <SortButton column="firstName" label="Prénom" />
            <SortButton column="email" label="Email" />
            <SortButton column="createdAt" label="Date" />
          </div>
          
          <div className="grid gap-4">
            {sortedBallkids.map((ballkid: any) => (
              <Card key={ballkid.id}>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    {/* Photo */}
                    <div className="flex-shrink-0">
                      {ballkid.photoUrl ? (
                        <img
                          src={`${import.meta.env.VITE_API_URL?.replace('/api', '')}${ballkid.photoUrl}`}
                          alt={`${ballkid.firstName} ${ballkid.lastName}`}
                          className="w-16 h-16 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center">
                          <User className="w-8 h-8 text-gray-400" />
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1">
                      <Link
                        to={`/ballkids/${ballkid.id}?from=pending`}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {ballkid.firstName} {ballkid.lastName}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {ballkid.email} • {ballkid.club || 'Pas de club'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Inscrit le {new Date(ballkid.createdAt).toLocaleDateString('fr-FR')}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => rejectMutation.mutate(ballkid.id)}
                        disabled={rejectMutation.isPending}
                      >
                        <X className="w-4 h-4 mr-1" />
                        Refuser
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => approveMutation.mutate(ballkid.id)}
                        disabled={approveMutation.isPending}
                      >
                        <Check className="w-4 h-4 mr-1" />
                        Valider
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
