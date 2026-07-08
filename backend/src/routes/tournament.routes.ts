import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { initializeTournamentDefaults } from '../lib/tournamentInit.js';
import { cloneTournamentData, CloneOptions } from '../lib/tournamentClone.js';

const router = Router();

// Options de clonage par défaut : on reprend tout du tournoi source
const DEFAULT_CLONE_OPTIONS: CloneOptions = {
  ballkids: true,
  selectionCriteria: true,
  trainingSetup: true,
  teams: true,
  days: true,
  coaches: true,
};

// GET /api/tournaments - Liste des tournois
router.get('/', authenticate, async (req, res, next) => {
  try {
    const tournaments = await prisma.tournament.findMany({
      orderBy: { year: 'desc' },
      include: {
        _count: {
          select: { ballkids: true, coaches: true, teams: true },
        },
      },
    });

    res.json({ success: true, data: { tournaments } });
  } catch (error) {
    next(error);
  }
});

// GET /api/tournaments/active - Tournoi actif
router.get('/active', authenticate, async (req, res, next) => {
  try {
    const tournament = await prisma.tournament.findFirst({
      where: { isActive: true },
      include: {
        tournamentDays: { orderBy: { dayNumber: 'asc' } },
        trainingSessions: { orderBy: { sessionNumber: 'asc' } },
        selectionSession: true,
        _count: { select: { ballkids: true, coaches: true, teams: true } },
      },
    });

    res.json({ success: true, data: { tournament } });
  } catch (error) {
    next(error);
  }
});

// GET /api/tournaments/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const tournament = await prisma.tournament.findUnique({
      where: { id: req.params.id },
      include: {
        tournamentDays: { orderBy: { dayNumber: 'asc' }, include: { courts: true } },
        trainingSessions: { orderBy: { sessionNumber: 'asc' } },
        selectionSession: { include: { criteria: { orderBy: { order: 'asc' } } } },
        teams: { orderBy: { order: 'asc' } },
        _count: { select: { ballkids: true, coaches: true } },
      },
    });

    if (!tournament) {
      throw new AppError('Tournoi non trouvé', 404);
    }

    res.json({ success: true, data: { tournament } });
  } catch (error) {
    next(error);
  }
});

// POST /api/tournaments - Créer un tournoi
router.post(
  '/',
  authenticate,
  requireAdmin,
  [
    body('name').notEmpty().withMessage('Nom requis'),
    body('year').isInt().withMessage('Année invalide'),
    body('startDate').isISO8601().withMessage('Date de début invalide'),
    body('endDate').isISO8601().withMessage('Date de fin invalide'),
    body('copyFromTournamentId')
      .optional()
      .isString()
      .withMessage('Identifiant du tournoi source invalide'),
    body('cloneOptions').optional().isObject().withMessage('Options de clonage invalides'),
  ],
  async (req: AuthRequest, res: any, next: any) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError(errors.array()[0].msg, 400);
      }

      const { name, year, startDate, endDate, copyFromTournamentId, cloneOptions } = req.body;

      const parsedStartDate = new Date(startDate);

      // Only auto-activate if no other tournament is active
      const hasActive = await prisma.tournament.findFirst({ where: { isActive: true } });

      // Création + initialisation/clonage dans une seule transaction
      const { tournament, cloneSummary } = await prisma.$transaction(async (tx) => {
        const tournament = await tx.tournament.create({
          data: {
            name,
            year,
            startDate: parsedStartDate,
            endDate: new Date(endDate),
            isActive: !hasActive,
          },
        });

        let cloneSummary = null;

        if (copyFromTournamentId) {
          // Reprise des données d'un tournoi précédent
          const source = await tx.tournament.findUnique({
            where: { id: copyFromTournamentId },
          });
          if (!source) {
            throw new AppError('Tournoi source non trouvé', 404);
          }

          cloneSummary = await cloneTournamentData(
            tx,
            copyFromTournamentId,
            tournament.id,
            cloneOptions ?? DEFAULT_CLONE_OPTIONS,
            parsedStartDate
          );
        } else {
          // Nouveau tournoi : initialiser la structure par défaut
          await initializeTournamentDefaults(tx, tournament.id, parsedStartDate);
        }

        return { tournament, cloneSummary };
      });

      res.status(201).json({ success: true, data: { tournament, cloneSummary } });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/tournaments/:id
router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: any, next: any) => {
  try {
    const data = { ...req.body };
    const oldTournament = await prisma.tournament.findUnique({
      where: { id: req.params.id },
      include: { tournamentDays: { orderBy: { dayNumber: 'asc' } } },
    });

    if (data.startDate) data.startDate = new Date(data.startDate);
    if (data.endDate) data.endDate = new Date(data.endDate);

    const tournament = await prisma.tournament.update({
      where: { id: req.params.id },
      data,
    });

    // Si les dates ont changé, mettre à jour les dates des jours existants
    if (oldTournament && data.startDate && oldTournament.tournamentDays.length > 0) {
      const newStartDate = new Date(data.startDate);
      
      for (const day of oldTournament.tournamentDays) {
        const newDate = new Date(newStartDate);
        newDate.setDate(newStartDate.getDate() + day.dayNumber - 1);
        
        await prisma.tournamentDay.update({
          where: { id: day.id },
          data: { date: newDate },
        });
      }
    }

    // Récupérer le tournoi mis à jour avec les jours
    const updatedTournament = await prisma.tournament.findUnique({
      where: { id: req.params.id },
      include: { tournamentDays: { orderBy: { dayNumber: 'asc' } } },
    });

    res.json({ success: true, data: { tournament: updatedTournament } });
  } catch (error) {
    next(error);
  }
});

// PUT /api/tournaments/:id/activate - Activer un tournoi
router.put('/:id/activate', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    // Désactiver tous les autres tournois
    await prisma.tournament.updateMany({
      data: { isActive: false },
    });

    const tournament = await prisma.tournament.update({
      where: { id: req.params.id },
      data: { isActive: true },
    });

    res.json({ success: true, data: { tournament } });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/tournaments/:id
router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    await prisma.tournament.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Tournoi supprimé' });
  } catch (error) {
    next(error);
  }
});

export default router;
