import { Router } from 'express';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';

const router = Router();

// GET /api/coaches/:tournamentId - Liste des coachs
router.get('/:tournamentId', authenticate, async (req, res, next) => {
  try {
    const coaches = await prisma.coach.findMany({
      where: { tournamentId: req.params.tournamentId },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        assignments: {
          include: {
            tournamentDay: true,
            court: true,
          },
          orderBy: { tournamentDay: { dayNumber: 'asc' } },
        },
      },
    });

    res.json({ success: true, data: { coaches } });
  } catch (error) {
    next(error);
  }
});

// GET /api/coaches/:tournamentId/planning - Planning des coachs avec alertes
router.get('/:tournamentId/planning', authenticate, async (req, res, next) => {
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: req.params.tournamentId },
      select: { id: true, startDate: true, endDate: true },
    });

    if (!tournament) {
      throw new AppError('Tournoi non trouvé', 404);
    }

    const coaches = await prisma.coach.findMany({
      where: { tournamentId: req.params.tournamentId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        assignments: {
          include: { tournamentDay: true, court: true },
          orderBy: { tournamentDay: { dayNumber: 'asc' } },
        },
      },
    });

    const tournamentDays = await prisma.tournamentDay.findMany({
      where: { tournamentId: req.params.tournamentId },
      orderBy: { dayNumber: 'asc' },
    });

    const formatDateKey = (date: Date) => date.toISOString().split('T')[0];
    const toUtcDateOnly = (date: Date) =>
      new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const buildDateRange = (startDate: Date, endDate: Date) => {
      const dates: Date[] = [];
      const current = toUtcDateOnly(startDate);
      const end = toUtcDateOnly(endDate);
      while (current <= end) {
        dates.push(new Date(current));
        current.setUTCDate(current.getUTCDate() + 1);
      }
      return dates;
    };

    const dateRangeDays =
      tournament.startDate && tournament.endDate
        ? buildDateRange(new Date(tournament.startDate), new Date(tournament.endDate))
        : tournamentDays.map((day) => new Date(day.date));

    // Build map using dayNumber for reliable matching
    const dayByNumber = new Map<number, (typeof tournamentDays)[number]>();
    tournamentDays.forEach((day) => {
      dayByNumber.set(day.dayNumber, day);
    });

    const days = dateRangeDays.map((date, index) => {
      const dayNumber = index + 1;
      const dateKey = formatDateKey(date);
      const existingDay = dayByNumber.get(dayNumber);
      return {
        dayNumber,
        date: dateKey,
        id: existingDay?.id || null,
      };
    });

    const planning = coaches.map((coach) => {
      const assignmentByDate = new Map<string, (typeof coach.assignments)[number]>();
      coach.assignments.forEach((assignment) => {
        assignmentByDate.set(formatDateKey(assignment.tournamentDay.date), assignment);
      });
      const workingDays = new Set(assignmentByDate.keys());
      
      // Vérifier la règle des 6 jours consécutifs max
      let consecutiveCount = 0;
      let maxConsecutive = 0;
      let hasAlert = false;

      for (const day of days) {
        if (workingDays.has(day.date)) {
          consecutiveCount++;
          if (consecutiveCount > maxConsecutive) {
            maxConsecutive = consecutiveCount;
          }
          if (consecutiveCount > 6) {
            hasAlert = true;
          }
        } else {
          consecutiveCount = 0;
        }
      }

      // Créer le tableau jour par jour
      const schedule = days.map((day) => {
        const assignment = assignmentByDate.get(day.date);
        return {
          dayNumber: day.dayNumber,
          date: day.date,
          isWorking: !!assignment,
          court: assignment?.court?.name || null,
        };
      });

      return {
        id: coach.id,
        firstName: coach.user.firstName,
        lastName: coach.user.lastName,
        totalDays: workingDays.size,
        maxConsecutive,
        hasAlert,
        schedule,
      };
    });

    res.json({ success: true, data: { planning, days } });
  } catch (error) {
    next(error);
  }
});

