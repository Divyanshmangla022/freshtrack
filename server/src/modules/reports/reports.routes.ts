import { Router } from 'express';
import { asyncHandler, httpError } from '../../http/errors.ts';
import { INVOICE_STATUS, ROLES } from '../../types.ts';
import type { InvoiceStatus } from '../../types.ts';
import { getAuth, requireAuth, requireRole } from '../auth/auth.middleware.ts';
import { logAudit } from '../audit/audit.repo.ts';
import { getReconciliationRows } from './reports.repo.ts';
import type { ReconciliationFilter } from './reports.repo.ts';
import { buildExport, buildSummary, rowToDTO } from './reports.service.ts';

const router = Router();

// Reconciliation reporting is Central Admin only (cross-warehouse).
router.use(requireAuth, requireRole(ROLES.ADMIN));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseFilter(query: Record<string, unknown>): ReconciliationFilter {
  const filter: ReconciliationFilter = {};
  const dateFrom = query.dateFrom;
  const dateTo = query.dateTo;
  if (typeof dateFrom === 'string' && dateFrom) {
    if (!DATE_RE.test(dateFrom)) throw httpError.badRequest('dateFrom must be YYYY-MM-DD');
    filter.dateFrom = dateFrom;
  }
  if (typeof dateTo === 'string' && dateTo) {
    if (!DATE_RE.test(dateTo)) throw httpError.badRequest('dateTo must be YYYY-MM-DD');
    filter.dateTo = dateTo;
  }
  if (query.warehouseId !== undefined && query.warehouseId !== '') {
    const id = Number(query.warehouseId);
    if (!Number.isInteger(id)) throw httpError.badRequest('warehouseId must be an integer');
    filter.warehouseId = id;
  }
  if (typeof query.vendor === 'string' && query.vendor) filter.vendor = query.vendor;
  if (typeof query.status === 'string' && query.status) {
    const upper = query.status.toUpperCase();
    if (!(Object.values(INVOICE_STATUS) as string[]).includes(upper)) {
      throw httpError.badRequest('Invalid status');
    }
    filter.status = upper as InvoiceStatus;
  }
  return filter;
}

// GET /api/reports/reconciliation - rows + summary as JSON.
router.get(
  '/reconciliation',
  asyncHandler(async (req, res) => {
    const filter = parseFilter(req.query as Record<string, unknown>);
    const rows = getReconciliationRows(filter);
    res.json({
      filter,
      rows: rows.map(rowToDTO),
      summary: buildSummary(rows),
    });
  }),
);

// GET /api/reports/summary - aggregates only (for dashboards / the AI assistant).
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const filter = parseFilter(req.query as Record<string, unknown>);
    const rows = getReconciliationRows(filter);
    res.json({ filter, summary: buildSummary(rows) });
  }),
);

// GET /api/reports/reconciliation/export?format=csv|xlsx - downloadable file.
router.get(
  '/reconciliation/export',
  asyncHandler(async (req, res) => {
    const filter = parseFilter(req.query as Record<string, unknown>);
    const format = (req.query.format === 'xlsx' ? 'xlsx' : 'csv') as 'csv' | 'xlsx';
    const rows = getReconciliationRows(filter);
    const file = buildExport(rows, format);

    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const filename = `reconciliation_${stamp}.${file.extension}`;

    logAudit({
      actorUserId: getAuth(res).userId,
      action: 'REPORT_EXPORT',
      entity: 'report',
      metadata: { format, rows: rows.length, filter },
    });

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(file.buffer);
  }),
);

export default router;
