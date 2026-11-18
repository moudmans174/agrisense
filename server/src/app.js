import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config/env.js';
import { query } from './db/pool.js';
import { notFound, errorHandler } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import farmRoutes from './routes/farms.js';
import fieldRoutes from './routes/fields.js';
import observationRoutes from './routes/observations.js';
import satelliteRoutes from './routes/satellite.js';
import environmentRoutes from './routes/environment.js';
import integrationRoutes from './routes/integration.js';
import aiRoutes from './routes/ai.js';
import alertRoutes from './routes/alerts.js';
import advisoryRoutes from './routes/advisories.js';
import reportRoutes from './routes/reports.js';
import publicRoutes from './routes/public.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigin.split(','), credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });
  if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

  app.use('/uploads', express.static(path.resolve(config.uploadDir)));

  app.get('/api/health', async (_req, res) => {
    try { await query('SELECT 1'); res.json({ status: 'ok', db: 'up', time: new Date().toISOString() }); }
    catch { res.status(503).json({ status: 'degraded', db: 'down' }); }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/farms', farmRoutes);
  app.use('/api/fields', fieldRoutes);
  app.use('/api/observations', observationRoutes);
  app.use('/api/satellite', satelliteRoutes);
  app.use('/api/environment', environmentRoutes);
  app.use('/api/integration', integrationRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/alerts', alertRoutes);
  app.use('/api/advisories', advisoryRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api', notFound);

  // Serve the built React app (single-server production deployment)
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^\/(?!api\/|uploads\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
