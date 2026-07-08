import { Router } from 'express';
import { body, query, validationResult } from 'express-validator';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { parseSpreadsheet } from '../lib/spreadsheet.js';

// Constantes pour remplacer les enums (SQLite ne supporte pas les enums)
const BallkidStatus = {
  PENDING: 'PENDING',
  REGISTERED: 'REGISTERED',
  SELECTED: 'SELECTED',
  RESERVE: 'RESERVE',
  REJECTED: 'REJECTED',
} as const;

const Gender = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  OTHER: 'OTHER',
} as const;

const router = Router();
const normalizeKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

// Configuration multer pour CSV (mémoire)
const uploadCSV = multer({ storage: multer.memoryStorage() });

// Configuration multer pour photos (disque)
const uploadDir = path.join(process.cwd(), 'uploads', 'photos');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storagePhoto = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `ballkid-${uniqueSuffix}${ext}`);
  }
});

// En mode démonstration, on durcit les limites d'upload (défense en profondeur
// contre l'abus de stockage sur une instance publique) : JPG/PNG uniquement, 2 Mo.
const isDemoMode = process.env.DEMO_MODE === 'true';
const allowedPhotoTypes = isDemoMode
  ? ['image/jpeg', 'image/png']
  : ['image/jpeg', 'image/png', 'image/webp'];
const maxPhotoSize = isDemoMode ? 2 * 1024 * 1024 : 5 * 1024 * 1024;

const uploadPhoto = multer({
  storage: storagePhoto,
  limits: { fileSize: maxPhotoSize },
  fileFilter: (req, file, cb) => {
    if (allowedPhotoTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const formats = isDemoMode ? 'JPG ou PNG' : 'JPG, PNG ou WebP';
      cb(new Error(`Type de fichier non autorisé. Utilisez ${formats}.`));
    }
  }
});

// GET /api/ballkids - Liste des ramasseurs
router.get('/', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { 
      tournamentId, 
      status, 
      search,
      excludePending,
      page = '1',
      limit = '50'
    } = req.query;

    const where: any = {};
    
    if (tournamentId) where.tournamentId = tournamentId;
    if (status) where.status = status;
    // Exclure les PENDING si demandé (et pas de filtre status spécifique)
    if (excludePending === 'true' && !status) {
      where.status = { not: BallkidStatus.PENDING };
    }
    if (search) {
      // SQLite: utiliser contains sans mode insensitive (SQLite est case-insensitive par défaut pour ASCII)
      where.OR = [
        { firstName: { contains: search as string } },
        { lastName: { contains: search as string } },
        { email: { contains: search as string } },
      ];
    }

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const [ballkids, total] = await Promise.all([
      prisma.ballkid.findMany({
        where,
        skip,
        take: parseInt(limit as string),
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        include: {
          selectionScores: true,
          trainingScores: true,
          tournamentScores: true,
        },
      }),
      prisma.ballkid.count({ where }),
    ]);

    // Calculer les moyennes pour chaque ballkid
    const ballkidsWithScores = ballkids.map((ballkid: any) => {
      // Moyenne de sélection
      const selectionAvg = ballkid.selectionScores.length > 0
        ? ballkid.selectionScores.reduce((sum: number, s: any) => sum + s.totalScore, 0) / ballkid.selectionScores.length
        : null;
      
      // Moyenne de formation
      const trainingAvg = ballkid.trainingScores.length > 0
        ? ballkid.trainingScores.reduce((sum: number, s: any) => sum + s.totalScore, 0) / ballkid.trainingScores.length
        : null;

      const tournamentScoresByDay = new Map<string, number[]>();
      ballkid.tournamentScores.forEach((score: any) => {
        if (!score.tournamentDayId || score.totalScore == null) return;
        const list = tournamentScoresByDay.get(score.tournamentDayId) || [];
        list.push(score.totalScore);
        tournamentScoresByDay.set(score.tournamentDayId, list);
      });

      const tournamentDayAverages = Array.from(tournamentScoresByDay.values()).map((scores) =>
        scores.reduce((sum, value) => sum + value, 0) / scores.length
      );

      const tournamentAvg = tournamentDayAverages.length > 0
        ? tournamentDayAverages.reduce((sum, value) => sum + value, 0) / tournamentDayAverages.length
        : null;

      const overallParts: number[] = [];
      if (selectionAvg != null) overallParts.push(selectionAvg);
      if (trainingAvg != null) overallParts.push(trainingAvg);
      overallParts.push(...tournamentDayAverages);
      const overallAverage = overallParts.length > 0
        ? overallParts.reduce((sum, value) => sum + value, 0) / overallParts.length
        : null;

      return {
        ...ballkid,
        selectionAverage: selectionAvg,
        trainingAverage: trainingAvg,
        tournamentAverage: tournamentAvg,
        overallAverage,
        // Ne pas exposer les détails des scores dans la liste
        selectionScores: undefined,
        trainingScores: undefined,
        tournamentScores: undefined,
      };
    });

    res.json({
      success: true,
      data: { 
        ballkids: ballkidsWithScores, 
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total,
          pages: Math.ceil(total / parseInt(limit as string)),
        }
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/ballkids/pending - Ramasseurs en attente de validation
router.get('/pending', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { tournamentId } = req.query;

    const ballkids = await prisma.ballkid.findMany({
      where: {
        status: BallkidStatus.PENDING,
        ...(tournamentId ? { tournamentId: tournamentId as string } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: { ballkids } });
  } catch (error) {
    next(error);
  }
});

// GET /api/ballkids/:id - Détail d'un ramasseur
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const ballkid = await prisma.ballkid.findUnique({
      where: { id: req.params.id },
      include: {
        absences: true,
        selectionScores: { include: { details: true } },
        trainingScores: { include: { details: true, trainingSession: true } },
        tournamentScores: { include: { tournamentDay: true } },
        teamAssignments: { include: { team: true, tournamentDay: true } },
      },
    });

    if (!ballkid) {
      throw new AppError('Ramasseur non trouvé', 404);
    }

    res.json({ success: true, data: { ballkid } });
  } catch (error) {
    next(error);
  }
});

