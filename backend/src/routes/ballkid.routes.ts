import { Router } from 'express';
import { body, query, validationResult } from 'express-validator';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { parse } from 'csv-parse';
import { Readable } from 'stream';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';

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

const uploadPhoto = multer({
  storage: storagePhoto,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non autorisé. Utilisez JPG, PNG ou WebP.'));
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
        throw new AppError('Fichier CSV requis', 400);
      }

      const { tournamentId } = req.body;
      if (!tournamentId) {
        throw new AppError('Tournoi requis', 400);
      }

      const records: any[] = [];
      const headerLine = req.file.buffer.toString('utf8', 0, 1024).split(/\r?\n/)[0] || '';
      const delimiter = headerLine.includes(';') ? ';' : ',';
      const parser = Readable.from(req.file.buffer).pipe(
        parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
          delimiter,
        })
      );

      for await (const record of parser) {
        records.push(record);
      }

      const created: any[] = [];
      const errors: any[] = [];

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

          // Mapping des colonnes CSV vers les champs BDD
          const ballkid = await prisma.ballkid.create({
            data: {
              tournamentId,
              firstName: getField(['prenom', 'prénom', 'firstname', 'firstName', 'first name']) || '',
              lastName: getField(['nom', 'lastname', 'lastName', 'last name']) || '',
              email: getField(['email', 'mail']) || '',
              birthDate: new Date(getField(['dateNaissance', 'datenaissance', 'birthDate', 'birth date']) || '2010-01-01'),
              gender: mapGender(getField(['sexe', 'genre', 'gender'])),
              phone: getField(['telephone', 'téléphone', 'phone']) || null,
              address: getField(['adresse', 'address']) || null,
              postalCode: getField(['codePostal', 'codepostal', 'postalCode', 'postal code']) || null,
              city: getField(['ville', 'city']) || null,
              club: getField(['club']) || null,
              licenseNumber: getField(['licence', 'license', 'licenseNumber', 'numeroLicence']) || null,
              tshirtSize: getField(['tailleTshirt', 'tailletshirt', 'tshirtSize', 't-shirt']) || null,
              shortSize: getField(['tailleShort', 'tailleshort', 'shortSize']) || null,
              tracksuitSize: getField(['tailleSurvetement', 'taillesurvetement', 'tracksuitSize']) || null,
              shoeSize: getField(['pointure', 'shoeSize']) || null,
              status: BallkidStatus.PENDING,
            },
          });
          created.push(ballkid);
        } catch (err: any) {
          errors.push({ record, error: err.message });
        }
      }

      res.json({
        success: true,
        data: {
          imported: created.length,
          errors: errors.length,
          errorDetails: errors,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

function mapGender(value: string): string {
  const v = value?.toLowerCase();
  if (v === 'm' || v === 'masculin' || v === 'male' || v === 'garçon') return Gender.MALE;
  if (v === 'f' || v === 'féminin' || v === 'female' || v === 'fille') return Gender.FEMALE;
  return Gender.OTHER;
}

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
      
      // Vérifier que le ramasseur existe
      const existing = await prisma.ballkid.findUnique({ where: { id } });
      if (!existing) {
        // Supprimer le fichier uploadé
        fs.unlinkSync(req.file.path);
        throw new AppError('Ramasseur non trouvé', 404);
      }

      // Supprimer l'ancienne photo si elle existe
      if (existing.photoUrl) {
        const oldPath = path.join(process.cwd(), existing.photoUrl);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }

      // Mettre à jour avec le nouveau chemin
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
