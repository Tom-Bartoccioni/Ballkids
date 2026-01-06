import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';

// Constante pour remplacer l'enum (SQLite ne supporte pas les enums)
const BallkidStatus = {
  PENDING: 'PENDING',
  REGISTERED: 'REGISTERED',
  SELECTED: 'SELECTED',
  RESERVE: 'RESERVE',
  REJECTED: 'REJECTED',
} as const;

const router = Router();

// GET /api/teams/:tournamentId - Liste des équipes
router.get('/:tournamentId', authenticate, async (req, res, next) => {
  try {
    const teams = await prisma.team.findMany({
      where: { tournamentId: req.params.tournamentId },
      orderBy: { order: 'asc' },
      include: {
        assignments: {
          where: { tournamentDayId: null }, // Affectation par défaut
          include: { 
            ballkid: {
              include: {
                trainingScores: true,
                selectionScores: true,
                tournamentScores: true,
              },
            },
          },
          orderBy: { position: 'asc' },
        },
      },
    });

    // Deduplicate assignments by ballkidId (keep first occurrence)
    const teamsDeduped = teams.map((team: typeof teams[number]) => {
      const seenBallkids = new Set<string>();
      const uniqueAssignments = team.assignments.filter((assignment) => {
        if (seenBallkids.has(assignment.ballkidId)) {
          return false;
        }
        seenBallkids.add(assignment.ballkidId);
        return true;
      });
      return { ...team, assignments: uniqueAssignments };
    });

    // Calculer la moyenne globale pour chaque ballkid
    const teamsWithAverages = teamsDeduped.map((team: typeof teamsDeduped[number]) => ({
      ...team,
      assignments: team.assignments.map((assignment: typeof team.assignments[number]) => {
        const selectionScores = assignment.ballkid.selectionScores;
        const trainingScores = assignment.ballkid.trainingScores;
        const tournamentScores = assignment.ballkid.tournamentScores;

        const selectionAvg = selectionScores.length > 0
          ? selectionScores.reduce((sum: number, s: typeof selectionScores[number]) => sum + (s.totalScore || 0), 0) / selectionScores.length
          : null;

        const trainingAvg = trainingScores.length > 0
          ? trainingScores.reduce((sum: number, s: typeof trainingScores[number]) => sum + (s.totalScore || 0), 0) / trainingScores.length
          : null;

        const tournamentScoresByDay = new Map<string, number[]>();
        tournamentScores.forEach((score: typeof tournamentScores[number]) => {
          if (!score.tournamentDayId || score.totalScore == null) return;
          const list = tournamentScoresByDay.get(score.tournamentDayId) || [];
          list.push(score.totalScore);
          tournamentScoresByDay.set(score.tournamentDayId, list);
        });

        const tournamentDayAverages = Array.from(tournamentScoresByDay.values()).map((scores) =>
          scores.reduce((sum, value) => sum + value, 0) / scores.length
        );

        const overallParts: number[] = [];
        if (selectionAvg != null) overallParts.push(selectionAvg);
        if (trainingAvg != null) overallParts.push(trainingAvg);
        overallParts.push(...tournamentDayAverages);
        const overallAverage = overallParts.length > 0
          ? overallParts.reduce((sum, value) => sum + value, 0) / overallParts.length
          : null;

        return {
          ...assignment,
          ballkid: {
            ...assignment.ballkid,
            averageTrainingScore: overallAverage,
            overallAverage,
          },
        };
      }),
    }));

    res.json({ success: true, data: { teams: teamsWithAverages } });
  } catch (error) {
    next(error);
  }
});