// POST /api/ballkids - Créer un ramasseur
router.post(
  '/',
  authenticate,
  requireAdmin,
  [
    body('firstName').notEmpty().withMessage('Prénom requis'),
    body('lastName').notEmpty().withMessage('Nom requis'),
    body('email').isEmail().withMessage('Email invalide'),
    body('birthDate').isISO8601().withMessage('Date de naissance invalide'),
    body('gender').isIn(['MALE', 'FEMALE', 'OTHER']).withMessage('Genre invalide'),
  ],
  async (req: AuthRequest, res: any, next: any) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError(errors.array()[0].msg, 400);
      }

      // Récupérer le tournoi actif si pas de tournamentId fourni
      let tournamentId = req.body.tournamentId;
      if (!tournamentId) {
        const activeTournament = await prisma.tournament.findFirst({
          where: { isActive: true },
        });
        if (!activeTournament) {
          throw new AppError('Aucun tournoi actif. Veuillez créer ou activer un tournoi.', 400);
        }
        tournamentId = activeTournament.id;
      }

      const ballkid = await prisma.ballkid.create({
        data: {
          ...req.body,
          tournamentId,
          birthDate: new Date(req.body.birthDate),
          status: BallkidStatus.REGISTERED,
        },
      });

      res.status(201).json({ success: true, data: { ballkid } });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/ballkids/:id - Modifier un ramasseur
router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const data = { ...req.body };
    
    if (data.birthDate) {
      data.birthDate = new Date(data.birthDate);
    }

    const ballkid = await prisma.ballkid.update({
      where: { id },
      data,
    });

    res.json({ success: true, data: { ballkid } });
  } catch (error) {
    next(error);
  }
});

// PUT /api/ballkids/:id/status - Changer le statut
router.put('/:id/status', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!Object.values(BallkidStatus).includes(status)) {
      throw new AppError('Statut invalide', 400);
    }

    const ballkid = await prisma.ballkid.update({
      where: { id },
      data: { status },
    });

    res.json({ success: true, data: { ballkid } });
  } catch (error) {
    next(error);
  }
});

// POST /api/ballkids/:id/approve - Approuver un ramasseur en attente
router.post('/:id/approve', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const ballkid = await prisma.ballkid.update({
      where: { id: req.params.id },
      data: { status: BallkidStatus.REGISTERED },
    });

    res.json({ success: true, data: { ballkid } });
  } catch (error) {
    next(error);
  }
});

// POST /api/ballkids/:id/reject - Rejeter un ramasseur en attente
router.post('/:id/reject', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const ballkid = await prisma.ballkid.update({
      where: { id: req.params.id },
      data: { status: BallkidStatus.REJECTED },
    });

    res.json({ success: true, data: { ballkid } });
  } catch (error) {
    next(error);
  }
});

