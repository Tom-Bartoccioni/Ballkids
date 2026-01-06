import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { ArrowLeft, Save, Loader2 } from 'lucide-react'

const ballkidSchema = z.object({
  firstName: z.string().min(1, 'Prénom requis'),
  lastName: z.string().min(1, 'Nom requis'),
  email: z.string().email('Email invalide'),
  birthDate: z.string().min(1, 'Date de naissance requise'),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  phone: z.string().optional(),
  phoneFather: z.string().optional(),
  phoneMother: z.string().optional(),
  address: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  club: z.string().optional(),
  licenseNumber: z.string().optional(),
  isVeteran: z.boolean().optional(),
  tshirtSize: z.string().optional(),
  shortSize: z.string().optional(),
  tracksuitSize: z.string().optional(),
  shoeSize: z.string().optional(),
})

type BallkidFormData = z.infer<typeof ballkidSchema>

export default function BallkidEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  
  const fromPending = searchParams.get('from') === 'pending'

  const { data: ballkid, isLoading } = useQuery({
    queryKey: ['ballkid', id],
    queryFn: async () => {
      const res = await api.get(`/ballkids/${id}`)
      return res.data.data.ballkid
    },
  })

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<BallkidFormData>({
    resolver: zodResolver(ballkidSchema),
    values: ballkid ? {
      firstName: ballkid.firstName || '',
      lastName: ballkid.lastName || '',
      email: ballkid.email || '',
      birthDate: ballkid.birthDate ? new Date(ballkid.birthDate).toISOString().split('T')[0] : '',
      gender: ballkid.gender || 'OTHER',
      phone: ballkid.phone || '',
      phoneFather: ballkid.phoneFather || '',
      phoneMother: ballkid.phoneMother || '',
      address: ballkid.address || '',
      postalCode: ballkid.postalCode || '',
      city: ballkid.city || '',
      club: ballkid.club || '',
      licenseNumber: ballkid.licenseNumber || '',
      isVeteran: ballkid.isVeteran || false,
      tshirtSize: ballkid.tshirtSize || '',
      shortSize: ballkid.shortSize || '',
      tracksuitSize: ballkid.tracksuitSize || '',
      shoeSize: ballkid.shoeSize || '',
    } : undefined,
  })

  const updateMutation = useMutation({
    mutationFn: (data: BallkidFormData) => api.put(`/ballkids/${id}`, data),
    onSuccess: () => {
      toast({ title: 'Ramasseur modifié avec succès' })
      queryClient.invalidateQueries({ queryKey: ['ballkid', id] })
      queryClient.invalidateQueries({ queryKey: ['ballkids'] })
      navigate(`/ballkids/${id}${fromPending ? '?from=pending' : ''}`)
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Erreur lors de la modification' })
    },
  })

  const onSubmit = (data: BallkidFormData) => {
    updateMutation.mutate(data)
  }

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

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <Link to={`/ballkids/${id}${fromPending ? '?from=pending' : ''}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Modifier le ramasseur</h1>
          <p className="text-muted-foreground">
            {ballkid.firstName} {ballkid.lastName}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Informations personnelles */}
        <Card>
          <CardHeader>
            <CardTitle>Informations personnelles</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">Prénom *</Label>
              <Input
                id="firstName"
                {...register('firstName')}
                className={errors.firstName ? 'border-red-500' : ''}
              />
              {errors.firstName && (
                <p className="text-sm text-red-500">{errors.firstName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastName">Nom *</Label>
              <Input
                id="lastName"
                {...register('lastName')}
                className={errors.lastName ? 'border-red-500' : ''}
              />
              {errors.lastName && (
                <p className="text-sm text-red-500">{errors.lastName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                {...register('email')}
                className={errors.email ? 'border-red-500' : ''}
              />
              {errors.email && (
                <p className="text-sm text-red-500">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Téléphone</Label>
              <Input id="phone" {...register('phone')} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phoneFather">Téléphone Père</Label>
              <Input id="phoneFather" {...register('phoneFather')} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phoneMother">Téléphone Mère</Label>
              <Input id="phoneMother" {...register('phoneMother')} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="birthDate">Date de naissance *</Label>
              <Input
                id="birthDate"
                type="date"
                {...register('birthDate')}
                className={errors.birthDate ? 'border-red-500' : ''}
              />
              {errors.birthDate && (
                <p className="text-sm text-red-500">{errors.birthDate.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="gender">Genre *</Label>
              <select
                id="gender"
                {...register('gender')}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="MALE">Garçon</option>
                <option value="FEMALE">Fille</option>
                <option value="OTHER">Autre</option>
              </select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="address">Adresse</Label>
              <Input id="address" {...register('address')} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="postalCode">Code postal</Label>
              <Input id="postalCode" {...register('postalCode')} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="city">Ville</Label>
              <Input id="city" {...register('city')} />
            </div>
          </CardContent>
        </Card>

        {/* Club et Licence */}
        <Card>
          <CardHeader>
            <CardTitle>Club et Licence</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="club">Club</Label>
              <Input id="club" {...register('club')} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="licenseNumber">Numéro de licence</Label>
              <Input id="licenseNumber" {...register('licenseNumber')} />
            </div>

            <div className="md:col-span-2 pt-2">
              <label className="flex items-center gap-3 cursor-pointer p-3 border rounded-lg hover:bg-gray-50">
                <input
                  type="checkbox"
                  {...register('isVeteran')}
                  className="w-5 h-5 rounded border-gray-300 text-primary focus:ring-primary accent-primary"
                />
                <div>
                  <span className="font-medium">Ancien</span>
                  <p className="text-sm text-muted-foreground">A déjà participé à un précédent tournoi</p>
                </div>
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Équipement */}
        <Card>
          <CardHeader>
            <CardTitle>Équipement</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="tshirtSize">Taille T-shirt</Label>
              <select
                id="tshirtSize"
                {...register('tshirtSize')}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">-</option>
                <option value="XS">XS</option>
                <option value="S">S</option>
                <option value="M">M</option>
                <option value="L">L</option>
                <option value="XL">XL</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="shortSize">Taille Short</Label>
              <select
                id="shortSize"
                {...register('shortSize')}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">-</option>
                <option value="XS">XS</option>
                <option value="S">S</option>
                <option value="M">M</option>
                <option value="L">L</option>
                <option value="XL">XL</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tracksuitSize">Taille Survêtement</Label>
              <select
                id="tracksuitSize"
                {...register('tracksuitSize')}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">-</option>
                <option value="XS">XS</option>
                <option value="S">S</option>
                <option value="M">M</option>
                <option value="L">L</option>
                <option value="XL">XL</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="shoeSize">Pointure</Label>
              <Input id="shoeSize" {...register('shoeSize')} placeholder="Ex: 38" />
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Link to={`/ballkids/${id}`}>
            <Button type="button" variant="outline">
              Annuler
            </Button>
          </Link>
          <Button type="submit" disabled={updateMutation.isPending || !isDirty}>
            {updateMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Enregistrement...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Enregistrer
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
