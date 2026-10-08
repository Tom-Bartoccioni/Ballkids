import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { ArrowLeft, Save, User, GraduationCap, Star } from 'lucide-react'

export default function TrainingScorePage() {
  const { ballkidId, sessionNumber } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  
  const [scores, setScores] = useState<Record<string, number>>({})
  const [isSaving, setIsSaving] = useState(false)

  const sessionNum = parseInt(sessionNumber || '1')

  // Fetch ballkid details
  const { data: ballkid, isLoading: ballkidLoading } = useQuery({
    queryKey: ['ballkid', ballkidId],
    queryFn: async () => {
      const res = await api.get(`/ballkids/${ballkidId}`)
      return res.data.data.ballkid
    },
  })

  // Fetch tournament
  const { data: tournament } = useQuery({
    queryKey: ['tournament', 'active'],
    queryFn: async () => {
      const res = await api.get('/tournaments/active')
      return res.data.data.tournament
    },
  })

  // Fetch training session with criteria
  const { data: trainingData, isLoading: trainingLoading } = useQuery({
    queryKey: ['training', 'session', tournament?.id, sessionNum],
    queryFn: async () => {
      if (!tournament?.id) return null
      const res = await api.get(`/training/${tournament.id}/${sessionNum}`)
      return res.data.data
    },
    enabled: !!tournament?.id,
  })

  // Fetch existing scores for this ballkid
  const { data: existingScoreData } = useQuery({
    queryKey: ['training', 'score', tournament?.id, sessionNum, ballkidId, user?.id],
    queryFn: async () => {
      if (!tournament?.id || !ballkidId) return null
      const res = await api.get(`/training/${tournament.id}/${sessionNum}/score/${ballkidId}`)
      return res.data.data
    },
    enabled: !!tournament?.id && !!ballkidId,
  })

  const criteria = trainingData?.session?.criteria || []

  // Initialize scores from existing data
  useEffect(() => {
    if (existingScoreData?.score?.details) {
      const initialScores: Record<string, number> = {}
      existingScoreData.score.details.forEach((detail: any) => {
        initialScores[detail.trainingCriteriaId] = detail.value
      })
      setScores(initialScores)
    } else if (criteria.length > 0 && Object.keys(scores).length === 0) {
      // Initialize with empty scores
      const initialScores: Record<string, number> = {}
      criteria.forEach((c: any) => {
        initialScores[c.id] = 0
      })
      setScores(initialScores)
    }
  }, [existingScoreData, criteria])

  const scoreMutation = useMutation({
    mutationFn: async (scoreData: Record<string, number>) => {
      const res = await api.post(`/training/${tournament?.id}/${sessionNum}/score`, {
        ballkidId,
        scores: scoreData,
      })
      return res.data
    },
    onSuccess: () => {
      toast({ title: 'Note enregistrée' })
      queryClient.invalidateQueries({ queryKey: ['training'] })
      queryClient.invalidateQueries({ queryKey: ['ballkid', ballkidId] })
      navigate('/training')
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de l\'enregistrement' })
    },
  })

  const handleScoreChange = (criteriaId: string, value: string, maxScore: number) => {
    const numValue = parseFloat(value)
    if (value === '' || (numValue >= 0 && numValue <= maxScore)) {
      setScores(prev => ({
        ...prev,
        [criteriaId]: value === '' ? 0 : numValue,
      }))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const inputs = document.querySelectorAll<HTMLInputElement>('input[type="number"]')
      const nextInput = inputs[index + 1]
      if (nextInput) {
        nextInput.focus()
        nextInput.select()
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    try {
      await scoreMutation.mutateAsync(scores)
    } finally {
      setIsSaving(false)
    }
  }

  // Total = somme brute des points (note x coef), jamais ramenee sur 20
  const calculateTotal = () => {
    let total = 0
    criteria.forEach((c: any) => {
      if (!c.isCalculated) {
        const score = scores[c.id] || 0
        total += score * c.weight
      }
    })
    return total
  }

  const totalScore = calculateTotal()

  if (ballkidLoading || trainingLoading) {
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
        <Button variant="outline" onClick={() => navigate('/training')} className="mt-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Retour
        </Button>
      </div>
    )
  }

  if (criteria.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/training')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Retour
          </Button>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <GraduationCap className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">Aucun critère défini</p>
            <p className="text-muted-foreground">
              Veuillez d'abord définir les critères de notation dans la page Formation.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/training')}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Retour
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GraduationCap className="w-6 h-6 text-blue-500" />
            Notation Séance {sessionNum}
          </h1>
          <p className="text-muted-foreground">
            Évaluez le ramasseur selon les critères définis
          </p>
        </div>
      </div>

      {/* Ballkid Info */}
      <Card>
        <CardContent className="flex items-center gap-4 py-4">
          {ballkid.photoUrl ? (
            <img
              src={ballkid.photoUrl}
              alt=""
              className="w-16 h-16 rounded-full object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center">
              <User className="w-8 h-8 text-gray-400" />
            </div>
          )}
          <div>
            <h2 className="text-xl font-semibold">
              {ballkid.lastName} {ballkid.firstName}
            </h2>
            <p className="text-muted-foreground">
              {ballkid.club || 'Sans club'} • {new Date(ballkid.birthDate).toLocaleDateString('fr-FR')}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Scoring Form */}
      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="w-5 h-5 text-yellow-500" />
              Critères d'évaluation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {criteria.map((criterion: any, index: number) => (
                <div key={criterion.id} className="text-center">
                  <Label htmlFor={criterion.id} className="text-xs font-medium block truncate mb-1" title={criterion.name}>
                    {criterion.name}
                    {criterion.weight !== 1 && <span className="text-muted-foreground"> ×{criterion.weight}</span>}
                  </Label>
                  <div className="flex items-center justify-center gap-0.5">
                    <Input
                      id={criterion.id}
                      type="number"
                      min="0"
                      max={criterion.maxScore}
                      step="0.5"
                      value={scores[criterion.id] ?? ''}
                      onChange={(e) => handleScoreChange(criterion.id, e.target.value, criterion.maxScore)}
                      onKeyDown={(e) => handleKeyDown(e, index)}
                      className="w-12 h-8 text-center text-sm font-semibold px-1"
                    />
                    <span className="text-xs text-muted-foreground">/{criterion.maxScore}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Total Score Display */}
            <div className="pt-6 mt-6 border-t">
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold">Total des points</span>
                <span className="text-3xl font-bold text-primary">
                  {Number.isInteger(totalScore) ? totalScore : totalScore.toFixed(1)}
                  <span className="text-lg text-muted-foreground"> pts</span>
                </span>
              </div>
            </div>

            {/* Submit Button */}
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => navigate('/training')}>
                Annuler
              </Button>
              <Button type="submit" disabled={isSaving}>
                <Save className="w-4 h-4 mr-2" />
                {isSaving ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
