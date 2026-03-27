import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import multer from 'multer';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, requireAdmin, requireCoachOrAdmin, AuthRequest } from '../middleware/auth.js';
import { parseSpreadsheet, getSheetNames } from '../lib/spreadsheet.js';

// Constante pour remplacer l'enum (SQLite ne supporte pas les enums)
const BallkidStatus = {
  PENDING: 'PENDING',
  REGISTERED: 'REGISTERED',
  SELECTED: 'SELECTED',
  RESERVE: 'RESERVE',
  REJECTED: 'REJECTED',
} as const;

const router = Router();
const uploadCSV = multer({ storage: multer.memoryStorage() });

const normalizeKey = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const makeAbbreviation = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();

// GET /api/selection/:tournamentId - Session de sélection d'un tournoi
router.get('/:tournamentId', authenticate, async (req, res, next) => {
  try {
    const session = await prisma.selectionSession.findUnique({
      where: { tournamentId: req.params.tournamentId },
      include: {
        criteria: { orderBy: { order: 'asc' } },
        scores: {
          include: {
            ballkid: true,
            scorer: { select: { id: true, firstName: true, lastName: true } },
            details: true,
          },
        },
      },
    });

    res.json({ success: true, data: { session } });
  } catch (error) {
    next(error);
  }
});

// GET /api/selection/:tournamentId/ranking - Classement
router.get('/:tournamentId/ranking', authenticate, async (req, res, next) => {
  try {
    const ballkids = await prisma.ballkid.findMany({
      where: {
        tournamentId: req.params.tournamentId,
        status: { in: [BallkidStatus.REGISTERED, BallkidStatus.SELECTED, BallkidStatus.RESERVE] },
      },
      include: {
        selectionScores: {
          include: { details: { include: { selectionCriteria: true } } },
        },
      },
    });

    // Calculer moyenne par ramasseur - ne garder que ceux avec au moins une note
    const ranking = ballkids
      .filter((b) => b.selectionScores.length > 0) // Seulement ceux avec des notes
      .map((b) => {
        const scores = b.selectionScores;
        const avgScore = scores.reduce((sum, s) => sum + (s.totalScore || 0), 0) / scores.length;

        return {
          id: b.id,
          firstName: b.firstName,
          lastName: b.lastName,
          status: b.status,
          averageScore: Math.round(avgScore * 100) / 100,
          scoresCount: scores.length,
        };
      });

    ranking.sort((a, b) => b.averageScore - a.averageScore);
    ranking.forEach((r, i) => (r as any).rank = i + 1);

    res.json({ success: true, data: { ranking } });
  } catch (error) {
    next(error);
  }
});

// GET /api/selection/:tournamentId/score/:ballkidId - Récupérer la note d'un ramasseur
router.get('/:tournamentId/score/:ballkidId', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { tournamentId, ballkidId } = req.params;
    const scorerId = req.user!.id;

    const session = await prisma.selectionSession.findUnique({
      where: { tournamentId },
    });

    if (!session) {
      return res.json({ success: true, data: { score: null } });
    }

    const score = await prisma.selectionScore.findUnique({
      where: {
        selectionSessionId_ballkidId_scorerId: {
          selectionSessionId: session.id,
          ballkidId,
          scorerId,
        },
      },
      include: {
        details: {
          include: { selectionCriteria: true },
        },
      },
    });

    res.json({ success: true, data: { score } });
  } catch (error) {
    next(error);
  }
});