// POST /api/coaches/:tournamentId/assign - Affecter un coach à un jour/terrain
router.post(
  '/:tournamentId/assign',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { coachId, tournamentDayId, courtId } = req.body;

      // Vérifier que le coach ne dépasse pas 6 jours consécutifs
      const coach = await prisma.coach.findUnique({
        where: { id: coachId },
        include: {
          assignments: {
            include: { tournamentDay: true },
            orderBy: { tournamentDay: { dayNumber: 'asc' } },
          },
        },
      });

      if (!coach) {
        throw new AppError('Coach non trouvé', 404);
      }

      const targetDay = await prisma.tournamentDay.findUnique({
        where: { id: tournamentDayId },
      });

      if (!targetDay) {
        throw new AppError('Jour non trouvé', 404);
      }

      // Simuler l'ajout pour vérifier les jours consécutifs
      const workingDays = [
        ...coach.assignments.map((a) => a.tournamentDay.dayNumber),
        targetDay.dayNumber,
      ].sort((a, b) => a - b);

      let consecutiveCount = 0;
      for (let i = 0; i < workingDays.length; i++) {
        if (i === 0 || workingDays[i] === workingDays[i - 1] + 1) {
          consecutiveCount++;
        } else {
          consecutiveCount = 1;
        }
        if (consecutiveCount > 6) {
          throw new AppError(
            `Attention : ${coach.user} dépasserait 6 jours consécutifs`,
            400
          );
        }
      }

      const assignment = await prisma.coachAssignment.upsert({
        where: {
          coachId_tournamentDayId: { coachId, tournamentDayId },
        },
        update: { courtId },
        create: { coachId, tournamentDayId, courtId },
        include: {
          coach: { include: { user: true } },
          tournamentDay: true,
          court: true,
        },
      });

      res.json({ success: true, data: { assignment } });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/coaches/:tournamentId/assign - Retirer une affectation
router.delete(
  '/:tournamentId/assign',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { coachId, tournamentDayId } = req.body;

      await prisma.coachAssignment.delete({
        where: {
          coachId_tournamentDayId: { coachId, tournamentDayId },
        },
      });

      res.json({ success: true, message: 'Affectation supprimée' });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/coaches/:coachId/schedule - Planning individuel d'un coach
router.get('/detail/:coachId', authenticate, async (req, res, next) => {
  try {
    const coach = await prisma.coach.findUnique({
      where: { id: req.params.coachId },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        tournament: true,
        assignments: {
          include: {
            tournamentDay: true,
            court: true,
          },
          orderBy: { tournamentDay: { dayNumber: 'asc' } },
        },
      },
    });

    if (!coach) {
      throw new AppError('Coach non trouvé', 404);
    }

    res.json({ success: true, data: { coach } });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/coaches/:coachId - Supprimer un coach
router.delete('/:coachId', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const coach = await prisma.coach.findUnique({
      where: { id: req.params.coachId },
      include: { user: true },
    });

    if (!coach) {
      throw new AppError('Coach non trouvé', 404);
    }

    // Supprimer le coach (les assignments seront supprimés en cascade)
    await prisma.coach.delete({ where: { id: req.params.coachId } });

    // Supprimer aussi l'utilisateur associé
    await prisma.user.delete({ where: { id: coach.userId } });

    res.json({ success: true, message: 'Coach supprimé' });
  } catch (error) {
    next(error);
  }
});

// ============================================
// DISPONIBILITÉS DES COACHS
// ============================================

// GET /api/coaches/:tournamentId/availabilities - Liste des disponibilités de tous les coachs
router.get('/:tournamentId/availabilities', authenticate, async (req, res, next) => {
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: req.params.tournamentId },
      select: { id: true, startDate: true, endDate: true },
    });

    if (!tournament) {
      throw new AppError('Tournoi non trouvé', 404);
    }

    const coaches = await prisma.coach.findMany({
      where: { tournamentId: req.params.tournamentId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        plannedAvailabilities: true,
        assignments: {
          include: { tournamentDay: true, court: true },
          orderBy: { tournamentDay: { dayNumber: 'asc' } },
        },
      },
    });

    const tournamentDays = await prisma.tournamentDay.findMany({
      where: { tournamentId: req.params.tournamentId },
      orderBy: { dayNumber: 'asc' },
    });

    const formatDateKey = (date: Date) => date.toISOString().split('T')[0];
    const toUtcDateOnly = (date: Date) =>
      new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const buildDateRange = (startDate: Date, endDate: Date) => {
      const dates: Date[] = [];
      const current = toUtcDateOnly(startDate);
      const end = toUtcDateOnly(endDate);
      while (current <= end) {
        dates.push(new Date(current));
        current.setUTCDate(current.getUTCDate() + 1);
      }
      return dates;
    };

    const dateRangeDays =
      tournament.startDate && tournament.endDate
        ? buildDateRange(new Date(tournament.startDate), new Date(tournament.endDate))
        : tournamentDays.map((day) => new Date(day.date));

    // Build map using dayNumber for reliable matching
    const dayByNumber = new Map<number, (typeof tournamentDays)[number]>();
    tournamentDays.forEach((day) => {
      dayByNumber.set(day.dayNumber, day);
    });

    const days = dateRangeDays.map((date, index) => {
      const dayNumber = index + 1;
      const dateKey = formatDateKey(date);
      const existingDay = dayByNumber.get(dayNumber);
      return {
        dayNumber,
        date: dateKey,
        id: existingDay?.id || null,
      };
    });

    // Créer une structure pour chaque coach avec ses disponibilités par jour
    const coachAvailabilities = coaches.map((coach) => {
      // Use planned availabilities (by dayNumber)
      const availableDayNumbers = new Set(
        coach.plannedAvailabilities.map((pa) => pa.dayNumber)
      );
      
      // Build assignments map by dayNumber
      const assignmentsByDayNumber = new Map(
        coach.assignments.map((assignment) => [
          assignment.tournamentDay.dayNumber,
          assignment,
        ])
      );

      const schedule = days.map((day) => ({
        dayNumber: day.dayNumber,
        dayId: day.id,
        date: day.date,
        isAvailable: availableDayNumbers.has(day.dayNumber),
        isAssigned: assignmentsByDayNumber.has(day.dayNumber),
        court: assignmentsByDayNumber.get(day.dayNumber)?.court?.name || null,
      }));

      return {
        id: coach.id,
        firstName: coach.user.firstName,
        lastName: coach.user.lastName,
        totalAvailable: availableDayNumbers.size,
        totalAssigned: assignmentsByDayNumber.size,
        schedule,
      };
    });

    res.json({ success: true, data: { coachAvailabilities, days } });
  } catch (error) {
    next(error);
  }
});