// GET /api/teams/:tournamentId/day/:dayNumber - Équipes pour un jour donné
router.get('/:tournamentId/day/:dayNumber', authenticate, async (req, res, next) => {
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
      throw new AppError('Jour de tournoi non trouvé', 404);
    }

    const previousDay = day.dayNumber > 1
      ? await prisma.tournamentDay.findUnique({
          where: {
            tournamentId_dayNumber: {
              tournamentId: req.params.tournamentId,
              dayNumber: day.dayNumber - 1,
            },
          },
        })
      : null;

    const shouldUseFallbackAssignments =
      !previousDay || previousDay.ballkidCount === day.ballkidCount;

    const teams = await prisma.team.findMany({
      where: { tournamentId: req.params.tournamentId },
      orderBy: { order: 'asc' },
      include: {
        assignments: {
          where: {
            OR: shouldUseFallbackAssignments
              ? [
                  { tournamentDayId: day.id },
                  { tournamentDayId: null }, // Fallback sur défaut
                ]
              : [{ tournamentDayId: day.id }],
          },
          include: { 
            ballkid: {
              include: {
                trainingScores: true,
                selectionScores: true,
                tournamentScores: true,
              },
            },
          },
          orderBy: { position: 'asc' },
        },
      },
    });

    // Deduplicate: prefer day-specific assignments over default (null) ones
    const teamsDeduped = teams.map((team: typeof teams[number]) => {
      const seenBallkids = new Map<string, typeof team.assignments[number]>();
      for (const assignment of team.assignments) {
        const existing = seenBallkids.get(assignment.ballkidId);
        // Prefer day-specific assignment (tournamentDayId !== null)
        if (!existing || (assignment.tournamentDayId && !existing.tournamentDayId)) {
          seenBallkids.set(assignment.ballkidId, assignment);
        }
      }
      return {
        ...team,
        assignments: Array.from(seenBallkids.values()).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      };
    });

    const teamsWithAverages = teamsDeduped.map((team: typeof teamsDeduped[number]) => ({
      ...team,
      assignments: team.assignments.map((assignment: typeof team.assignments[number]) => {
        const selectionScores = assignment.ballkid.selectionScores;
        const trainingScores = assignment.ballkid.trainingScores;
        const tournamentScores = assignment.ballkid.tournamentScores;

        const selectionAvg = selectionScores.length > 0
          ? selectionScores.reduce((sum: number, s: typeof selectionScores[number]) => sum + (s.totalScore || 0), 0) / selectionScores.length
          : null;

        const trainingAvg = trainingScores.length > 0
          ? trainingScores.reduce((sum: number, s: typeof trainingScores[number]) => sum + (s.totalScore || 0), 0) / trainingScores.length
          : null;

        const tournamentScoresByDay = new Map<string, number[]>();
        tournamentScores.forEach((score: typeof tournamentScores[number]) => {
          if (!score.tournamentDayId || score.totalScore == null) return;
          const list = tournamentScoresByDay.get(score.tournamentDayId) || [];
          list.push(score.totalScore);
          tournamentScoresByDay.set(score.tournamentDayId, list);
        });

        const tournamentDayAverages = Array.from(tournamentScoresByDay.values()).map((scores) =>
          scores.reduce((sum, value) => sum + value, 0) / scores.length
        );

        const overallParts: number[] = [];
        if (selectionAvg != null) overallParts.push(selectionAvg);
        if (trainingAvg != null) overallParts.push(trainingAvg);
        overallParts.push(...tournamentDayAverages);
        const overallAverage = overallParts.length > 0
          ? overallParts.reduce((sum, value) => sum + value, 0) / overallParts.length
          : null;

        return {
          ...assignment,
          ballkid: {
            ...assignment.ballkid,
            averageTrainingScore: overallAverage,
            overallAverage,
          },
        };
      }),
    }));

    res.json({ success: true, data: { teams: teamsWithAverages, day } });
  } catch (error) {
    next(error);
  }
});

