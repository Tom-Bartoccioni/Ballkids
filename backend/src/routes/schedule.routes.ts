import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse';
import { Readable } from 'stream';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, requireAdmin, requireCoachOrAdmin, AuthRequest } from '../middleware/auth.js';

// Constante pour remplacer l'enum (SQLite ne supporte pas les enums)
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

// GET /api/schedule/:tournamentId - Planning complet du tournoi
router.get('/:tournamentId', authenticate, async (req, res, next) => {
  try {
    const days = await prisma.tournamentDay.findMany({
      where: { tournamentId: req.params.tournamentId },
      orderBy: { dayNumber: 'asc' },
      include: {
        courts: { orderBy: { order: 'asc' } },
        coachAssignments: {
          include: {
            coach: { include: { user: true } },
            court: true,
          },
        },
        _count: { select: { absences: true } },
      },
    });

    res.json({ success: true, data: { days } });
  } catch (error) {
    next(error);
  }
});

// GET /api/schedule/:tournamentId/day/:dayNumber - Détail d'un jour
router.get('/:tournamentId/day/:dayNumber', authenticate, async (req, res, next) => {
  try {
    const day = await prisma.tournamentDay.findUnique({
      where: {
        tournamentId_dayNumber: {
          tournamentId: req.params.tournamentId,
          dayNumber: parseInt(req.params.dayNumber),
        },
      },
      include: {
        courts: {
          orderBy: { order: 'asc' },
          include: {
            courtTeams: {
              include: {
                team: {
                  include: {
                    assignments: {
                      include: {
                        ballkid: {
                          include: {
                            selectionScores: true,
                            trainingScores: true,
                            tournamentScores: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
              orderBy: { order: 'asc' },
            },
            coachAssignments: {
              include: { coach: { include: { user: true } } },
            },
          },
        },
        teamAssignments: {
          include: { ballkid: true, team: true },
        },
        absences: { include: { ballkid: true } },
        teamCaptains: {
          include: { ballkid: true, team: true },
        },
        tournamentScores: {
          include: {
            ballkid: true,
          },
        },
      },
    });

    if (!day) {
      throw new AppError('Jour non trouvé', 404);
    }

    if (day?.courts) {
      const computeOverallAverage = (ballkid: any) => {
        const selectionAvg = ballkid.selectionScores?.length
          ? ballkid.selectionScores.reduce((sum: number, s: any) => sum + (s.totalScore || 0), 0) /
            ballkid.selectionScores.length
          : null
        const trainingAvg = ballkid.trainingScores?.length
          ? ballkid.trainingScores.reduce((sum: number, s: any) => sum + (s.totalScore || 0), 0) /
            ballkid.trainingScores.length
          : null
        const tournamentScoresByDay = new Map<string, number[]>()
        ballkid.tournamentScores?.forEach((score: any) => {
          if (!score.tournamentDayId || score.totalScore == null) return
          const list = tournamentScoresByDay.get(score.tournamentDayId) || []
          list.push(score.totalScore)
          tournamentScoresByDay.set(score.tournamentDayId, list)
        })
        const tournamentDayAverages = Array.from(tournamentScoresByDay.values()).map((scores) =>
          scores.reduce((sum, value) => sum + value, 0) / scores.length
        )
        const parts: number[] = []
        if (selectionAvg != null) parts.push(selectionAvg)
        if (trainingAvg != null) parts.push(trainingAvg)
        parts.push(...tournamentDayAverages)
        return parts.length > 0 ? parts.reduce((sum, value) => sum + value, 0) / parts.length : null
      }

      day.courts.forEach((court: any) => {
        court.courtTeams?.forEach((ct: any) => {
          ct.team?.assignments?.forEach((assignment: any) => {
            const ballkid = assignment.ballkid
            if (!ballkid) return
            ballkid.overallAverage = computeOverallAverage(ballkid)
            delete ballkid.selectionScores
            delete ballkid.trainingScores
            delete ballkid.tournamentScores
          })
        })
      })
    }

    res.json({ success: true, data: { day } });
  } catch (error) {
    next(error);
  }
});

// POST /api/schedule/:tournamentId/day - Créer/configurer un jour
router.post(
  '/:tournamentId/day',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { dayNumber, date, ballkidCount, courts } = req.body;
      const tournamentId = req.params.tournamentId;

      // Vérifier si le jour existe déjà
      const existingDay = await prisma.tournamentDay.findUnique({
        where: {
          tournamentId_dayNumber: { tournamentId, dayNumber },
        },
      });

      // Si c'est un nouveau jour (pas une mise à jour), chercher le jour précédent pour copier sa config
      let previousDayConfig = null;
      if (!existingDay && dayNumber > 1) {
        previousDayConfig = await prisma.tournamentDay.findUnique({
          where: {
            tournamentId_dayNumber: { tournamentId, dayNumber: dayNumber - 1 },
          },
          include: {
            courts: {
              orderBy: { order: 'asc' },
              include: {
                courtTeams: { orderBy: { order: 'asc' } },
                coachAssignments: true,
              },
            },
          },
        });
      }

      const day = await prisma.tournamentDay.upsert({
        where: {
          tournamentId_dayNumber: { tournamentId, dayNumber },
        },
        update: {
          date: new Date(date),
          ballkidCount,
        },
        create: {
          tournamentId,
          dayNumber,
          date: new Date(date),
          ballkidCount,
        },
      });

      // Si c'est un nouveau jour et qu'on a une config du jour précédent, la copier
      if (!existingDay && previousDayConfig && previousDayConfig.courts.length > 0) {
        const shouldCopyTeams = previousDayConfig.ballkidCount === ballkidCount;
        for (const prevCourt of previousDayConfig.courts) {
          // Créer le terrain
          const newCourt = await prisma.court.create({
            data: {
              tournamentDayId: day.id,
              name: prevCourt.name,
              teamCount: prevCourt.teamCount,
              order: prevCourt.order,
            },
          });

          // Copier les équipes assignées seulement si le volume ne change pas
          if (shouldCopyTeams) {
            for (const ct of prevCourt.courtTeams) {
              await prisma.courtTeam.create({
                data: {
                  courtId: newCourt.id,
                  teamId: ct.teamId,
                  order: ct.order,
                },
              });
            }
          }

          // Copier les coachs assignés
          for (const ca of prevCourt.coachAssignments) {
            await prisma.coachAssignment.create({
              data: {
                courtId: newCourt.id,
                tournamentDayId: day.id,
                coachId: ca.coachId,
              },
            });
          }
        }

        if (shouldCopyTeams) {
          const previousAssignments = await prisma.teamAssignment.findMany({
            where: { tournamentDayId: previousDayConfig.id },
          });
          if (previousAssignments.length > 0) {
            await prisma.teamAssignment.createMany({
              data: previousAssignments.map((assignment) => ({
                teamId: assignment.teamId,
                ballkidId: assignment.ballkidId,
                position: assignment.position ?? undefined,
                isReserve: assignment.isReserve,
                tournamentDayId: day.id,
              })),
            });
          }
        }
      } else if (courts && Array.isArray(courts)) {
        // Configurer les terrains si fournis explicitement
        // Supprimer les anciens terrains
        await prisma.court.deleteMany({ where: { tournamentDayId: day.id } });

        // Créer les nouveaux
        for (let i = 0; i < courts.length; i++) {
          await prisma.court.create({
            data: {
              tournamentDayId: day.id,
              name: courts[i].name,
              teamCount: courts[i].teamCount || 1,
              order: i + 1,
            },
          });
        }
      }


      const updatedDay = await prisma.tournamentDay.findUnique({
        where: { id: day.id },
        include: { courts: { orderBy: { order: 'asc' } } },
      });

      res.json({ success: true, data: { day: updatedDay } });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/schedule/:tournamentId/day/:dayNumber
router.put(
  '/:tournamentId/day/:dayNumber',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { date, ballkidCount } = req.body;

      const day = await prisma.tournamentDay.update({
        where: {
          tournamentId_dayNumber: {
            tournamentId: req.params.tournamentId,
            dayNumber: parseInt(req.params.dayNumber),
          },
        },
        data: {
          ...(date && { date: new Date(date) }),
          ...(ballkidCount && { ballkidCount }),
        },
      });

      res.json({ success: true, data: { day } });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/schedule/:tournamentId/day/:dayNumber - Supprimer un jour
router.delete(
  '/:tournamentId/day/:dayNumber',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const day = await prisma.tournamentDay.findUnique({
        where: {
          tournamentId_dayNumber: {
            tournamentId: req.params.tournamentId,
            dayNumber: parseInt(req.params.dayNumber),
          },
        },
      });

      if (!day) {
        throw new AppError('Jour non trouvé', 404);
      }

      // Supprimer le jour (cascade supprimera courts, assignments, etc.)
      await prisma.tournamentDay.delete({
        where: { id: day.id },
      });

      res.json({ success: true, message: 'Jour supprimé' });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/schedule/:tournamentId/day/:dayNumber/court - Ajouter un terrain
router.post(
  '/:tournamentId/day/:dayNumber/court',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { name, teamCount = 1 } = req.body;

      const day = await prisma.tournamentDay.findUnique({
        where: {
          tournamentId_dayNumber: {
            tournamentId: req.params.tournamentId,
            dayNumber: parseInt(req.params.dayNumber),
          },
        },
        include: { courts: true },
      });

      if (!day) {
        throw new AppError('Jour non trouvé', 404);
      }

      const court = await prisma.court.create({
        data: {
          tournamentDayId: day.id,
          name,
          teamCount,
          order: day.courts.length + 1,
        },
      });

      res.json({ success: true, data: { court } });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/schedule/:tournamentId/day/:dayNumber/courts/apply-to-all
// Applique les terrains du jour source a TOUS les autres jours du tournoi.
// Demande admin : "changement courts pas possible pour la semaine, a faire jour/jour".
// Par ordre : un terrain existant au meme rang est mis a jour (nom, nb d'equipes),
// sinon cree. On ne supprime JAMAIS : supprimer un terrain effacerait en cascade
// ses affectations de coachs et d'equipes.
router.post(
  '/:tournamentId/day/:dayNumber/courts/apply-to-all',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const tournamentId = req.params.tournamentId;
      const dayNumber = parseInt(req.params.dayNumber);

      const source = await prisma.tournamentDay.findUnique({
        where: { tournamentId_dayNumber: { tournamentId, dayNumber } },
        include: { courts: { orderBy: { order: 'asc' } } },
      });
      if (!source) {
        throw new AppError('Jour non trouvé', 404);
      }

      const otherDays = await prisma.tournamentDay.findMany({
        where: { tournamentId, id: { not: source.id } },
        include: { courts: true },
      });

      let updated = 0;
      let created = 0;
      await prisma.$transaction(async (tx) => {
        for (const day of otherDays) {
          const byOrder = new Map(day.courts.map((c) => [c.order, c]));
          for (const src of source.courts) {
            const existing = byOrder.get(src.order);
            if (existing) {
              if (existing.name !== src.name || existing.teamCount !== src.teamCount) {
                await tx.court.update({ where: { id: existing.id }, data: { name: src.name, teamCount: src.teamCount } });
                updated++;
              }
            } else {
              await tx.court.create({
                data: { tournamentDayId: day.id, name: src.name, teamCount: src.teamCount, order: src.order },
              });
              created++;
            }
          }
        }
      });

      res.json({ success: true, data: { updated, created } });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/schedule/court/:courtId - Supprimer un terrain
router.delete('/court/:courtId', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await prisma.court.delete({ where: { id: req.params.courtId } });
    res.json({ success: true, message: 'Terrain supprimé' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/schedule/court/:courtId - Modifier un terrain
router.put('/court/:courtId', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { name, teamCount } = req.body;
    
    const court = await prisma.court.update({
      where: { id: req.params.courtId },
      data: {
        ...(name && { name }),
        ...(teamCount !== undefined && { teamCount }),
      },
    });
    
    res.json({ success: true, data: { court } });
  } catch (error) {
    next(error);
  }
});

// PUT /api/schedule/court/:courtId/teams - Assigner des équipes à un terrain
router.put('/court/:courtId/teams', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { teamIds } = req.body; // Array de team IDs
    
    // Supprimer les anciennes assignations
    await prisma.courtTeam.deleteMany({
      where: { courtId: req.params.courtId },
    });
    
    // Créer les nouvelles assignations
    if (teamIds && Array.isArray(teamIds)) {
      for (let i = 0; i < teamIds.length; i++) {
        await prisma.courtTeam.create({
          data: {
            courtId: req.params.courtId,
            teamId: teamIds[i],
            order: i + 1,
          },
        });
      }
    }
    
    // Récupérer le terrain avec les nouvelles équipes
    const court = await prisma.court.findUnique({
      where: { id: req.params.courtId },
      include: {
        courtTeams: {
          include: {
            court: true,
          },
          orderBy: { order: 'asc' },
        },
      },
    });
    
    res.json({ success: true, data: { court } });
  } catch (error) {
    next(error);
  }
});

// POST /api/schedule/:tournamentId/day/:dayNumber/absence - Marquer une absence tournoi
router.post(
  '/:tournamentId/day/:dayNumber/absence',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { ballkidId, reason } = req.body;

      const day = await prisma.tournamentDay.findUnique({
        where: {
          tournamentId_dayNumber: {
            tournamentId: req.params.tournamentId,
            dayNumber: parseInt(req.params.dayNumber),
          },
        },
      });

      if (!day) {
        throw new AppError('Jour non trouvé', 404);
      }

      const absence = await prisma.absence.create({
        data: {
          ballkidId,
          type: AbsenceType.TOURNAMENT,
          date: day.date,
          reason,
          tournamentDayId: day.id,
        },
      });

      res.json({ success: true, data: { absence } });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/schedule/:tournamentId/day/:dayNumber/score-simple - Note tournoi (admin/coach)
router.post(
  '/:tournamentId/day/:dayNumber/score-simple',
  authenticate,
  requireCoachOrAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { ballkidId, score } = req.body;
      const scorerId = req.user!.id;

      if (typeof score !== 'number' || Number.isNaN(score) || score < 0) {
        throw new AppError('La note doit être un nombre positif', 400);
      }

      const day = await prisma.tournamentDay.findUnique({
        where: {
          tournamentId_dayNumber: {
            tournamentId: req.params.tournamentId,
            dayNumber: parseInt(req.params.dayNumber),
          },
        },
      });

      if (!day) {
        throw new AppError('Jour non trouvé', 404);
      }

      const tournamentScore = await prisma.tournamentScore.upsert({
        where: {
          tournamentDayId_ballkidId_scorerId: {
            tournamentDayId: day.id,
            ballkidId,
            scorerId,
          },
        },
        update: { totalScore: score },
        create: {
          tournamentDayId: day.id,
          ballkidId,
          scorerId,
          totalScore: score,
        },
      });

      const ballkid = await prisma.ballkid.findUnique({
        where: { id: ballkidId },
        include: {
          selectionScores: true,
          trainingScores: true,
          tournamentScores: true,
        },
      });

      const computeOverallAverage = (target: any) => {
        const selectionAvg = target.selectionScores?.length
          ? target.selectionScores.reduce((sum: number, s: any) => sum + (s.totalScore || 0), 0) /
            target.selectionScores.length
          : null;
        const trainingAvg = target.trainingScores?.length
          ? target.trainingScores.reduce((sum: number, s: any) => sum + (s.totalScore || 0), 0) /
            target.trainingScores.length
          : null;
        const tournamentScoresByDay = new Map<string, number[]>();
        target.tournamentScores?.forEach((s: any) => {
          if (!s.tournamentDayId || s.totalScore == null) return;
          const list = tournamentScoresByDay.get(s.tournamentDayId) || [];
          list.push(s.totalScore);
          tournamentScoresByDay.set(s.tournamentDayId, list);
        });
        const tournamentDayAverages = Array.from(tournamentScoresByDay.values()).map((scores) =>
          scores.reduce((sum, value) => sum + value, 0) / scores.length
        );
        const parts: number[] = [];
        if (selectionAvg != null) parts.push(selectionAvg);
        if (trainingAvg != null) parts.push(trainingAvg);
        parts.push(...tournamentDayAverages);
        return parts.length > 0 ? parts.reduce((sum, value) => sum + value, 0) / parts.length : null;
      };

      const overallAverage = ballkid ? computeOverallAverage(ballkid) : null;

      res.json({ success: true, data: { tournamentScore, overallAverage } });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/schedule/:tournamentId/day/:dayNumber/score-simple/:ballkidId - Supprimer note tournoi (admin/coach)
router.delete(
  '/:tournamentId/day/:dayNumber/score-simple/:ballkidId',
  authenticate,
  requireCoachOrAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const day = await prisma.tournamentDay.findUnique({
        where: {
          tournamentId_dayNumber: {
            tournamentId: req.params.tournamentId,
            dayNumber: parseInt(req.params.dayNumber),
          },
        },
      });

      if (!day) {
        throw new AppError('Jour non trouvé', 404);
      }

      const deleteResult = await prisma.tournamentScore.deleteMany({
        where: {
          tournamentDayId: day.id,
          ballkidId: req.params.ballkidId,
          scorerId: req.user!.id,
        },
      });

      const ballkid = await prisma.ballkid.findUnique({
        where: { id: req.params.ballkidId },
        include: {
          selectionScores: true,
          trainingScores: true,
          tournamentScores: true,
        },
      });

      const computeOverallAverage = (target: any) => {
        const selectionAvg = target.selectionScores?.length
          ? target.selectionScores.reduce((sum: number, s: any) => sum + (s.totalScore || 0), 0) /
            target.selectionScores.length
          : null;
        const trainingAvg = target.trainingScores?.length
          ? target.trainingScores.reduce((sum: number, s: any) => sum + (s.totalScore || 0), 0) /
            target.trainingScores.length
          : null;
        const tournamentScoresByDay = new Map<string, number[]>();
        target.tournamentScores?.forEach((s: any) => {
          if (!s.tournamentDayId || s.totalScore == null) return;
          const list = tournamentScoresByDay.get(s.tournamentDayId) || [];
          list.push(s.totalScore);
          tournamentScoresByDay.set(s.tournamentDayId, list);
        });
        const tournamentDayAverages = Array.from(tournamentScoresByDay.values()).map((scores) =>
          scores.reduce((sum, value) => sum + value, 0) / scores.length
        );
        const parts: number[] = [];
        if (selectionAvg != null) parts.push(selectionAvg);
        if (trainingAvg != null) parts.push(trainingAvg);
        parts.push(...tournamentDayAverages);
        return parts.length > 0 ? parts.reduce((sum, value) => sum + value, 0) / parts.length : null;
      };

      const overallAverage = ballkid ? computeOverallAverage(ballkid) : null;

      res.json({ success: true, data: { deletedCount: deleteResult.count, overallAverage } });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/schedule/:tournamentId/day/:dayNumber/import-csv - Import notes tournoi (admin/coach)
router.post(
  '/:tournamentId/day/:dayNumber/import-csv',
  authenticate,
  requireCoachOrAdmin,
  uploadCSV.single('file'),
  async (req: AuthRequest, res, next) => {
    try {
      if (!req.file) {
        throw new AppError('Fichier CSV requis', 400);
      }

      const tournamentId = req.params.tournamentId;
      const dayNumber = parseInt(req.params.dayNumber);
      const day = await prisma.tournamentDay.findUnique({
        where: {
          tournamentId_dayNumber: {
            tournamentId,
            dayNumber,
          },
        },
      });

      if (!day) {
        throw new AppError('Jour non trouvé', 404);
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
          let firstName = getField(['prenom', 'prénom', 'firstName', 'firstname', 'first name']).trim();
          let lastName = getField(['nom', 'lastName', 'lastname', 'last name']).trim();
          const fullName = (!firstName && lastName) ? lastName : '';
          const scoreRaw = getField(['total', 'score', 'note', 'resultat', 'résultat']);
          const scoreValue = parseFloat(scoreRaw.replace(',', '.'));

          if (Number.isNaN(scoreValue) || scoreValue < 0) {
            throw new AppError('Note invalide (nombre positif attendu)', 400);
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

          const tournamentScore = await prisma.tournamentScore.upsert({
            where: {
              tournamentDayId_ballkidId_scorerId: {
                tournamentDayId: day.id,
                ballkidId,
                scorerId,
              },
            },
            update: { totalScore: scoreValue },
            create: {
              tournamentDayId: day.id,
              ballkidId,
              scorerId,
              totalScore: scoreValue,
            },
          });

          imported.push(tournamentScore);
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

// PUT /api/schedule/:tournamentId/day/:dayNumber/team/:teamId/captain - Définir le capitaine
router.put(
  '/:tournamentId/day/:dayNumber/team/:teamId/captain',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { ballkidId } = req.body as { ballkidId?: string | null };
      const { tournamentId, dayNumber, teamId } = req.params;

      const day = await prisma.tournamentDay.findUnique({
        where: {
          tournamentId_dayNumber: {
            tournamentId,
            dayNumber: parseInt(dayNumber),
          },
        },
      });

      if (!day) {
        throw new AppError('Jour non trouvé', 404);
      }

      const team = await prisma.team.findFirst({
        where: { id: teamId, tournamentId },
      });

      if (!team) {
        throw new AppError('Équipe non trouvée', 404);
      }

      if (!ballkidId) {
        await prisma.teamCaptain.deleteMany({
          where: { teamId, tournamentDayId: day.id },
        });
        res.json({ success: true, data: { captain: null } });
        return;
      }

      const allowed = await prisma.teamAssignment.findFirst({
        where: {
          teamId,
          ballkidId,
          isReserve: false,
          OR: [{ tournamentDayId: day.id }, { tournamentDayId: null }],
        },
      });

      if (!allowed) {
        throw new AppError('Ce ramasseur ne fait pas partie de l\'équipe', 400);
      }

      const captain = await prisma.teamCaptain.upsert({
        where: {
          teamId_tournamentDayId: {
            teamId,
            tournamentDayId: day.id,
          },
        },
        update: { ballkidId },
        create: {
          teamId,
          tournamentDayId: day.id,
          ballkidId,
        },
        include: { ballkid: true, team: true },
      });

      res.json({ success: true, data: { captain } });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/schedule/absence/:absenceId
router.delete('/absence/:absenceId', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await prisma.absence.delete({ where: { id: req.params.absenceId } });
    res.json({ success: true, message: 'Absence supprimée' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/schedule/court/:courtId/coach - Assigner des coachs à un terrain
router.put('/court/:courtId/coach', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { coachIds } = req.body; // Array of coach IDs (or empty array to remove all)
    const courtId = req.params.courtId;

    // Récupérer le terrain pour avoir le tournamentDayId
    const court = await prisma.court.findUnique({
      where: { id: courtId },
      include: { tournamentDay: true },
    });

    if (!court) {
      throw new AppError('Terrain non trouvé', 404);
    }

    // Supprimer toutes les anciennes assignations de coach pour ce terrain
    await prisma.coachAssignment.deleteMany({
      where: { courtId },
    });

    // Créer les nouvelles assignations
    const coachIdArray = Array.isArray(coachIds) ? coachIds : (coachIds ? [coachIds] : []);
    if (coachIdArray.length > 0) {
      await prisma.coachAssignment.createMany({
        data: coachIdArray.map((coachId: string) => ({
          coachId,
          tournamentDayId: court.tournamentDayId,
          courtId,
        })),
      });
    }

    // Retourner le terrain mis à jour
    const updatedCourt = await prisma.court.findUnique({
      where: { id: courtId },
      include: {
        coachAssignments: {
          include: { coach: { include: { user: true } } },
        },
      },
    });

    res.json({ success: true, data: { court: updatedCourt } });
  } catch (error) {
    next(error);
  }
});

export default router;
