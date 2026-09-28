import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse';
import { Readable } from 'stream';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, requireAdmin, requireCoachOrAdmin, AuthRequest } from '../middleware/auth.js';

// Constantes pour remplacer les enums (SQLite ne supporte pas les enums)
const BallkidStatus = {
  PENDING: 'PENDING',
  REGISTERED: 'REGISTERED',
  SELECTED: 'SELECTED',
  RESERVE: 'RESERVE',
  REJECTED: 'REJECTED',
} as const;

const AbsenceType = {
  SELECTION: 'SELECTION',
  TRAINING: 'TRAINING',
  TOURNAMENT: 'TOURNAMENT',
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

// GET /api/training/:tournamentId - Toutes les sessions de formation
router.get('/:tournamentId', authenticate, async (req, res, next) => {
  try {
    const sessions = await prisma.trainingSession.findMany({
      where: { tournamentId: req.params.tournamentId },
      orderBy: { sessionNumber: 'asc' },
      include: {
        criteria: { orderBy: { order: 'asc' } },
        _count: { select: { scores: true, absences: true } },
      },
    });

    res.json({ success: true, data: { sessions } });
  } catch (error) {
    next(error);
  }
});

// GET /api/training/:tournamentId/:sessionNumber - Détail d'une session
router.get('/:tournamentId/:sessionNumber', authenticate, async (req, res, next) => {
  try {
    const session = await prisma.trainingSession.findUnique({
      where: {
        tournamentId_sessionNumber: {
          tournamentId: req.params.tournamentId,
          sessionNumber: parseInt(req.params.sessionNumber),
        },
      },
      include: {
        criteria: { orderBy: { order: 'asc' } },
        scores: {
          include: {
            ballkid: true,
            scorer: { select: { id: true, firstName: true, lastName: true } },
            details: true,
          },
        },
        absences: { include: { ballkid: true } },
      },
    });

    if (!session) {
      throw new AppError('Session de formation non trouvée', 404);
    }

    res.json({ success: true, data: { session } });
  } catch (error) {
    next(error);
  }
});

/**
 * Synthese des seances de formation d'un tournoi : une entree par ramasseur
 * (SELECTED/RESERVE) avec la moyenne par seance, les absences, la moyenne
 * globale et le nombre de seances jouees. Partagee entre l'API et l'export.
 */
export async function computeTrainingSummary(tournamentId: string) {
  const ballkids = await prisma.ballkid.findMany({
    where: {
      tournamentId: tournamentId,
      status: { in: [BallkidStatus.SELECTED, BallkidStatus.RESERVE] },
    },
    include: {
      trainingScores: {
        include: { trainingSession: true },
      },
      absences: {
        where: { type: AbsenceType.TRAINING },
        include: { trainingSession: true },
      },
    },
  });

  // Get all training sessions to include absence info
  const sessions = await prisma.trainingSession.findMany({
    where: { tournamentId: tournamentId },
    include: {
      _count: { select: { scores: true, absences: true } },
    },
  });

  const summary = ballkids.map((b) => {
    const sessionScores: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [] };
    const sessionAbsences: Record<number, boolean> = { 1: false, 2: false, 3: false, 4: false };
    
    b.trainingScores.forEach((score) => {
      const sessionNum = score.trainingSession.sessionNumber;
      if (score.totalScore !== null && score.totalScore !== undefined) {
        sessionScores[sessionNum].push(score.totalScore);
      }
    });

    b.absences.forEach((absence) => {
      if (absence.trainingSession) {
        sessionAbsences[absence.trainingSession.sessionNumber] = true;
      }
    });

    const sessionAverages: Record<number, number | null> = { 1: null, 2: null, 3: null, 4: null };
    Object.entries(sessionScores).forEach(([sessionNum, scores]) => {
      const values = scores as number[];
      if (values.length > 0) {
        sessionAverages[parseInt(sessionNum)] =
          values.reduce((a, b) => a + b, 0) / values.length;
      }
    });

    const validScores = Object.values(sessionAverages).filter((s) => s !== null) as number[];
    const average = validScores.length > 0
      ? validScores.reduce((a, b) => a + b, 0) / validScores.length
      : null;

    return {
      id: b.id,
      firstName: b.firstName,
      lastName: b.lastName,
      photoUrl: b.photoUrl,
      status: b.status,
      session1: sessionAverages[1],
      session2: sessionAverages[2],
      session3: sessionAverages[3],
      session4: sessionAverages[4],
      absent1: sessionAbsences[1],
      absent2: sessionAbsences[2],
      absent3: sessionAbsences[3],
      absent4: sessionAbsences[4],
      average: average ? Math.round(average * 100) / 100 : null,
      sessionsAttended: validScores.length,
    };
  });

  summary.sort((a, b) => (b.average || 0) - (a.average || 0));

  // Compute completion status for each session
  const totalBallkids = ballkids.length;
  const sessionCompletion: Record<number, boolean> = { 1: false, 2: false, 3: false, 4: false };
  
  for (let sessionNum = 1; sessionNum <= 4; sessionNum++) {
    const scoreKey = `session${sessionNum}` as keyof typeof summary[number];
    const absentKey = `absent${sessionNum}` as keyof typeof summary[number];
    
    // Count how many ballkids have a score OR are absent for this session
    const completedCount = summary.filter(
      (item) => item[scoreKey] !== null || item[absentKey] === true
    ).length;
    
    sessionCompletion[sessionNum] = completedCount >= totalBallkids && totalBallkids > 0;
  }

  return { summary, sessionCompletion };
}