// POST /api/ballkids/bulk/status - Changer le statut de plusieurs ramasseurs
router.post('/bulk/status', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError('Liste d\'ids requise', 400);
    }
    if (!Object.values(BallkidStatus).includes(status)) {
      throw new AppError('Statut invalide', 400);
    }
    const result = await prisma.ballkid.updateMany({
      where: { id: { in: ids } },
      data: { status },
    });
    res.json({ success: true, data: { count: result.count } });
  } catch (error) {
    next(error);
  }
});

// POST /api/ballkids/bulk/delete - Supprimer plusieurs ramasseurs
router.post('/bulk/delete', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError('Liste d\'ids requise', 400);
    }
    // Supprimer les photos associées
    const ballkids = await prisma.ballkid.findMany({
      where: { id: { in: ids } },
      select: { photoUrl: true },
    });
    for (const bk of ballkids) {
      if (bk.photoUrl) {
        const photoPath = path.join(process.cwd(), bk.photoUrl);
        if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
      }
    }
    const result = await prisma.ballkid.deleteMany({
      where: { id: { in: ids } },
    });
    res.json({ success: true, data: { count: result.count } });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/ballkids/:id - Supprimer un ramasseur
router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    await prisma.ballkid.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Ramasseur supprimé' });
  } catch (error) {
    next(error);
  }
});

