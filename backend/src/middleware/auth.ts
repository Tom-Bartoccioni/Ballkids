import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma.js';
import { AppError } from './errorHandler.js';

// Constante pour remplacer l'enum (SQLite ne supporte pas les enums)
const UserRole = {
  ADMIN: 'ADMIN',
  COACH: 'COACH',
} as const;

type UserRoleType = typeof UserRole[keyof typeof UserRole];

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRoleType;
  };
}

export const authenticate = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Token d\'authentification manquant', 401);
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      throw new AppError('Configuration serveur incorrecte', 500);
    }

    const decoded = jwt.verify(token, secret) as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      throw new AppError('Utilisateur non trouvé', 401);
    }

    req.user = user;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError('Token invalide', 401));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new AppError('Token expiré', 401));
    } else {
      next(error);
    }
  }
};

export const requireAdmin = (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  if (req.user?.role !== UserRole.ADMIN) {
    return next(new AppError('Accès réservé aux administrateurs', 403));
  }
  next();
};

export const requireCoachOrAdmin = (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  if (req.user?.role !== UserRole.ADMIN && req.user?.role !== UserRole.COACH) {
    return next(new AppError('Accès réservé aux coachs et administrateurs', 403));
  }
  next();
};