// PUT /api/coaches/:coachId/availability - Mettre à jour les disponibilités planifiées d'un coach
router.put(
  '/:coachId/availability',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { coachId } = req.params;
      const { isAvailable, dayNumber } = req.body;

      const coach = await prisma.coach.findUnique({
        where: { id: coachId },
        include: { user: true },
      });

      if (!coach) {
        throw new AppError('Coach non trouvé', 404);
      }

      if (dayNumber === undefined) {
        throw new AppError('dayNumber requis', 400);
      }

      if (isAvailable) {
        // Ajouter la disponibilité planifiée
        await prisma.coachPlannedAvailability.upsert({
          where: {
            coachId_tournamentId_dayNumber: { 
              coachId, 
              tournamentId: coach.tournamentId, 
              dayNumber 
            },
          },
          update: {},
          create: { 
            coachId, 
            tournamentId: coach.tournamentId, 
            dayNumber 
          },
        });
      } else {
        // Supprimer la disponibilité planifiée
        await prisma.coachPlannedAvailability.deleteMany({
          where: { 
            coachId, 
            tournamentId: coach.tournamentId, 
            dayNumber 
          },
        });

        // Also remove any actual assignments if the day exists
        const existingDay = await prisma.tournamentDay.findFirst({
          where: { tournamentId: coach.tournamentId, dayNumber },
        });
        
        if (existingDay) {
          await prisma.coachAssignment.deleteMany({
            where: { coachId, tournamentDayId: existingDay.id },
          });
          await prisma.coachAvailability.deleteMany({
            where: { coachId, tournamentDayId: existingDay.id },
          });
        }
      }

      res.json({ success: true, message: 'Disponibilité mise à jour' });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/coaches/:coachId/availability/bulk - Mettre à jour toutes les disponibilités d'un coach
router.put(
  '/:coachId/availability/bulk',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res, next) => {
    try {
      const { coachId } = req.params;
      const { availableDayIds } = req.body as { availableDayIds: string[] };

      const coach = await prisma.coach.findUnique({
        where: { id: coachId },
        include: { assignments: true },
      });

      if (!coach) {
        throw new AppError('Coach non trouvé', 404);
      }

      // Vérifier que tous les jours assignés sont dans les jours disponibles
      const assignedDayIds = coach.assignments.map(a => a.tournamentDayId);
      const missingAssigned = assignedDayIds.filter(dayId => !availableDayIds.includes(dayId));

      if (missingAssigned.length > 0) {
        throw new AppError(
          'Impossible : le coach est assigné à des jours que vous essayez de retirer',
          400
        );
      }

      // Supprimer toutes les disponibilités actuelles
      await prisma.coachAvailability.deleteMany({
        where: { coachId },
      });

      // Créer les nouvelles disponibilités
      if (availableDayIds.length > 0) {
        await prisma.coachAvailability.createMany({
          data: availableDayIds.map(tournamentDayId => ({
            coachId,
            tournamentDayId,
          })),
        });
      }

      res.json({ success: true, message: 'Disponibilités mises à jour' });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/coaches/:tournamentId/day/:dayNumber/available - Coachs disponibles pour un jour spécifique
router.get('/:tournamentId/day/:dayNumber/available', authenticate, async (req, res, next) => {
  try {
    const { tournamentId, dayNumber } = req.params;
    const dayNum = parseInt(dayNumber);

    // Find coaches with planned availability for this day number
    const coaches = await prisma.coach.findMany({
      where: {
        tournamentId,
        plannedAvailabilities: {
          some: { dayNumber: dayNum },
        },
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        assignments: {
          include: { 
            court: true,
            tournamentDay: true,
          },
        },
      },
    });

    const availableCoaches = coaches.map(coach => {
      // Filter assignments to only those for this day number
      const dayAssignments = coach.assignments.filter(a => a.tournamentDay.dayNumber === dayNum);
      return {
        id: coach.id,
        firstName: coach.user.firstName,
        lastName: coach.user.lastName,
        isAssigned: dayAssignments.length > 0,
        assignedCourt: dayAssignments[0]?.court?.name || null,
      };
    });

    res.json({ success: true, data: { availableCoaches } });
  } catch (error) {
    next(error);
  }
});

export default router;