// POST /api/teams/:tournamentId/init - Initialiser les équipes sans affectations
router.post(
  '/:tournamentId/init',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const tournamentId = req.params.tournamentId;
      const { teamCount = 13 } = req.body;

      if (!Number.isFinite(teamCount) || teamCount < 1) {
        throw new AppError('teamCount invalide', 400);
      }

      const existingTeams = await prisma.team.findMany({
        where: { tournamentId },
        orderBy: { order: 'asc' },
      });

      if (existingTeams.length > 0) {
        res.json({ success: true, data: { teamsCreated: 0, teams: existingTeams } });
        return;
      }

      for (let i = 1; i <= teamCount; i++) {
        await prisma.team.create({
          data: {
            tournamentId,
            name: `Équipe ${i}`,
            order: i,
          },
        });
      }

      const teams = await prisma.team.findMany({
        where: { tournamentId },
        orderBy: { order: 'asc' },
      });

      res.json({ success: true, data: { teamsCreated: teams.length, teams } });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/teams/:tournamentId/generate - Générer les équipes automatiquement
router.post(
  '/:tournamentId/generate',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const tournamentId = req.params.tournamentId;
      const { teamCount = 13, teamSize = 6, tournamentDayId } = req.body;
      const totalSlots = teamCount * teamSize; // 78 places

      if (tournamentDayId) {
        const day = await prisma.tournamentDay.findUnique({
          where: { id: tournamentDayId },
        });
        if (!day || day.tournamentId !== tournamentId) {
          throw new AppError('Jour de tournoi invalide', 400);
        }
      }

      // Récupérer TOUS les ramasseurs disponibles (SELECTED + RESERVE) avec leurs notes
      const ballkids = await prisma.ballkid.findMany({
        where: {
          tournamentId,
          status: { in: [BallkidStatus.SELECTED, BallkidStatus.RESERVE] },
        },
        include: {
          selectionScores: true,
          trainingScores: true,
          tournamentScores: true,
        },
      });

      // Calculer la moyenne globale (sélection + formation + jours tournoi)
      const rankedBallkids = ballkids.map((b: typeof ballkids[number]) => {
        const selectionAvg = b.selectionScores.length > 0
          ? b.selectionScores.reduce((sum: number, s: typeof b.selectionScores[number]) => sum + (s.totalScore || 0), 0) / b.selectionScores.length
          : null;
        const trainingAvg = b.trainingScores.length > 0
          ? b.trainingScores.reduce((sum: number, s: typeof b.trainingScores[number]) => sum + (s.totalScore || 0), 0) / b.trainingScores.length
          : null;

        const tournamentScoresByDay = new Map<string, number[]>();
        b.tournamentScores.forEach((score: typeof b.tournamentScores[number]) => {
          if (!score.tournamentDayId || score.totalScore == null) return;
          const list = tournamentScoresByDay.get(score.tournamentDayId) || [];
          list.push(score.totalScore);
          tournamentScoresByDay.set(score.tournamentDayId, list);
        });

        const tournamentDayAverages = Array.from(tournamentScoresByDay.values()).map((scores) =>
          scores.reduce((sum, value) => sum + value, 0) / scores.length
        );

        const overallParts: number[] = [];
        if (selectionAvg != null) overallParts.push(selectionAvg);
        if (trainingAvg != null) overallParts.push(trainingAvg);
        overallParts.push(...tournamentDayAverages);
        const overallAverage = overallParts.length > 0
          ? overallParts.reduce((sum, value) => sum + value, 0) / overallParts.length
          : 0;

        return { ...b, averageScore: overallAverage };
      });

      // Trier par score décroissant (meilleurs en premier)
      rankedBallkids.sort((a: typeof rankedBallkids[number], b: typeof rankedBallkids[number]) => b.averageScore - a.averageScore);
      
      // Les 78 premiers = membres des équipes, le reste = remplaçants
      const selectedForTeams = rankedBallkids.slice(0, totalSlots);
      const reserveBallkids = rankedBallkids.slice(totalSlots);

      if (selectedForTeams.length < totalSlots) {
        throw new AppError(`Pas assez de ramasseurs sélectionnés. ${selectedForTeams.length}/${totalSlots} disponibles.`, 400);
      }

      // Créer ou récupérer les équipes
      let teams = await prisma.team.findMany({
        where: { tournamentId },
        orderBy: { order: 'asc' },
      });

      if (!tournamentDayId && teams.length > 0 && teams.length !== teamCount) {
        await prisma.team.deleteMany({ where: { tournamentId } });
        teams = [];
      }

      if (teams.length < teamCount) {
        const startIndex = teams.length + 1;
        for (let i = startIndex; i <= teamCount; i++) {
          await prisma.team.create({
            data: {
              tournamentId,
              name: `Équipe ${i}`,
              order: i,
            },
          });
        }
        teams = await prisma.team.findMany({
          where: { tournamentId },
          orderBy: { order: 'asc' },
        });
      }

      // Supprimer les anciennes affectations (jour ciblé ou défaut)
      await prisma.teamAssignment.deleteMany({
        where: {
          team: { tournamentId },
          tournamentDayId: tournamentDayId ?? null,
        },
      });

      // Nettoyer d'éventuelles duplications héritées
      await prisma.teamAssignment.deleteMany({
        where: {
          team: { tournamentId },
          ballkidId: { in: rankedBallkids.map((b) => b.id) },
          tournamentDayId: { not: tournamentDayId ?? null },
        },
      });

      // Algorithme de répartition équilibrée (snake draft)
      // Round 1: équipes 1-13, Round 2: équipes 13-1, etc.
      const activeTeams = teams.slice(0, teamCount);
      const assignments: { teamId: string; ballkidId: string; position: number }[] = [];
      let ballkidIndex = 0;

      for (let round = 0; round < teamSize; round++) {
        const teamOrder = round % 2 === 0 
          ? activeTeams 
          : [...activeTeams].reverse();

        for (const team of teamOrder) {
          if (ballkidIndex < selectedForTeams.length) {
            assignments.push({
              teamId: team.id,
              ballkidId: selectedForTeams[ballkidIndex].id,
              position: round + 1,
            });
            ballkidIndex++;
          }
        }
      }

      // Créer les affectations
      for (const assignment of assignments) {
        await prisma.teamAssignment.create({
          data: {
            teamId: assignment.teamId,
            ballkidId: assignment.ballkidId,
            position: assignment.position,
            isReserve: false,
            ...(tournamentDayId ? { tournamentDayId } : {}),
          },
        });
      }

      // Assigner les remplaçants (ceux avec les moins bonnes notes)
      for (const reserve of reserveBallkids) {
        await prisma.teamAssignment.create({
          data: {
            teamId: activeTeams[0].id, // Assignés à l'équipe 1 par défaut
            ballkidId: reserve.id,
            isReserve: true,
            ...(tournamentDayId ? { tournamentDayId } : {}),
          },
        });
      }

      res.json({
        success: true,
        data: {
          teamsCreated: tournamentDayId ? teamCount : teams.length,
          ballkidsAssigned: assignments.length,
          reservesAssigned: reserveBallkids.length,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/teams/:tournamentId/assign - Modifier une affectation
router.put(
  '/:tournamentId/assign',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { ballkidId, teamId, position, tournamentDayId, isReserve = false } = req.body;

      // Supprimer l'ancienne affectation si elle existe
      await prisma.teamAssignment.deleteMany({
        where: {
          ballkidId,
          tournamentDayId: tournamentDayId || null,
        },
      });

      // Créer la nouvelle affectation
      const assignment = await prisma.teamAssignment.create({
        data: {
          teamId,
          ballkidId,
          position,
          tournamentDayId,
          isReserve,
        },
        include: { ballkid: true, team: true },
      });

      res.json({ success: true, data: { assignment } });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/teams/:tournamentId/swap - Échanger deux ramasseurs
router.post(
  '/:tournamentId/swap',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { ballkidId1, ballkidId2, tournamentDayId } = req.body;

      const dayFilter = tournamentDayId ? { tournamentDayId } : { tournamentDayId: null };

      const [assignment1, assignment2] = await Promise.all([
        prisma.teamAssignment.findFirst({
          where: { ballkidId: ballkidId1, ...dayFilter },
        }),
        prisma.teamAssignment.findFirst({
          where: { ballkidId: ballkidId2, ...dayFilter },
        }),
      ]);

      let dayAssignment1 = assignment1;
      let dayAssignment2 = assignment2;

      if (tournamentDayId) {
        if (!dayAssignment1) {
          const baseAssignment1 = await prisma.teamAssignment.findFirst({
            where: { ballkidId: ballkidId1, tournamentDayId: null },
          });
          if (!baseAssignment1) {
            throw new AppError('Affectation non trouvée', 404);
          }
          dayAssignment1 = await prisma.teamAssignment.create({
            data: {
              teamId: baseAssignment1.teamId,
              ballkidId: baseAssignment1.ballkidId,
              position: baseAssignment1.position ?? undefined,
              isReserve: baseAssignment1.isReserve,
              tournamentDayId,
            },
          });
        }

        if (!dayAssignment2) {
          const baseAssignment2 = await prisma.teamAssignment.findFirst({
            where: { ballkidId: ballkidId2, tournamentDayId: null },
          });
          if (!baseAssignment2) {
            throw new AppError('Affectation non trouvée', 404);
          }
          dayAssignment2 = await prisma.teamAssignment.create({
            data: {
              teamId: baseAssignment2.teamId,
              ballkidId: baseAssignment2.ballkidId,
              position: baseAssignment2.position ?? undefined,
              isReserve: baseAssignment2.isReserve,
              tournamentDayId,
            },
          });
        }
      }

      if (!dayAssignment1 || !dayAssignment2) {
        throw new AppError('Affectations non trouvées', 404);
      }

      // Échanger les équipes et positions
      await Promise.all([
        prisma.teamAssignment.update({
          where: { id: dayAssignment1.id },
          data: {
            teamId: dayAssignment2.teamId,
            position: dayAssignment2.position,
            isReserve: dayAssignment2.isReserve,
          },
        }),
        prisma.teamAssignment.update({
          where: { id: dayAssignment2.id },
          data: {
            teamId: dayAssignment1.teamId,
            position: dayAssignment1.position,
            isReserve: dayAssignment1.isReserve,
          },
        }),
      ]);

      res.json({ success: true, message: 'Échange effectué' });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/teams/:teamId - Supprimer une équipe
router.delete('/:teamId', authenticate, requireAdmin, async (req, res, next) => {
  try {
    await prisma.team.delete({ where: { id: req.params.teamId } });
    res.json({ success: true, message: 'Équipe supprimée' });
  } catch (error) {
    next(error);
  }
});

// POST /api/teams/:tournamentId/balance - Équilibrer les équipes existantes avec minimum de changements
router.post(
  '/:tournamentId/balance',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const tournamentId = req.params.tournamentId;
      const expectedTeamSize = 6;

      // Récupérer les équipes avec leurs membres et scores
      const teams = await prisma.team.findMany({
        where: { tournamentId },
        orderBy: { order: 'asc' },
        include: {
          assignments: {
            where: { tournamentDayId: null, isReserve: false },
            include: {
              ballkid: {
                include: { trainingScores: true },
              },
            },
          },
        },
      });

      if (teams.length === 0) {
        throw new AppError('Aucune équipe à équilibrer. Générez d\'abord les équipes.', 400);
      }

      // Vérifier que toutes les équipes ont exactement 6 membres
      const invalidTeams = teams.filter((t: typeof teams[number]) => t.assignments.length !== expectedTeamSize);
      if (invalidTeams.length > 0) {
        const details = invalidTeams.map((t: typeof teams[number]) => `${t.name}: ${t.assignments.length} membres`).join(', ');
        throw new AppError(`Les équipes n'ont pas toutes ${expectedTeamSize} membres (${details}). Veuillez d'abord regénérer les équipes.`, 400);
      }

      // Calculer les scores moyens pour chaque ballkid
      type BallkidWithScore = {
        id: string;
        teamId: string;
        assignmentId: string;
        averageScore: number;
      };

      const teamData: { teamId: string; members: BallkidWithScore[]; average: number }[] = teams.map((team: typeof teams[number]) => {
        const members = team.assignments.map((a: typeof team.assignments[number]) => {
          const scores = a.ballkid.trainingScores;
          const avg = scores.length > 0
            ? scores.reduce((sum: number, s: typeof scores[number]) => sum + (s.totalScore || 0), 0) / scores.length
            : 0;
          return {
            id: a.ballkid.id,
            teamId: team.id,
            assignmentId: a.id,
            averageScore: avg,
          };
        });
        const teamAvg = members.length > 0
          ? members.reduce((sum: number, m: BallkidWithScore) => sum + m.averageScore, 0) / members.length
          : 0;
        return { teamId: team.id, members, average: teamAvg };
      });

      // Algorithme d'équilibrage par échanges
      let swapsCount = 0;
      const maxIterations = 100;
      let improved = true;
      let iteration = 0;

      while (improved && iteration < maxIterations) {
        improved = false;
        iteration++;

        // Calculer les moyennes actuelles
        const averages = teamData.map((t) => ({
          teamId: t.teamId,
          avg: t.members.length > 0
            ? t.members.reduce((sum, m) => sum + m.averageScore, 0) / t.members.length
            : 0,
        }));

        // Trouver l'équipe avec la plus haute et plus basse moyenne
        averages.sort((a, b) => a.avg - b.avg);
        const lowestTeam = teamData.find((t) => t.teamId === averages[0].teamId)!;
        const highestTeam = teamData.find((t) => t.teamId === averages[averages.length - 1].teamId)!;

        const currentDiff = averages[averages.length - 1].avg - averages[0].avg;

        // Si la différence est déjà faible, on arrête
        if (currentDiff < 0.5) break;

        // Trouver le meilleur échange possible
        let bestSwap: { low: BallkidWithScore; high: BallkidWithScore } | null = null;
        let bestImprovement = 0;

        for (const lowMember of lowestTeam.members) {
          for (const highMember of highestTeam.members) {
            // Simuler l'échange
            const newLowAvg =
              (lowestTeam.members.reduce((sum, m) => sum + m.averageScore, 0) -
                lowMember.averageScore +
                highMember.averageScore) /
              lowestTeam.members.length;
            const newHighAvg =
              (highestTeam.members.reduce((sum, m) => sum + m.averageScore, 0) -
                highMember.averageScore +
                lowMember.averageScore) /
              highestTeam.members.length;

            // Recalculer la nouvelle différence globale
            const newAverages = averages.map((a) => {
              if (a.teamId === lowestTeam.teamId) return { ...a, avg: newLowAvg };
              if (a.teamId === highestTeam.teamId) return { ...a, avg: newHighAvg };
              return a;
            });
            newAverages.sort((a, b) => a.avg - b.avg);
            const newDiff = newAverages[newAverages.length - 1].avg - newAverages[0].avg;

            const improvement = currentDiff - newDiff;
            if (improvement > bestImprovement && improvement > 0.1) {
              bestImprovement = improvement;
              bestSwap = { low: lowMember, high: highMember };
            }
          }
        }

        // Effectuer le meilleur échange trouvé
        if (bestSwap) {
          // Mettre à jour les données locales
          const lowIdx = lowestTeam.members.findIndex((m) => m.id === bestSwap!.low.id);
          const highIdx = highestTeam.members.findIndex((m) => m.id === bestSwap!.high.id);

          // Échanger dans la base de données
          await Promise.all([
            prisma.teamAssignment.update({
              where: { id: bestSwap.low.assignmentId },
              data: { teamId: highestTeam.teamId },
            }),
            prisma.teamAssignment.update({
              where: { id: bestSwap.high.assignmentId },
              data: { teamId: lowestTeam.teamId },
            }),
          ]);

          // Échanger dans les données locales
          const tempLow = { ...lowestTeam.members[lowIdx], teamId: highestTeam.teamId };
          const tempHigh = { ...highestTeam.members[highIdx], teamId: lowestTeam.teamId };

          lowestTeam.members[lowIdx] = tempHigh;
          highestTeam.members[highIdx] = tempLow;

          // Mettre à jour les assignmentId
          const tempAssignmentId = lowestTeam.members[lowIdx].assignmentId;
          lowestTeam.members[lowIdx].assignmentId = highestTeam.members[highIdx].assignmentId;
          highestTeam.members[highIdx].assignmentId = tempAssignmentId;

          swapsCount++;
          improved = true;
        }
      }

      // Calculer les nouvelles stats
      const finalAverages = teamData.map((t) => ({
        teamId: t.teamId,
        avg: t.members.length > 0
          ? t.members.reduce((sum, m) => sum + m.averageScore, 0) / t.members.length
          : 0,
      }));
      finalAverages.sort((a, b) => a.avg - b.avg);
      const finalDiff = finalAverages.length > 0
        ? finalAverages[finalAverages.length - 1].avg - finalAverages[0].avg
        : 0;

      res.json({
        success: true,
        data: {
          swapsPerformed: swapsCount,
          iterations: iteration,
          finalDifference: finalDiff.toFixed(2),
          message: swapsCount > 0
            ? `${swapsCount} échange(s) effectué(s) pour équilibrer les équipes`
            : 'Les équipes sont déjà équilibrées',
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