// GET /api/training/:tournamentId/summary - Synthèse des 4 séances
router.get('/:tournamentId/summary/all', authenticate, async (req, res, next) => {
  try {
    const { summary, sessionCompletion } = await computeTrainingSummary(req.params.tournamentId);
    res.json({ success: true, data: { summary, sessionCompletion } });
  } catch (error) {
    next(error);
  }
});

// GET /api/training/:tournamentId/:sessionNumber/score/:ballkidId - Récupérer la note d'un ramasseur
router.get('/:tournamentId/:sessionNumber/score/:ballkidId', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const { tournamentId, sessionNumber, ballkidId } = req.params;
    const scorerId = req.user!.id;

    const session = await prisma.trainingSession.findUnique({
      where: {
        tournamentId_sessionNumber: {
          tournamentId,
          sessionNumber: parseInt(sessionNumber),
        },
      },
    });

    if (!session) {
      return res.json({ success: true, data: { score: null } });
    }

    const score = await prisma.trainingScore.findUnique({
      where: {
        trainingSessionId_ballkidId_scorerId: {
          trainingSessionId: session.id,
          ballkidId,
          scorerId,
        },
      },
      include: {
        details: {
          include: { trainingCriteria: true },
        },
      },
    });

    res.json({ success: true, data: { score } });
  } catch (error) {
    next(error);
  }
});

