import { Router } from 'express';
import { body, query, validationResult } from 'express-validator';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import convertHeic from 'heic-convert';
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

// Sans tournamentId explicite, on se limite au tournoi actif : sinon les listes
// melangent les ramasseurs de toutes les editions.
const resolveTournamentId = async (tournamentId?: unknown) => {
  if (typeof tournamentId === 'string' && tournamentId) return tournamentId;
  const active = await prisma.tournament.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  return active?.id;
};
const normalizeKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

// Cle d'EN-TETE pour l'import : comme normalizeKey, puis suppression de tout ce
// qui n'est pas lettre/chiffre. Ainsi « TAILLE T-SHIRT », « Taille Tshirt » et
// « tailletshirt » designent la meme colonne. Appliquee a l'identique aux
// en-tetes du fichier ET aux alias, pour garantir la symetrie.
const normalizeHeader = (value: string) => normalizeKey(value).replace(/[^a-z0-9]+/g, '');

// Nettoyage minimal d'un numero issu d'un tableur : retire les « ; » parasites,
// et remet le 0 initial perdu quand Excel a stocke le numero comme un nombre
// (ex: 651904945 -> 0651904945). Les espaces internes sont conserves.
const normalizePhone = (raw: string) => {
  const p = (raw || '').toString().replace(/;/g, '').trim();
  return /^\d{9}$/.test(p) ? '0' + p : p;
};

// En-tetes de telephone designant un PARENT / responsable legal, a exclure de
// la recherche partielle du telephone de l'enfant.
// Convention retenue avec l'admin : TEL = enfant, TEL 1 / TEL 2 = responsables legaux.
const PARENT_HEADER = /(pere|mere|parent|legal|responsable|tuteur|^tel(ephone)?[12]$)/;

// Normalise un nom de personne (ou un nom de fichier photo) pour le matching :
// retire les accents, met en minuscules, supprime les suffixes de copie de l'OS
// (ex. \u00ab (1) \u00bb), convertit tout s\u00e9parateur/ponctuation (_ - . ' espaces\u2026) en un
// espace unique. Appliqu\u00e9e \u00e0 l'IDENTIQUE aux cl\u00e9s d'index et aux noms de fichiers
// pour garantir la sym\u00e9trie du matching.
const normalizeName = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // suffixes OS : \u00ab (1) \u00bb, \u00ab (copie) \u00bb
    .replace(/[^a-z0-9]+/g, ' ') // s\u00e9parateurs & ponctuation -> espace
    .replace(/\s+/g, ' ')
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

// Détection HEIC/HEIF (format par défaut des iPhones). Le mimetype envoyé par le
// navigateur est peu fiable (parfois vide) : on regarde aussi l'extension.
const isHeic = (file: { mimetype: string; originalname: string }) =>
  /image\/hei[cf]/i.test(file.mimetype) || /\.hei[cf]$/i.test(file.originalname);

// Hors mode démo, on accepte le HEIC (converti en JPEG à l'arrivée).
const heicAllowed = !isDemoMode;

const uploadPhoto = multer({
  storage: storagePhoto,
  limits: { fileSize: maxPhotoSize },
  fileFilter: (req, file, cb) => {
    if (allowedPhotoTypes.includes(file.mimetype) || (heicAllowed && isHeic(file))) {
      cb(null, true);
    } else {
      const formats = isDemoMode ? 'JPG ou PNG' : 'JPG, PNG, WebP ou HEIC';
      cb(new Error(`Type de fichier non autorisé. Utilisez ${formats}.`));
    }
  }
});

