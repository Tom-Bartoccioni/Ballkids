import { useNavigate, Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { ArrowLeft, Save, Loader2, User, Mail, Phone, MapPin, Shirt, Award } from 'lucide-react'

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

export default function BallkidNewPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BallkidFormData>({
    resolver: zodResolver(ballkidSchema),
    defaultValues: {
      gender: 'OTHER',
      isVeteran: false,
    },
  })

  const createMutation = useMutation({
    mutationFn: (data: BallkidFormData) => api.post('/ballkids', data),
    onSuccess: (response) => {
      toast({ title: 'Ramasseur créé avec succès' })
      queryClient.invalidateQueries({ queryKey: ['ballkids'] })
      navigate(`/ballkids/${response.data.data.ballkid.id}`)
    },
    onError: (error: any) => {
      toast({ 
        variant: 'destructive', 
        title: 'Erreur lors de la création',
        description: error.response?.data?.message || 'Une erreur est survenue'
      })
    },
  })

  const onSubmit = (data: BallkidFormData) => {
    createMutation.mutate(data)
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <Link to="/ballkids">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Nouveau ramasseur</h1>
          <p className="text-muted-foreground">Ajouter un ramasseur manuellement</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Informations personnelles */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              Informations personnelles
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lastName">Nom *</Label>
              <Input
                id="lastName"
                {...register('lastName')}
                placeholder="Dupont"
              />
              {errors.lastName && (
                <p className="text-sm text-destructive">{errors.lastName.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="firstName">Prénom *</Label>
              <Input
                id="firstName"
                {...register('firstName')}
                placeholder="Jean"
              />
              {errors.firstName && (
                <p className="text-sm text-destructive">{errors.firstName.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="birthDate">Date de naissance *</Label>
              <Input
                id="birthDate"
                type="date"
                {...register('birthDate')}
              />
              {errors.birthDate && (
                <p className="text-sm text-destructive">{errors.birthDate.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">Genre *</Label>
              <select
                id="gender"
                {...register('gender')}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="MALE">Garçon</option>
                <option value="FEMALE">Fille</option>
                <option value="OTHER">Autre</option>
              </select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="isVeteran" className="flex items-center gap-2 cursor-pointer">
                <input
                  id="isVeteran"
                  type="checkbox"
                  {...register('isVeteran')}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <Award className="w-4 h-4 text-amber-500" />
                Ancien ramasseur (vétéran)
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* Contact */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Contact
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                {...register('email')}
                placeholder="jean.dupont@email.com"
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Téléphone</Label>
              <Input
                id="phone"
                {...register('phone')}
                placeholder="06 12 34 56 78"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phoneFather">Téléphone père</Label>
              <Input
                id="phoneFather"
                {...register('phoneFather')}
                placeholder="06 12 34 56 78"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phoneMother">Téléphone mère</Label>
              <Input
                id="phoneMother"
                {...register('phoneMother')}
                placeholder="06 12 34 56 78"
              />
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
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="address">Adresse</Label>
              <Input
                id="address"
                {...register('address')}
                placeholder="123 rue de la Paix"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="postalCode">Code postal</Label>
              <Input
                id="postalCode"
                {...register('postalCode')}
                placeholder="75001"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">Ville</Label>
              <Input
                id="city"
                {...register('city')}
                placeholder="Paris"
              />
            </div>
          </CardContent>
        </Card>

        {/* Club */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="w-5 h-5" />
              Club & Licence
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="club">Club</Label>
              <Input
                id="club"
                {...register('club')}
                placeholder="Tennis Club Paris"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="licenseNumber">Numéro de licence</Label>
              <Input
                id="licenseNumber"
                {...register('licenseNumber')}
                placeholder="123456"
              />
            </div>
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
          <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="tshirtSize">Taille T-shirt</Label>
              <select
                id="tshirtSize"
                {...register('tshirtSize')}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="">-</option>
                <option value="XS">XS</option>
                <option value="S">S</option>
                <option value="M">M</option>
                <option value="L">L</option>
                <option value="XL">XL</option>
                <option value="XXL">XXL</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="shortSize">Taille Short</Label>
              <select
                id="shortSize"
                {...register('shortSize')}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="">-</option>
                <option value="XS">XS</option>
                <option value="S">S</option>
                <option value="M">M</option>
                <option value="L">L</option>
                <option value="XL">XL</option>
                <option value="XXL">XXL</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tracksuitSize">Taille Survêtement</Label>
              <select
                id="tracksuitSize"
                {...register('tracksuitSize')}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="">-</option>
                <option value="XS">XS</option>
                <option value="S">S</option>
                <option value="M">M</option>
                <option value="L">L</option>
                <option value="XL">XL</option>
                <option value="XXL">XXL</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="shoeSize">Pointure</Label>
              <Input
                id="shoeSize"
                {...register('shoeSize')}
                placeholder="42"
              />
            </div>
          </CardContent>
        </Card>

        {/* Boutons */}
        <div className="flex justify-end gap-4">
          <Link to="/ballkids">
            <Button type="button" variant="outline">
              Annuler
            </Button>
          </Link>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Création...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Créer le ramasseur
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
