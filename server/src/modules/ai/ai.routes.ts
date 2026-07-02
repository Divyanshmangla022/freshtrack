import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.ts';
import { asyncHandler } from '../../http/errors.ts';
import { parse } from '../../http/validate.ts';
import { INVOICE_STATUS, ROLES } from '../../types.ts';
import { requireAuth, requireRole } from '../auth/auth.middleware.ts';
import type { ReconciliationFilter } from '../reports/reports.repo.ts';
import { answerQuestion, generateInsights } from './assistant.ts';
import { aiReady } from './ai.client.ts';

const router = Router();

const FilterSchema = z
  .object({
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    warehouseId: z.number().int().positive().optional(),
    vendor: z.string().trim().max(200).optional(),
    status: z.enum([INVOICE_STATUS.OPEN, INVOICE_STATUS.IN_PROGRESS, INVOICE_STATUS.COMPLETED]).optional(),
  })
  .optional();

const AssistantSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  filter: FilterSchema,
});

const InsightsSchema = z.object({ filter: FilterSchema });

// GET /api/ai/status - any authenticated user can check whether AI is available.
router.get(
  '/status',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({
      enabled: await aiReady(),
      provider: config.ai.provider,
      mappingModel: config.ai.mappingModel,
      assistantModel: config.ai.assistantModel,
    });
  }),
);

// POST /api/ai/assistant - grounded NL Q&A over reconciliation data (admin).
router.post(
  '/assistant',
  requireAuth,
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const { question, filter } = parse(AssistantSchema, req.body);
    const result = await answerQuestion(question, (filter ?? {}) as ReconciliationFilter);
    res.json(result);
  }),
);

// POST /api/ai/insights - AI-generated narrative over a reconciliation slice (admin).
router.post(
  '/insights',
  requireAuth,
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const { filter } = parse(InsightsSchema, req.body);
    const result = await generateInsights((filter ?? {}) as ReconciliationFilter);
    res.json(result);
  }),
);

export default router;