// POST /api/selection/:tournamentId/score-simple - Notation simple (admin)
router.post(
  '/:tournamentId/score-simple',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { ballkidId, score } = req.body;
      const scorerId = req.user!.id;
      const tournamentId = req.params.tournamentId;

      if (score < 0 || score > 20) {
        throw new AppError('La note doit être entre 0 et 20', 400);
      }

      // Trouver ou créer la session de sélection
      let session = await prisma.selectionSession.findUnique({
        where: { tournamentId },
      });

      if (!session) {
        session = await prisma.selectionSession.create({
          data: {
            tournamentId,
            date: new Date(),
          },
        });
      }

      // Upsert du score (remplace si existe déjà pour ce scorer)
      const selectionScore = await prisma.selectionScore.upsert({
        where: {
          selectionSessionId_ballkidId_scorerId: {
            selectionSessionId: session.id,
            ballkidId,
            scorerId,
          },
        },
        update: { totalScore: score },
        create: {
          selectionSessionId: session.id,
          ballkidId,
          scorerId,
          totalScore: score,
        },
      });

      res.json({ success: true, data: { selectionScore } });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/selection/:tournamentId/score - Soumettre une notation
router.post(
  '/:tournamentId/score',
  authenticate,
  requireCoachOrAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { ballkidId, scores } = req.body;
      const scorerId = req.user!.id;

      const session = await prisma.selectionSession.findUnique({
        where: { tournamentId: req.params.tournamentId },
        include: { criteria: true },
      });

      if (!session) {
        throw new AppError('Session de sélection non trouvée', 404);
      }

      // Calculer le total (moyenne pondérée normalisée sur 20)
      let totalScore = 0;
      let totalWeight = 0;
      const criteriaMap = new Map(session.criteria.map((c) => [c.id, c]));

      for (const [criteriaId, value] of Object.entries(scores)) {
        const criteria = criteriaMap.get(criteriaId);
        if (criteria && !criteria.isCalculated) {
          const normalizedScore = ((value as number) / criteria.maxScore) * 20;
          totalScore += normalizedScore * criteria.weight;
          totalWeight += criteria.weight;
        }
      }
      
      // Calculer la moyenne pondérée
      totalScore = totalWeight > 0 ? totalScore / totalWeight : 0;

      // Upsert du score
      const selectionScore = await prisma.selectionScore.upsert({
        where: {
          selectionSessionId_ballkidId_scorerId: {
            selectionSessionId: session.id,
            ballkidId,
            scorerId: scorerId,
          },
        },
        update: { totalScore },
        create: {
          selectionSessionId: session.id,
          ballkidId,
          scorerId: scorerId,
          totalScore,
        },
      });

      // Upsert des détails
      for (const [criteriaId, value] of Object.entries(scores)) {
        await prisma.selectionScoreDetail.upsert({
          where: {
            selectionScoreId_selectionCriteriaId: {
              selectionScoreId: selectionScore.id,
              selectionCriteriaId: criteriaId,
            },
          },
          update: { value: value as number },
          create: {
            selectionScoreId: selectionScore.id,
            selectionCriteriaId: criteriaId,
            value: value as number,
          },
        });
      }

      res.json({ success: true, data: { selectionScore } });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/selection/:tournamentId/import-csv - Import CSV de notes (admin)
router.post(
  '/:tournamentId/import-csv',
  authenticate,
  requireAdmin,
  uploadCSV.single('file'),
  async (req: AuthRequest, res, next) => {
    try {
      if (!req.file) {
        throw new AppError('Fichier requis (CSV ou Excel)', 400);
      }

      const tournamentId = req.params.tournamentId;
      const sheetName = req.body.sheetName || undefined;
      const records = await parseSpreadsheet(req.file.buffer, req.file.originalname, sheetName);

      let session = await prisma.selectionSession.findUnique({
        where: { tournamentId },
      });

      if (!session) {
        session = await prisma.selectionSession.create({
          data: {
            tournamentId,
            date: new Date(),
          },
        });
      }

      const ballkids = await prisma.ballkid.findMany({
        where: { tournamentId },
        select: { id: true, email: true, firstName: true, lastName: true },
      });

      const byEmail = new Map<string, string>();
      const byName = new Map<string, string>();
      const byNameReversed = new Map<string, string>();
      const duplicateNames = new Set<string>();
      const duplicateNamesReversed = new Set<string>();

      for (const b of ballkids) {
        if (b.email) {
          byEmail.set(b.email.toLowerCase(), b.id);
        }
        const key = `${b.firstName} ${b.lastName}`.toLowerCase();
        if (byName.has(key)) {
          duplicateNames.add(key);
        } else {
          byName.set(key, b.id);
        }
        const reverseKey = `${b.lastName} ${b.firstName}`.toLowerCase();
        if (byNameReversed.has(reverseKey)) {
          duplicateNamesReversed.add(reverseKey);
        } else {
          byNameReversed.set(reverseKey, b.id);
        }
      }

      const imported: any[] = [];
      const errors: any[] = [];
      const scorerId = req.user!.id;

      // Pre-scan: detect max score to auto-normalize if scores are not on 0-20 scale
      let maxScoreInFile = 0;
      for (const record of records) {
        const nr: Record<string, string> = {};
        for (const [key, value] of Object.entries(record)) {
          nr[normalizeKey(key)] = value as string;
        }
        const raw = ['total', 'score', 'note', 'resultat', 'resultat'].reduce((v, k) => v || nr[k] || '', '');
        const val = parseFloat((raw || '').toString().replace(',', '.'));
        if (!isNaN(val) && val > maxScoreInFile) maxScoreInFile = val;
      }
      const needsNormalization = maxScoreInFile > 20;

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

          const email = getField(['email', 'mail']).trim().toLowerCase();
          let firstName = getField(['prenom', 'prénom', 'firstName', 'firstname', 'first name']).trim();
          let lastName = getField(['nom', 'lastName', 'lastname', 'last name']).trim();
          const fullName = (!firstName && lastName) ? lastName : '';
          const scoreRaw = getField(['total', 'score', 'note', 'resultat', 'résultat']);
          let scoreValue = parseFloat(scoreRaw.replace(',', '.'));

          if (Number.isNaN(scoreValue) || scoreValue < 0) {
            throw new AppError('Note invalide', 400);
          }

          // Normalize to 0-20 scale if needed
          if (needsNormalization) {
            scoreValue = (scoreValue / maxScoreInFile) * 20;
            scoreValue = Math.round(scoreValue * 100) / 100;
          }

          let ballkidId: string | undefined;
          if (email) {
            ballkidId = byEmail.get(email);
          }
          if (!ballkidId && firstName && lastName) {
            const key = `${firstName} ${lastName}`.toLowerCase();
            if (duplicateNames.has(key)) {
              throw new AppError('Nom/prénom ambigu', 400);
            }
            ballkidId = byName.get(key);
          }
          if (!ballkidId && firstName && lastName) {
            const reverseKey = `${lastName} ${firstName}`.toLowerCase();
            if (duplicateNamesReversed.has(reverseKey)) {
              throw new AppError('Nom/prénom ambigu', 400);
            }
            ballkidId = byNameReversed.get(reverseKey);
          }
          if (!ballkidId && fullName) {
            const key = fullName.toLowerCase();
            const matchByName = byName.get(key);
            const matchByReversed = byNameReversed.get(key);
            if (duplicateNames.has(key) || duplicateNamesReversed.has(key)) {
              throw new AppError('Nom/prénom ambigu', 400);
            }
            if (matchByName && matchByReversed && matchByName !== matchByReversed) {
              throw new AppError('Nom/prénom ambigu', 400);
            }
            ballkidId = matchByName || matchByReversed;
          }

          if (!ballkidId) {
            throw new AppError('Ramasseur introuvable', 404);
          }

          const selectionScore = await prisma.selectionScore.upsert({
            where: {
              selectionSessionId_ballkidId_scorerId: {
                selectionSessionId: session.id,
                ballkidId,
                scorerId,
              },
            },
            update: { totalScore: scoreValue },
            create: {
              selectionSessionId: session.id,
              ballkidId,
              scorerId,
              totalScore: scoreValue,
            },
          });

          imported.push(selectionScore);
        } catch (err: any) {
          errors.push({ record, error: err.message });
        }
      }

      res.json({
        success: true,
        data: {
          imported: imported.length,
          errors: errors.length,
          errorDetails: errors,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/selection/:tournamentId/criteria - Mettre à jour les critères (admin)
router.put(
  '/:tournamentId/criteria',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { criteria } = req.body as {
        criteria: Array<{ name: string; maxScore?: number; weight?: number; abbreviation?: string }>;
      };

      if (!Array.isArray(criteria) || criteria.length === 0) {
        throw new AppError('Liste de critères requise', 400);
      }
      if (criteria.some((c) => !c.name || !c.name.trim())) {
        throw new AppError('Chaque critère doit avoir un nom', 400);
      }

      const tournamentId = req.params.tournamentId;
      let session = await prisma.selectionSession.findUnique({
        where: { tournamentId },
      });

      if (!session) {
        session = await prisma.selectionSession.create({
          data: { tournamentId, date: new Date() },
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.selectionCriteria.deleteMany({
          where: { selectionSessionId: session!.id },
        });

        await tx.selectionCriteria.createMany({
          data: criteria.map((c, index) => ({
            selectionSessionId: session!.id,
            name: c.name?.trim(),
            abbreviation: c.abbreviation?.trim() || makeAbbreviation(c.name || ''),
            maxScore: c.maxScore ?? 5,
            weight: c.weight ?? 1,
            isCalculated: false,
            order: index + 1,
          })),
        });
      });

      const updated = await prisma.selectionCriteria.findMany({
        where: { selectionSessionId: session.id },
        orderBy: { order: 'asc' },
      });

      res.json({ success: true, data: { criteria: updated } });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/selection/score/:scoreId - Modifier une note (admin)
router.put(
  '/score/:scoreId',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { score } = req.body;
      if (typeof score !== 'number' || score < 0 || score > 20) {
        throw new AppError('La note doit être entre 0 et 20', 400);
      }

      const selectionScore = await prisma.selectionScore.update({
        where: { id: req.params.scoreId },
        data: { totalScore: score },
      });

      res.json({ success: true, data: { selectionScore } });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/selection/score/:scoreId - Supprimer une note (admin)
router.delete(
  '/score/:scoreId',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      await prisma.selectionScore.delete({
        where: { id: req.params.scoreId },
      });
      res.json({ success: true, message: 'Note supprimée' });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/selection/:tournamentId/select - Sélectionner les 78 meilleurs + 2 remplaçants
router.post(
  '/:tournamentId/select',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { count = 80, reserveCount = 2 } = req.body;
      const tournamentId = req.params.tournamentId;

      // Récupérer le classement (inclure déjà sélectionnés/remplaçants)
      const ballkids = await prisma.ballkid.findMany({
        where: {
          tournamentId,
          status: { in: [BallkidStatus.REGISTERED, BallkidStatus.SELECTED, BallkidStatus.RESERVE] },
        },
        include: { selectionScores: true },
      });

      const ranking = ballkids.map((b) => {
        const avgScore = b.selectionScores.length > 0
          ? b.selectionScores.reduce((sum, s) => sum + (s.totalScore || 0), 0) / b.selectionScores.length
          : 0;
        return { id: b.id, avgScore };
      });

      ranking.sort((a, b) => b.avgScore - a.avgScore);

      const selectedCount = Math.max(0, count - reserveCount);
      const selectedIds = ranking.slice(0, selectedCount).map((r) => r.id);
      const remaining = ranking.length - selectedIds.length;
      const reserveTake = Math.max(0, Math.min(reserveCount, remaining));
      const reserveIds = ranking.slice(selectedCount, selectedCount + reserveTake).map((r) => r.id);

      await prisma.ballkid.updateMany({
        where: {
          tournamentId,
          status: { in: [BallkidStatus.SELECTED, BallkidStatus.RESERVE] },
          id: { notIn: [...selectedIds, ...reserveIds] },
        },
        data: { status: BallkidStatus.REGISTERED },
      });

      await prisma.ballkid.updateMany({
        where: { id: { in: selectedIds } },
        data: { status: BallkidStatus.SELECTED },
      });

      await prisma.ballkid.updateMany({
        where: { id: { in: reserveIds } },
        data: { status: BallkidStatus.RESERVE },
      });

      // Marquer session comme terminée
      await prisma.selectionSession.update({
        where: { tournamentId },
        data: { isCompleted: true },
      });

      res.json({
        success: true,
        data: { selected: selectedIds.length, reserves: reserveIds.length },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
