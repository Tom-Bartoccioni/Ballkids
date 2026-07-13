import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { AppError } from './errorHandler.js';

// Bloque les actions sensibles lorsque l'instance tourne en mode démonstration
// (DEMO_MODE=true). Empêche notamment de verrouiller le compte de démo partagé.
export const blockInDemo = (
  _req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  if (process.env.DEMO_MODE === 'true') {
    return next(new AppError('Action désactivée en mode démonstration.', 403));
  }
  next();
};