// POST /api/training/:tournamentId/:sessionNumber/score - Soumettre une note
router.post(
  '/:tournamentId/:sessionNumber/score',
  authenticate,
  requireCoachOrAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { ballkidId, scores, isPresent = true } = req.body;
      const scorerId = req.user!.id;

      const session = await prisma.trainingSession.findUnique({
        where: {
          tournamentId_sessionNumber: {
            tournamentId: req.params.tournamentId,
            sessionNumber: parseInt(req.params.sessionNumber),
          },
        },
        include: { criteria: true },
      });

      if (!session) {
        throw new AppError('Session de formation non trouvée', 404);
      }

      // Calculer le total (moyenne pondérée normalisée sur 20)
      let totalScore = 0;
      let totalWeight = 0;
      const criteriaMap = new Map(session.criteria.map((c) => [c.id, c]));

      for (const [criteriaId, value] of Object.entries(scores || {})) {
        const criteria = criteriaMap.get(criteriaId);
        if (criteria && !criteria.isCalculated) {
          const normalizedScore = ((value as number) / criteria.maxScore) * 20;
          totalScore += normalizedScore * criteria.weight;
          totalWeight += criteria.weight;
        }
      }
      
      // Calculer la moyenne pondérée
      totalScore = totalWeight > 0 ? totalScore / totalWeight : 0;

      const trainingScore = await prisma.trainingScore.upsert({
        where: {
          trainingSessionId_ballkidId_scorerId: {
            trainingSessionId: session.id,
            ballkidId,
            scorerId,
          },
        },
        update: { totalScore, isPresent },
        create: {
          trainingSessionId: session.id,
          ballkidId,
          scorerId,
          totalScore,
          isPresent,
        },
      });

      // Upsert des détails
      for (const [criteriaId, value] of Object.entries(scores || {})) {
        await prisma.trainingScoreDetail.upsert({
          where: {
            trainingScoreId_trainingCriteriaId: {
              trainingScoreId: trainingScore.id,
              trainingCriteriaId: criteriaId,
            },
          },
          update: { value: value as number },
          create: {
            trainingScoreId: trainingScore.id,
            trainingCriteriaId: criteriaId,
            value: value as number,
          },
        });
      }

      res.json({ success: true, data: { trainingScore } });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/training/:tournamentId/:sessionNumber/absence - Marquer une absence
router.post(
  '/:tournamentId/:sessionNumber/absence',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { ballkidId, reason } = req.body;

      const session = await prisma.trainingSession.findUnique({
        where: {
          tournamentId_sessionNumber: {
            tournamentId: req.params.tournamentId,
            sessionNumber: parseInt(req.params.sessionNumber),
          },
        },
      });

      if (!session) {
        throw new AppError('Session de formation non trouvée', 404);
      }

      const absence = await prisma.absence.create({
        data: {
          ballkidId,
          type: AbsenceType.TRAINING,
          date: session.date,
          reason,
          trainingSessionId: session.id,
        },
      });

      res.json({ success: true, data: { absence } });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/training/:tournamentId/:sessionNumber/absence/:ballkidId
router.delete(
  '/:tournamentId/:sessionNumber/absence/:ballkidId',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const session = await prisma.trainingSession.findUnique({
        where: {
          tournamentId_sessionNumber: {
            tournamentId: req.params.tournamentId,
            sessionNumber: parseInt(req.params.sessionNumber),
          },
        },
      });

      if (!session) {
        throw new AppError('Session non trouvée', 404);
      }

      await prisma.absence.deleteMany({
        where: {
          ballkidId: req.params.ballkidId,
          trainingSessionId: session.id,
        },
      });

      res.json({ success: true, message: 'Absence supprimée' });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/training/:tournamentId/:sessionNumber/score-simple - Note simple (admin)
router.post(
  '/:tournamentId/:sessionNumber/score-simple',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { ballkidId, score } = req.body;
      const scorerId = req.user!.id;
      const sessionNumber = parseInt(req.params.sessionNumber);

      if (typeof score !== 'number' || score < 0 || score > 20) {
        throw new AppError('La note doit être entre 0 et 20', 400);
      }

      if (sessionNumber < 1 || sessionNumber > 4) {
        throw new AppError('Le numéro de séance doit être entre 1 et 4', 400);
      }

      // Trouver ou créer la session
      let session = await prisma.trainingSession.findUnique({
        where: {
          tournamentId_sessionNumber: {
            tournamentId: req.params.tournamentId,
            sessionNumber,
          },
        },
      });

      if (!session) {
        // Créer la session si elle n'existe pas
        session = await prisma.trainingSession.create({
          data: {
            tournamentId: req.params.tournamentId,
            sessionNumber,
            date: new Date(),
          },
        });
      }

      // Upsert le score
      const trainingScore = await prisma.trainingScore.upsert({
        where: {
          trainingSessionId_ballkidId_scorerId: {
            trainingSessionId: session.id,
            ballkidId,
            scorerId,
          },
        },
        update: { totalScore: score, isPresent: true },
        create: {
          trainingSessionId: session.id,
          ballkidId,
          scorerId,
          totalScore: score,
          isPresent: true,
        },
      });

      // Remove any absence for this ballkid in this session (they're now present with a score)
      await prisma.absence.deleteMany({
        where: {
          ballkidId,
          trainingSessionId: session.id,
        },
      });

      res.json({ success: true, data: { trainingScore } });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/training/:tournamentId/:sessionNumber/import-csv - Import CSV de notes (admin)
router.post(
  '/:tournamentId/:sessionNumber/import-csv',
  authenticate,
  requireAdmin,
  uploadCSV.single('file'),
  async (req: AuthRequest, res, next) => {
    try {
      if (!req.file) {
        throw new AppError('Fichier CSV requis', 400);
      }

      const tournamentId = req.params.tournamentId;
      const sessionNumber = parseInt(req.params.sessionNumber);

      if (sessionNumber < 1 || sessionNumber > 4) {
        throw new AppError('Le numéro de séance doit être entre 1 et 4', 400);
      }

      const headerLine = req.file.buffer.toString('utf8', 0, 1024).split(/\r?\n/)[0] || '';
      const delimiter = headerLine.includes(';') ? ';' : ',';
      const records: any[] = [];
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

      let session = await prisma.trainingSession.findUnique({
        where: {
          tournamentId_sessionNumber: { tournamentId, sessionNumber },
        },
      });

      if (!session) {
        session = await prisma.trainingSession.create({
          data: {
            tournamentId,
            sessionNumber,
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
          const firstName = getField(['prenom', 'prénom', 'firstName', 'firstname', 'first name']).trim();
          const lastName = getField(['nom', 'lastName', 'lastname', 'last name']).trim();
          const fullName = (!firstName && lastName) ? lastName : '';
          const scoreRaw = getField(['total', 'score', 'note', 'resultat', 'résultat']);
          const scoreValue = parseFloat(scoreRaw.replace(',', '.'));

          if (Number.isNaN(scoreValue) || scoreValue < 0 || scoreValue > 20) {
            throw new AppError('Note invalide (0-20)', 400);
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

          const trainingScore = await prisma.trainingScore.upsert({
            where: {
              trainingSessionId_ballkidId_scorerId: {
                trainingSessionId: session.id,
                ballkidId,
                scorerId,
              },
            },
            update: { totalScore: scoreValue, isPresent: true },
            create: {
              trainingSessionId: session.id,
              ballkidId,
              scorerId,
              totalScore: scoreValue,
              isPresent: true,
            },
          });

          imported.push(trainingScore);
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

// PUT /api/training/:tournamentId/criteria - Mettre à jour les critères (admin)
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
      const sessions = await prisma.trainingSession.findMany({
        where: { tournamentId },
      });

      if (sessions.length === 0) {
        throw new AppError('Aucune session de formation', 404);
      }

      await prisma.$transaction(async (tx) => {
        for (const session of sessions) {
          await tx.trainingCriteria.deleteMany({
            where: { trainingSessionId: session.id },
          });

          await tx.trainingCriteria.createMany({
            data: criteria.map((c, index) => ({
              trainingSessionId: session.id,
              name: c.name?.trim(),
              abbreviation: c.abbreviation?.trim() || makeAbbreviation(c.name || ''),
              maxScore: c.maxScore ?? 5,
              weight: c.weight ?? 1,
              isCalculated: false,
              order: index + 1,
            })),
          });
        }
      });

      const updated = await prisma.trainingCriteria.findMany({
        where: { trainingSessionId: sessions[0].id },
        orderBy: { order: 'asc' },
      });

      res.json({ success: true, data: { criteria: updated } });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/training/score/:scoreId - Modifier une note (admin)
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

      const trainingScore = await prisma.trainingScore.update({
        where: { id: req.params.scoreId },
        data: { totalScore: score, isPresent: true },
      });

      res.json({ success: true, data: { trainingScore } });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/training/score/:scoreId - Supprimer une note (admin)
router.delete(
  '/score/:scoreId',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      await prisma.trainingScore.delete({
        where: { id: req.params.scoreId },
      });
      res.json({ success: true, message: 'Note supprimée' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
