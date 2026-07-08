import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import prisma from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { blockInDemo } from '../middleware/demoGuard.js';

const router = Router();

// POST /api/auth/login
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Email invalide'),
    body('password').notEmpty().withMessage('Mot de passe requis'),
  ],
  async (req: AuthRequest, res: any, next: any) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError(errors.array()[0].msg, 400);
      }

      const { email, password } = req.body;

      const user = await prisma.user.findUnique({
        where: { email },
        include: {
          // Profil coach du tournoi actif (un coach peut avoir un profil par annee)
          coachProfiles: {
            where: { tournament: { isActive: true } },
            take: 1,
          },
        },
      });

      if (!user) {
        throw new AppError('Email ou mot de passe incorrect', 401);
      }

      const isValidPassword = await bcrypt.compare(password, user.password);

      if (!isValidPassword) {
        throw new AppError('Email ou mot de passe incorrect', 401);
      }

      const secret = process.env.JWT_SECRET;
      const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

      if (!secret) {
        throw new AppError('Configuration serveur incorrecte', 500);
      }

      const token = jwt.sign({ userId: user.id }, secret, { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] });

      res.json({
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            coachProfile: user.coachProfiles[0] || null,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/auth/register (Admin only - pour créer des coachs)
router.post(
  '/register',
  authenticate,
  [
    body('email').isEmail().withMessage('Email invalide'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Le mot de passe doit contenir au moins 6 caractères'),
    body('firstName').notEmpty().withMessage('Prénom requis'),
    body('lastName').notEmpty().withMessage('Nom requis'),
    body('role').isIn(['ADMIN', 'COACH']).withMessage('Rôle invalide'),
  ],
  async (req: AuthRequest, res: any, next: any) => {
    try {
      if (req.user?.role !== 'ADMIN') {
        throw new AppError('Accès réservé aux administrateurs', 403);
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError(errors.array()[0].msg, 400);
      }

      const { email, password, firstName, lastName, role, tournamentId } = req.body;

      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        throw new AppError('Cet email est déjà utilisé', 400);
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
          role,
        },
      });

      // Si c'est un coach, créer le profil coach
      if (role === 'COACH' && tournamentId) {
        await prisma.coach.create({
          data: {
            userId: user.id,
            tournamentId,
          },
        });
      }

      res.status(201).json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: any, next: any) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user?.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        // Profil coach du tournoi actif uniquement
        coachProfiles: {
          where: { tournament: { isActive: true } },
          include: {
            tournament: true,
          },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new AppError('Utilisateur non trouvé', 404);
    }

    // On expose coachProfile (au singulier) pour ne pas changer le contrat cote frontend
    const { coachProfiles, ...rest } = user;
    res.json({
      success: true,
      data: { user: { ...rest, coachProfile: coachProfiles[0] || null } },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/auth/password
router.put(
  '/password',
  authenticate,
  blockInDemo,
  [
    body('currentPassword').notEmpty().withMessage('Mot de passe actuel requis'),
    body('newPassword')
      .isLength({ min: 6 })
      .withMessage('Le nouveau mot de passe doit contenir au moins 6 caractères'),
  ],
  async (req: AuthRequest, res: any, next: any) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError(errors.array()[0].msg, 400);
      }

      const { currentPassword, newPassword } = req.body;

      const user = await prisma.user.findUnique({
        where: { id: req.user?.id },
      });

      if (!user) {
        throw new AppError('Utilisateur non trouvé', 404);
      }

      const isValidPassword = await bcrypt.compare(currentPassword, user.password);

      if (!isValidPassword) {
        throw new AppError('Mot de passe actuel incorrect', 401);
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      });

      res.json({
        success: true,
        message: 'Mot de passe modifié avec succès',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
