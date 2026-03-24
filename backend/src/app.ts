import express from 'express';
import cors from 'cors';
import path from 'path';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import authRoutes from './routes/auth.routes.js';
import ballkidRoutes from './routes/ballkid.routes.js';
import tournamentRoutes from './routes/tournament.routes.js';
import teamRoutes from './routes/team.routes.js';
import selectionRoutes from './routes/selection.routes.js';
import trainingRoutes from './routes/training.routes.js';
import coachRoutes from './routes/coach.routes.js';
import scheduleRoutes from './routes/schedule.routes.js';
import exportRoutes from './routes/export.routes.js';

export function createApp() {
  const app = express();

  // Middleware
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Servir les fichiers statiques (photos)
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  // Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/ballkids', ballkidRoutes);
  app.use('/api/tournaments', tournamentRoutes);
  app.use('/api/teams', teamRoutes);
  app.use('/api/selection', selectionRoutes);
  app.use('/api/training', trainingRoutes);
  app.use('/api/coaches', coachRoutes);
  app.use('/api/schedule', scheduleRoutes);
  app.use('/api/export', exportRoutes);

  // Health check
  app.get('/api/health', (_, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Error handlers
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