// Convertit sur le disque un fichier HEIC/HEIF en JPEG et met à jour les champs
// multer (path/filename/mimetype). Les navigateurs n'affichant pas le HEIC, la
// conversion garantit que la vignette sera visible. No-op si le fichier n'est
// pas du HEIC.
async function convertHeicFileToJpeg(file: Express.Multer.File): Promise<void> {
  if (!isHeic(file)) return;
  const inputBuffer = await fs.promises.readFile(file.path);
  const output = await convertHeic({ buffer: inputBuffer, format: 'JPEG', quality: 0.9 });
  const newFilename = file.filename.replace(/\.[^.]*$/, '') + '.jpg';
  const newPath = path.join(uploadDir, newFilename);
  await fs.promises.writeFile(newPath, Buffer.from(output));
  if (newPath !== file.path && fs.existsSync(file.path)) {
    await fs.promises.unlink(file.path);
  }
  file.path = newPath;
  file.filename = newFilename;
  file.mimetype = 'image/jpeg';
}

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

    const scopedTournamentId = await resolveTournamentId(tournamentId);
    if (scopedTournamentId) where.tournamentId = scopedTournamentId;
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

    const scopedTournamentId = await resolveTournamentId(tournamentId);

    const ballkids = await prisma.ballkid.findMany({
      where: {
        status: BallkidStatus.PENDING,
        ...(scopedTournamentId ? { tournamentId: scopedTournamentId } : {}),
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

    // Whitelist des champs modifiables : on n'accepte PAS tournamentId, id,
    // createdAt/updatedAt ni les relations (pas de mass-assignment).
    const ALLOWED_FIELDS = [
      'firstName', 'lastName', 'birthDate', 'gender', 'club', 'email',
      'phone', 'phoneFather', 'phoneMother', 'address', 'postalCode', 'city',
      'licenseNumber', 'photoUrl', 'tshirtSize', 'shortSize', 'tracksuitSize',
      'shoeSize', 'status', 'isVeteran',
    ] as const;
    const data: any = {};
    for (const key of ALLOWED_FIELDS) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
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

      // Charger les ramasseurs existants. IDENTITE = nom + prenom (+ date de naissance
      // pour departager les homonymes). L'email n'est PAS une identite : dans la liste
      // reelle de l'admin, des freres et soeurs partagent l'adresse des parents.
      const existingBallkids = await prisma.ballkid.findMany({
        where: { tournamentId },
        select: { id: true, firstName: true, lastName: true, birthDate: true },
      });
      const nameToIds = new Map<string, { id: string; birthDate: Date }[]>();
      const addToIndex = (b: { id: string; firstName: string; lastName: string; birthDate: Date }) => {
        const key = `${normalizeName(b.firstName)}|${normalizeName(b.lastName)}`;
        const list = nameToIds.get(key) ?? [];
        list.push({ id: b.id, birthDate: b.birthDate });
        nameToIds.set(key, list);
      };
      existingBallkids.forEach(addToIndex);

      // Date « inconnue » posee par parseBirthDate quand le fichier n'en fournit pas :
      // compatible avec n'importe quelle date lors du rapprochement.
      const UNKNOWN_BIRTHDATE = new Date('2010-01-01').getTime();
      const sameDay = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

      // En-tetes (normalises) effectivement lus par un getField/getFieldPartial :
      // ce qui reste a la fin est signale a l'utilisateur comme ignore.
      const usedHeaders = new Set<string>();

      const created: any[] = [];
      const updated: any[] = [];
      const errors: any[] = [];
      const skipped: any[] = [];

      for (const record of records) {
        try {
          const normalizedRecord: Record<string, string> = {};
          for (const [key, value] of Object.entries(record)) {
            const nk = normalizeHeader(key);
            if (!nk) continue; // en-tete vide ou purement decoratif : colonne inaccessible
            normalizedRecord[nk] = value as string;
          }

          // Recherche exacte : renvoie la 1re valeur non vide parmi des alias d'en-tete.
          const getField = (keys: string[]) => {
            // Un alias present (meme vide) est considere consomme : une case vide
            // ne doit pas faire passer sa colonne pour inconnue.
            for (const key of keys) { const nk = normalizeHeader(key); if (nk in normalizedRecord) usedHeaders.add(nk); }
            for (const key of keys) {
              const nk = normalizeHeader(key);
              if (nk in normalizedRecord && normalizedRecord[nk] !== '') {
                return (normalizedRecord[nk] || '').toString();
              }
            }
            return '';
          };

          // Presence d'un en-tete (meme avec valeur vide) : sert a distinguer
          // « colonne absente » de « case vide » pour les booleens.
          const hasField = (keys: string[]) => keys.some((key) => normalizeHeader(key) in normalizedRecord);

          // Recherche « partielle » : 1re valeur non vide dont l'en-tete CONTIENT un des radicaux,
          // en excluant les en-tetes qui matchent `exclude`. Utile pour le telephone dont les
          // en-tetes varient (Mobile, GSM, Telephone portable, TELEPHONE 1/2/3...).
          const getFieldPartial = (substrings: string[], exclude?: RegExp) => {
            for (const [k, v] of Object.entries(normalizedRecord)) {
              if (exclude && exclude.test(k)) continue;
              if (substrings.some((s) => k.includes(s))) {
                const val = (v || '').toString().trim();
                if (val) { usedHeaders.add(k); return val; }
              }
            }
            return '';
          };

          const firstName = getField(['prenom', 'prénom', 'firstname', 'firstName', 'first name']).trim();
          const lastName = getField(['nom', 'lastname', 'lastName', 'last name']).trim();
          const email = getField(['email', 'mail']).trim().replace(/;/g, '');

          // Telephones. Responsables d'abord (alias exacts), puis l'enfant : alias exacts,
          // sinon match partiel en EXCLUANT les en-tetes de parents pour ne jamais
          // attribuer le numero d'un parent a l'enfant.
          const phoneFather = normalizePhone(getField([
            'Téléphone père', 'Tel père', 'Portable père', 'Père',
            'Téléphone parent 1', 'Tel parent 1', 'Parent 1',
            'Téléphone responsable légal 1', 'Tel responsable légal 1', 'Responsable légal 1',
            'Téléphone légal 1', 'Tel légal 1', 'Légal 1', 'Responsable 1', 'Tel responsable 1',
            'Tel 1', 'Téléphone 1',
            'phoneFather',
          ]));
          const phoneMother = normalizePhone(getField([
            'Téléphone mère', 'Tel mère', 'Portable mère', 'Mère',
            'Téléphone parent 2', 'Tel parent 2', 'Parent 2',
            'Téléphone responsable légal 2', 'Tel responsable légal 2', 'Responsable légal 2',
            'Téléphone légal 2', 'Tel légal 2', 'Légal 2', 'Responsable 2', 'Tel responsable 2',
            'Tel 2', 'Téléphone 2',
            'phoneMother',
          ]));
          let phone = normalizePhone(getField([
            'Téléphone', 'Téléphone enfant', 'Tel enfant', 'Portable enfant', 'Téléphone ramasseur',
            'phone', 'Tel', 'Portable', 'Mobile',
          ]));
          if (!phone) {
            phone = normalizePhone(getFieldPartial(['tel', 'phone', 'mobile', 'gsm', 'portable'], PARENT_HEADER));
          }

          // Ancien (a deja participe). On ne touche au flag que si la colonne existe.
          const ancienPresent = hasField(['Ancien', 'Ancienne', 'Vétéran', 'Veteran', 'Déjà participé']);
          const ancienRaw = getField(['Ancien', 'Ancienne', 'Vétéran', 'Veteran', 'Déjà participé']).trim().toLowerCase();
          const isVeteran = ['a', 'oui', 'o', 'x', '1', 'true', 'vrai', 'yes', 'ancien'].includes(ancienRaw);

          // Validation: nom et prenom obligatoires
          if (!firstName || !lastName) {
            errors.push({ record, error: 'Nom et prenom obligatoires' });
            continue;
          }

          const nameKey = `${normalizeName(firstName)}|${normalizeName(lastName)}`;
          const birthDateRaw = getField(['dateNaissance', 'datenaissance', 'birthDate', 'birth date', 'age', 'date de naissance', 'ne(e)', 'nee']).trim();
          const birthDate = birthDateRaw ? parseBirthDate(birthDateRaw) : null;
          const genderRaw = getField(['sexe', 'genre', 'gender']).trim();
          const gender = genderRaw ? mapGender(genderRaw) : null;

          // Rapprochement avec une fiche existante.
          const candidates = nameToIds.get(nameKey) ?? [];
          let existingId: string | undefined;
          if (candidates.length > 0) {
            if (birthDate) {
              existingId = candidates.find((c) => sameDay(c.birthDate, birthDate) || c.birthDate.getTime() === UNKNOWN_BIRTHDATE)?.id;
            } else if (candidates.length === 1) {
              existingId = candidates[0].id;
            } else {
              errors.push({ record, error: `Homonyme ambigu (${candidates.length} fiches « ${lastName} ${firstName} ») : ajoutez la date de naissance` });
              continue;
            }
          }

          // Un contact (email ou telephone) n'est exige que pour CREER une fiche.
          // Un fichier complement (ex: tailles de tenue) ne porte que nom + prenom :
          // il doit pouvoir mettre a jour une fiche existante.
          if (!existingId && !email && !phone) {
            errors.push({ record, error: 'Email ou telephone obligatoire' });
            continue;
          }

          // Champs optionnels (contact + tailles de vetements). Reutilises en creation ET en mise a jour.
          const address = getField(['adresse', 'address']).trim();
          const postalCodeRaw = getField(['codePostal', 'codepostal', 'postalCode', 'postal code', 'cp', 'code postal']).trim();
          // Remettre le 0 initial si code postal francais a 4 chiffres
          const postalCode = postalCodeRaw ? (postalCodeRaw.length === 4 ? '0' + postalCodeRaw : postalCodeRaw) : '';
          const city = getField(['ville', 'city']).trim();
          const club = getField(['club']).trim();
          const licenseNumber = getField(['licence', 'license', 'licenseNumber', 'numeroLicence', 'n° licence', 'numero licence']).trim();
          const tshirtSize = getField(['Taille T-shirt', 'Taille Tshirt', 'tshirtSize', 'T-shirt', 'Tshirt']).trim();
          const shortSize = getField(['Taille Short', 'shortSize', 'Short']).trim();
          const tracksuitSize = getField(['Taille Survêtement', 'Taille Survet', 'tracksuitSize', 'Survêtement', 'Survet']).trim();
          const shoeSize = getField(['Pointure', 'shoeSize', 'Taille chaussures', 'Chaussures']).trim();

          // Re-import : si le ramasseur existe deja (par email ou par nom+prenom), on MET A JOUR
          // les champs fournis (telephone, tailles de vetements...) au lieu de simplement ignorer la ligne.
          // `|| undefined` : ne jamais ecraser une valeur existante avec une chaine vide.
          if (existingId) {
            const ballkid = await prisma.ballkid.update({
              where: { id: existingId },
              data: {
                email: email || undefined,
                birthDate: birthDate || undefined,
                gender: gender || undefined,
                phone: phone || undefined,
                phoneFather: phoneFather || undefined,
                phoneMother: phoneMother || undefined,
                isVeteran: ancienPresent ? isVeteran : undefined,
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
              birthDate: birthDate ?? parseBirthDate(''),
              gender: gender ?? mapGender(''),
              phone: phone || null,
              phoneFather: phoneFather || null,
              phoneMother: phoneMother || null,
              isVeteran,
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

          // Indexer la nouvelle fiche : un doublon strict dans le meme fichier la mettra a jour
          addToIndex(ballkid);
        } catch (err: any) {
          errors.push({ record, error: err.message });
        }
      }

      const unmappedColumns = Object.keys(records[0] ?? {})
        .filter((h) => normalizeHeader(h) && !usedHeaders.has(normalizeHeader(h)));

      res.json({
        success: true,
        data: {
          imported: created.length,
          updated: updated.length,
          skipped: skipped.length,
          errors: errors.length,
          skippedDetails: skipped,
          errorDetails: errors,
          unmappedColumns,
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

      // Index normalisé nom -> ramasseur(s). Une même clé peut viser PLUSIEURS
      // ramasseurs (vrais homonymes, ou paires prénom/nom inversées entre deux
      // personnes) : on les conserve tous pour signaler l'ambiguïté au lieu
      // d'écraser silencieusement — sinon un ramasseur devient inatteignable.
      const ballkidIndex = new Map<string, typeof ballkids>();
      const addKey = (key: string, bk: typeof ballkids[0]) => {
        if (!key) return;
        const existing = ballkidIndex.get(key);
        if (existing) {
          if (!existing.some(e => e.id === bk.id)) existing.push(bk);
        } else {
          ballkidIndex.set(key, [bk]);
        }
      };
      for (const bk of ballkids) {
        addKey(normalizeName(`${bk.lastName} ${bk.firstName}`), bk);
        addKey(normalizeName(`${bk.firstName} ${bk.lastName}`), bk);
      }

      const matched: { filename: string; ballkidName: string }[] = [];
      const notFound: string[] = [];
      const duplicates: string[] = [];
      const ambiguous: { filename: string; candidates: string[] }[] = [];
      const alreadyAssigned = new Set<string>();
      // Fichiers matchés conservés sur disque : à NE PAS supprimer en cas d'erreur.
      const savedPaths = new Set<string>();

      try {
        for (const file of files) {
          // Convertir les photos iPhone (HEIC) en JPEG avant traitement.
          if (isHeic(file)) {
            try {
              await convertHeicFileToJpeg(file);
            } catch {
              notFound.push(file.originalname);
              if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
              continue;
            }
          }

          const baseName = path.basename(file.originalname, path.extname(file.originalname));
          const normalized = normalizeName(baseName);

          const candidates = ballkidIndex.get(normalized);

          if (!candidates || candidates.length === 0) {
            notFound.push(file.originalname);
            fs.unlinkSync(file.path);
            continue;
          }

          if (candidates.length > 1) {
            // Plusieurs ramasseurs portent ce nom : on ne devine pas, on signale.
            ambiguous.push({
              filename: file.originalname,
              candidates: candidates.map(c => `${c.lastName} ${c.firstName}`),
            });
            fs.unlinkSync(file.path);
            continue;
          }

          const bk = candidates[0];

          if (alreadyAssigned.has(bk.id)) {
            duplicates.push(file.originalname);
            fs.unlinkSync(file.path);
            continue;
          }

          // On écrit d'abord la nouvelle URL, puis on supprime l'ancien fichier :
          // ainsi une erreur DB ne détruit jamais la photo existante.
          const photoUrl = `/uploads/photos/${file.filename}`;
          const previousPhotoUrl = bk.photoUrl;
          await prisma.ballkid.update({
            where: { id: bk.id },
            data: { photoUrl },
          });
          savedPaths.add(file.path);

          if (previousPhotoUrl) {
            const oldPath = path.join(process.cwd(), previousPhotoUrl);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
          }

          alreadyAssigned.add(bk.id);
          matched.push({ filename: file.originalname, ballkidName: `${bk.lastName} ${bk.firstName}` });
        }
      } catch (loopError) {
        // Nettoyer les fichiers non traités (orphelins) sans toucher aux photos
        // déjà enregistrées en base.
        for (const f of files) {
          if (!savedPaths.has(f.path) && fs.existsSync(f.path)) {
            try { fs.unlinkSync(f.path); } catch { /* ignore */ }
          }
        }
        throw loopError;
      }

      res.json({
        success: true,
        data: {
          matched: matched.length,
          notFound: notFound.length,
          duplicates: duplicates.length,
          ambiguous: ambiguous.length,
          details: { matched, notFound, duplicates, ambiguous },
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

      // Convertir une photo iPhone (HEIC) en JPEG affichable.
      if (isHeic(req.file)) {
        try {
          await convertHeicFileToJpeg(req.file);
        } catch {
          if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
          throw new AppError('Conversion de la photo HEIC impossible', 400);
        }
      }

      const { id } = req.params;

      const existing = await prisma.ballkid.findUnique({ where: { id } });
      if (!existing) {
        fs.unlinkSync(req.file.path);
        throw new AppError('Ramasseur non trouvé', 404);
      }

      // Écrire la nouvelle URL d'abord, supprimer l'ancien fichier ensuite :
      // une erreur DB ne doit jamais détruire la photo existante.
      const photoUrl = `/uploads/photos/${req.file.filename}`;
      const ballkid = await prisma.ballkid.update({
        where: { id },
        data: { photoUrl },
      });

      if (existing.photoUrl && existing.photoUrl !== photoUrl) {
        const oldPath = path.join(process.cwd(), existing.photoUrl);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }

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