// POST /api/ballkids/import - Import CSV
router.post(
  '/import',
  authenticate,
  requireAdmin,
  uploadCSV.single('file'),
  async (req: AuthRequest, res, next) => {
    try {
      if (!req.file) {
        throw new AppError('Fichier requis (CSV ou Excel)', 400);
      }

      const { tournamentId } = req.body;
      if (!tournamentId) {
        throw new AppError('Tournoi requis', 400);
      }

      const records = await parseSpreadsheet(req.file.buffer, req.file.originalname);

      // Charger les ramasseurs existants pour detection de doublons (avec id pour permettre la mise a jour)
      const existingBallkids = await prisma.ballkid.findMany({
        where: { tournamentId },
        select: { id: true, email: true, firstName: true, lastName: true },
      });
      // Maps email->id et nom|prenom->id : permettent de retrouver l'enregistrement a mettre a jour lors d'un re-import
      const emailToId = new Map<string, string>();
      const nameToId = new Map<string, string>();
      for (const b of existingBallkids) {
        if (b.email) emailToId.set(b.email.toLowerCase(), b.id);
        nameToId.set(`${b.firstName.toLowerCase()}|${b.lastName.toLowerCase()}`, b.id);
      }

      const created: any[] = [];
      const updated: any[] = [];
      const errors: any[] = [];
      const skipped: any[] = [];

      for (const record of records) {
        try {
          const normalizedRecord: Record<string, string> = {};
          for (const [key, value] of Object.entries(record)) {
            normalizedRecord[normalizeKey(key)] = value as string;
          }

          const getField = (keys: string[]) => {
            for (const key of keys) {
              const normalizedKey = normalizeKey(key);
              if (normalizedKey in normalizedRecord) {
                return (normalizedRecord[normalizedKey] || '').toString();
              }
            }
            return '';
          };

          // Recherche « partielle » : renvoie la 1re valeur non vide dont l'en-tete contient un des radicaux.
          // Utile pour le telephone dont les en-tetes varient (Mobile, GSM, Telephone portable, TELEPHONE 1/2/3...).
          const getFieldPartial = (substrings: string[]) => {
            for (const [k, v] of Object.entries(normalizedRecord)) {
              if (!k) continue;
              if (substrings.some((s) => k.includes(s))) {
                const val = (v || '').toString().trim();
                if (val) return val;
              }
            }
            return '';
          };

          const firstName = getField(['prenom', 'prénom', 'firstname', 'firstName', 'first name']).trim();
          const lastName = getField(['nom', 'lastname', 'lastName', 'last name']).trim();
          const email = getField(['email', 'mail']).trim().replace(/;/g, '');

          // Telephone : d'abord les en-tetes connus, sinon fallback sur un match partiel de l'en-tete.
          let phone = getField(['telephone', 'téléphone', 'phone', 'telephone 1', 'telephone 2', 'telephone 3', 'tel', 'portable']).trim().replace(/;/g, '');
          if (!phone) {
            phone = getFieldPartial(['tel', 'phone', 'mobile', 'gsm', 'portable']).replace(/;/g, '').trim();
          }
          // Restaurer le 0 initial perdu quand Excel stocke le numero comme un nombre (ex: 651904945 -> 0651904945).
          if (/^\d{9}$/.test(phone)) {
            phone = '0' + phone;
          }

          // Validation: nom et prenom obligatoires
          if (!firstName || !lastName) {
            errors.push({ record, error: 'Nom et prenom obligatoires' });
            continue;
          }
          // Validation: email ou telephone, au moins un
          if (!email && !phone) {
            errors.push({ record, error: 'Email ou telephone obligatoire' });
            continue;
          }

          const nameKey = `${firstName.toLowerCase()}|${lastName.toLowerCase()}`;

          // Champs optionnels (contact + tailles de vetements). Reutilises en creation ET en mise a jour.
          const address = getField(['adresse', 'address']).trim();
          const postalCodeRaw = getField(['codePostal', 'codepostal', 'postalCode', 'postal code', 'cp', 'code postal']).trim();
          // Remettre le 0 initial si code postal francais a 4 chiffres
          const postalCode = postalCodeRaw ? (postalCodeRaw.length === 4 ? '0' + postalCodeRaw : postalCodeRaw) : '';
          const city = getField(['ville', 'city']).trim();
          const club = getField(['club']).trim();
          const licenseNumber = getField(['licence', 'license', 'licenseNumber', 'numeroLicence', 'n° licence', 'numero licence']).trim();
          const tshirtSize = getField(['tailleTshirt', 'tailletshirt', 'tshirtSize', 't-shirt']).trim();
          const shortSize = getField(['tailleShort', 'tailleshort', 'shortSize']).trim();
          const tracksuitSize = getField(['tailleSurvetement', 'taillesurvetement', 'tracksuitSize']).trim();
          const shoeSize = getField(['pointure', 'shoeSize']).trim();

          // Re-import : si le ramasseur existe deja (par email ou par nom+prenom), on MET A JOUR
          // les champs fournis (telephone, tailles de vetements...) au lieu de simplement ignorer la ligne.
          // `|| undefined` : ne jamais ecraser une valeur existante avec une chaine vide.
          const existingId = (email && emailToId.get(email.toLowerCase())) || nameToId.get(nameKey);
          if (existingId) {
            const ballkid = await prisma.ballkid.update({
              where: { id: existingId },
              data: {
                phone: phone || undefined,
                address: address || undefined,
                postalCode: postalCode || undefined,
                city: city || undefined,
                club: club || undefined,
                licenseNumber: licenseNumber || undefined,
                tshirtSize: tshirtSize || undefined,
                shortSize: shortSize || undefined,
                tracksuitSize: tracksuitSize || undefined,
                shoeSize: shoeSize || undefined,
              },
            });
            updated.push(ballkid);
            continue;
          }

          const ballkid = await prisma.ballkid.create({
            data: {
              tournamentId,
              firstName,
              lastName,
              email: email || '',
              birthDate: parseBirthDate(getField(['dateNaissance', 'datenaissance', 'birthDate', 'birth date', 'age', 'date de naissance', 'ne(e)', 'nee'])),
              gender: mapGender(getField(['sexe', 'genre', 'gender'])),
              phone: phone || null,
              address: address || null,
              postalCode: postalCode || null,
              city: city || null,
              club: club || null,
              licenseNumber: licenseNumber || null,
              tshirtSize: tshirtSize || null,
              shortSize: shortSize || null,
              tracksuitSize: tracksuitSize || null,
              shoeSize: shoeSize || null,
              status: BallkidStatus.PENDING,
            },
          });
          created.push(ballkid);

          // Ajouter aux maps pour eviter les doublons dans le meme fichier
          if (email) emailToId.set(email.toLowerCase(), ballkid.id);
          nameToId.set(nameKey, ballkid.id);
        } catch (err: any) {
          errors.push({ record, error: err.message });
        }
      }

      res.json({
        success: true,
        data: {
          imported: created.length,
          updated: updated.length,
          skipped: skipped.length,
          errors: errors.length,
          skippedDetails: skipped,
          errorDetails: errors,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

function parseBirthDate(value: string): Date {
  if (!value) return new Date('2010-01-01');
  // Already ISO format (from spreadsheet parser): 2012-03-15
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return new Date(value);
  // French format: 15/03/2012 or 15-03-2012
  const frMatch = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (frMatch) return new Date(`${frMatch[3]}-${frMatch[2].padStart(2, '0')}-${frMatch[1].padStart(2, '0')}`);
  // Try as-is
  const d = new Date(value);
  return isNaN(d.getTime()) ? new Date('2010-01-01') : d;
}

function mapGender(value: string): string {
  const v = value?.toLowerCase();
  if (v === 'm' || v === 'masculin' || v === 'male' || v === 'garçon') return Gender.MALE;
  if (v === 'f' || v === 'féminin' || v === 'female' || v === 'fille') return Gender.FEMALE;
  return Gender.OTHER;
}

// POST /api/ballkids/photos/bulk - Import photos en masse (MUST be before /:id/photo)
router.post(
  '/photos/bulk',
  authenticate,
  requireAdmin,
  uploadPhoto.array('photos', 200),
  async (req: AuthRequest, res, next) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        throw new AppError('Aucune photo fournie', 400);
      }

      // Récupérer tous les ramasseurs du tournoi actif
      const tournament = await prisma.tournament.findFirst({ where: { isActive: true } });
      if (!tournament) {
        files.forEach(f => fs.unlinkSync(f.path));
        throw new AppError('Aucun tournoi actif', 404);
      }

      const ballkids = await prisma.ballkid.findMany({
        where: { tournamentId: tournament.id },
        select: { id: true, firstName: true, lastName: true, photoUrl: true },
      });

      // Créer un index normalisé pour le matching
      const ballkidIndex = new Map<string, typeof ballkids[0]>();
      for (const bk of ballkids) {
        const key1 = normalizeKey(`${bk.lastName} ${bk.firstName}`);
        const key2 = normalizeKey(`${bk.firstName} ${bk.lastName}`);
        if (!ballkidIndex.has(key1)) ballkidIndex.set(key1, bk);
        if (!ballkidIndex.has(key2)) ballkidIndex.set(key2, bk);
      }

      const matched: { filename: string; ballkidName: string }[] = [];
      const notFound: string[] = [];
      const duplicates: string[] = [];
      const alreadyAssigned = new Set<string>();

      for (const file of files) {
        const baseName = path.basename(file.originalname, path.extname(file.originalname));
        const normalized = normalizeKey(baseName.replace(/[_\-]/g, ' '));

        const bk = ballkidIndex.get(normalized);

        if (!bk) {
          notFound.push(file.originalname);
          fs.unlinkSync(file.path);
          continue;
        }

        if (alreadyAssigned.has(bk.id)) {
          duplicates.push(file.originalname);
          fs.unlinkSync(file.path);
          continue;
        }

        if (bk.photoUrl) {
          const oldPath = path.join(process.cwd(), bk.photoUrl);
          if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
          }
        }

        const photoUrl = `/uploads/photos/${file.filename}`;
        await prisma.ballkid.update({
          where: { id: bk.id },
          data: { photoUrl },
        });

        alreadyAssigned.add(bk.id);
        matched.push({ filename: file.originalname, ballkidName: `${bk.lastName} ${bk.firstName}` });
      }

      res.json({
        success: true,
        data: {
          matched: matched.length,
          notFound: notFound.length,
          duplicates: duplicates.length,
          details: { matched, notFound, duplicates },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/ballkids/:id/photo - Upload photo
router.post(
  '/:id/photo',
  authenticate,
  requireAdmin,
  uploadPhoto.single('photo'),
  async (req: AuthRequest, res, next) => {
    try {
      if (!req.file) {
        throw new AppError('Photo requise', 400);
      }

      const { id } = req.params;

      const existing = await prisma.ballkid.findUnique({ where: { id } });
      if (!existing) {
        fs.unlinkSync(req.file.path);
        throw new AppError('Ramasseur non trouvé', 404);
      }

      if (existing.photoUrl) {
        const oldPath = path.join(process.cwd(), existing.photoUrl);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }

      const photoUrl = `/uploads/photos/${req.file.filename}`;
      const ballkid = await prisma.ballkid.update({
        where: { id },
        data: { photoUrl },
      });

      res.json({ success: true, data: { ballkid, photoUrl } });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/ballkids/:id/photo - Supprimer photo
router.delete('/:id/photo', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    
    const existing = await prisma.ballkid.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Ramasseur non trouvé', 404);
    }

    if (existing.photoUrl) {
      const photoPath = path.join(process.cwd(), existing.photoUrl);
      if (fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
    }

    const ballkid = await prisma.ballkid.update({
      where: { id },
      data: { photoUrl: null },
    });

    res.json({ success: true, data: { ballkid } });
  } catch (error) {
    next(error);
  }
});

export default router;
