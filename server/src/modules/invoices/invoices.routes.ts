import { Router } from 'express';
import multer from 'multer';
import { asyncHandler, httpError } from '../../http/errors.ts';
import { INVOICE_STATUS, ROLES } from '../../types.ts';
import type { InvoiceStatus } from '../../types.ts';
import { getAuth, requireAuth, requireRole } from '../auth/auth.middleware.ts';
import { getWarehouseById, isUserMappedToWarehouse } from '../warehouses/warehouses.repo.ts';
import { logAudit } from '../audit/audit.repo.ts';
import { getInvoiceById, listInvoiceSummaries } from './invoices.repo.ts';
import { buildInvoiceDetail, ingestInvoiceFile, summaryRowToDTO } from './invoices.service.ts';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

const ALLOWED_EXT = /\.(csv|xlsx|xls)$/i;

/** Resolve the warehouse filter for the caller. Hub users are locked to their
 *  active, still-authorized warehouse; admins may optionally filter by one. */
function resolveScope(res: import('express').Response, queryWarehouseId?: number): number | undefined {
  const auth = getAuth(res);
  if (auth.role === ROLES.HUB) {
    if (auth.activeWarehouseId === undefined) {
      throw httpError.forbidden('Select an active warehouse before viewing invoices');
    }
    if (!isUserMappedToWarehouse(auth.userId, auth.activeWarehouseId)) {
      throw httpError.forbidden('You are no longer authorized for this warehouse');
    }
    const warehouse = getWarehouseById(auth.activeWarehouseId);
    if (!warehouse || warehouse.is_active !== 1) {
      throw httpError.forbidden('This warehouse is currently unavailable');
    }
    return auth.activeWarehouseId;
  }
  return queryWarehouseId;
}

function parseStatus(value: unknown): InvoiceStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const upper = value.toUpperCase();
  return (Object.values(INVOICE_STATUS) as string[]).includes(upper) ? (upper as InvoiceStatus) : undefined;
}

// POST /api/invoices/preview - dry-run parse + mapping + validation (admin).
router.post(
  '/preview',
  requireAuth,
  requireRole(ROLES.ADMIN),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw httpError.badRequest('No file uploaded (expected form field "file")');
    if (!ALLOWED_EXT.test(req.file.originalname)) {
      throw httpError.badRequest('Unsupported file type. Upload a .csv, .xlsx, or .xls file.');
    }
    const result = await ingestInvoiceFile({
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      commit: false,
      uploadedBy: getAuth(res).userId,
    });
    res.json(result);
  }),
);

// POST /api/invoices/upload - commit ingestion (admin). 201 on success, 422 if invalid.
router.post(
  '/upload',
  requireAuth,
  requireRole(ROLES.ADMIN),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw httpError.badRequest('No file uploaded (expected form field "file")');
    if (!ALLOWED_EXT.test(req.file.originalname)) {
      throw httpError.badRequest('Unsupported file type. Upload a .csv, .xlsx, or .xls file.');
    }
    const auth = getAuth(res);
    const result = await ingestInvoiceFile({
      buffer: req.file.buffer,
      fileName: req.file.originalname,
      commit: true,
      uploadedBy: auth.userId,
    });

    if (result.committed) {
      logAudit({
        actorUserId: auth.userId,
        action: 'INVOICE_UPLOAD',
        entity: 'invoice',
        entityId: null,
        metadata: { fileName: result.fileName, invoices: result.createdInvoiceIds.length, validRows: result.validRows },
      });
      res.status(201).json(result);
    } else {
      // Validation failed - nothing was written. Return the full report.
      res.status(422).json(result);
    }
  }),
);

// GET /api/invoices - scoped list with optional filters.
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const queryWarehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : undefined;
    const warehouseId = resolveScope(res, Number.isFinite(queryWarehouseId) ? queryWarehouseId : undefined);
    const vendor = typeof req.query.vendor === 'string' ? req.query.vendor : undefined;
    const status = parseStatus(req.query.status);

    const rows = listInvoiceSummaries({ warehouseId, vendor, status });
    res.json({ invoices: rows.map(summaryRowToDTO) });
  }),
);

// GET /api/invoices/:id - detail with lines + live received counts.
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw httpError.badRequest('Invalid invoice id');
    const invoice = getInvoiceById(id);
    if (!invoice) throw httpError.notFound('Invoice not found');

    // Data isolation: hub users may only open invoices for their active warehouse.
    const scope = resolveScope(res);
    if (scope !== undefined && invoice.warehouse_id !== scope) {
      throw httpError.forbidden('This invoice belongs to another warehouse');
    }

    const detail = buildInvoiceDetail(id);
    res.json({ invoice: detail });
  }),
);

export default router;
