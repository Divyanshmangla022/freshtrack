import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import { config, SERVER_ROOT } from './config.ts';
import { errorHandler, notFoundHandler } from './http/errors.ts';
import authRoutes from './modules/auth/auth.routes.ts';
import userRoutes from './modules/users/users.routes.ts';
import warehouseRoutes from './modules/warehouses/warehouses.routes.ts';
import invoiceRoutes from './modules/invoices/invoices.routes.ts';
import receivingRoutes from './modules/receiving/receiving.routes.ts';
import reportRoutes from './modules/reports/reports.routes.ts';
import aiRoutes from './modules/ai/ai.routes.ts';
import auditRoutes from './modules/audit/audit.routes.ts';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      name: 'FreshTrack API',
      time: new Date().toISOString(),
      ai: { enabled: config.ai.enabled, provider: config.ai.provider },
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/warehouses', warehouseRoutes);
  app.use('/api/invoices', invoiceRoutes);
  app.use('/api/receiving', receivingRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/audit', auditRoutes);

  // Unknown API routes -> JSON 404 (before any SPA fallback).
  app.use('/api', notFoundHandler);

  // Optionally serve the built web client for a single-process production deploy.
  const webDist = path.resolve(SERVER_ROOT, '..', 'web', 'dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
