import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, httpError } from '../../http/errors.ts';
import { parse } from '../../http/validate.ts';
import { ROLES, SCAN_TYPES } from '../../types.ts';
import type { InvoiceRow } from '../../types.ts';
import { getAuth, requireActiveWarehouse, requireAuth, requireRole } from '../auth/auth.middleware.ts';
import { getWarehouseById, isUserMappedToWarehouse } from '../warehouses/warehouses.repo.ts';
import { getInvoiceById } from '../invoices/invoices.repo.ts';
import { invoiceTopic, subscribe } from '../../realtime/hub.ts';
import { listScanEvents } from './receiving.repo.ts';
import type { ScanEventWithUser } from './receiving.repo.ts';
import { applyScanBatch, overrideLine } from './receiving.service.ts';

const router = Router();

const ScanBatchSchema = z.object({
  events: z
    .array(
      z.object({
        itemSku: z.string().trim().min(1).max(128),
        delta: z.number().int().positive().max(100_000).optional(),
        type: z.enum([SCAN_TYPES.SCAN, SCAN_TYPES.MANUAL]).optional(),
        clientEventId: z.string().max(64).optional(),
      }),
    )
    .min(1)
    .max(500),
});

const OverrideSchema = z.object({
  quantity: z.number().int().min(0).max(100_000_000),
  reason: z.string().trim().max(500).optional(),
});

function invoiceId(req: import('express').Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw httpError.badRequest('Invalid invoice id');
  return id;
}

/** Load an invoice and enforce warehouse-scoped access for hub users. */
function loadScopedInvoice(res: import('express').Response, id: number): InvoiceRow {
  const invoice = getInvoiceById(id);
  if (!invoice) throw httpError.notFound('Invoice not found');
  const auth = getAuth(res);
  if (auth.role === ROLES.HUB) {
    if (auth.activeWarehouseId === undefined || invoice.warehouse_id !== auth.activeWarehouseId) {
      throw httpError.forbidden('This invoice belongs to another warehouse');
    }
    if (!isUserMappedToWarehouse(auth.userId, auth.activeWarehouseId)) {
      throw httpError.forbidden('You are no longer authorized for this warehouse');
    }
    const warehouse = getWarehouseById(auth.activeWarehouseId);
    if (!warehouse || warehouse.is_active !== 1) {
      throw httpError.forbidden('This warehouse is currently unavailable');
    }
  }
  return invoice;
}

function eventToDTO(e: ScanEventWithUser) {
  return {
    id: e.id,
    invoiceLineId: e.invoice_line_id,
    invoiceBusinessId: e.invoice_business_id,
    itemSku: e.item_sku,
    type: e.type,
    delta: e.delta,
    quantityAfter: e.quantity_after,
    reason: e.reason,
    clientEventId: e.client_event_id,
    userId: e.user_id,
    userName: e.user_name,
    createdAt: e.created_at,
  };
}

// POST /api/receiving/invoices/:id/scan-batch - rapid-fire scan ingestion.
router.post(
  '/invoices/:id/scan-batch',
  requireAuth,
  requireRole(ROLES.HUB),
  requireActiveWarehouse,
  asyncHandler(async (req, res) => {
    const id = invoiceId(req);
    const invoice = loadScopedInvoice(res, id);
    const { events } = parse(ScanBatchSchema, req.body);
    const auth = getAuth(res);
    const update = applyScanBatch({
      auth,
      invoiceRef: invoice.id,
      invoiceBusinessId: invoice.invoice_id,
      warehouseId: invoice.warehouse_id,
      events,
    });
    res.json(update);
  }),
);

// POST /api/receiving/invoices/:id/lines/:lineId/override - audited manual override.
router.post(
  '/invoices/:id/lines/:lineId/override',
  requireAuth,
  requireRole(ROLES.HUB),
  requireActiveWarehouse,
  asyncHandler(async (req, res) => {
    const id = invoiceId(req);
    const lineId = Number(req.params.lineId);
    if (!Number.isInteger(lineId)) throw httpError.badRequest('Invalid line id');
    const invoice = loadScopedInvoice(res, id);
    const { quantity, reason } = parse(OverrideSchema, req.body);
    const update = overrideLine({
      auth: getAuth(res),
      invoiceRef: invoice.id,
      invoiceBusinessId: invoice.invoice_id,
      warehouseId: invoice.warehouse_id,
      lineId,
      quantity,
      reason: reason ?? null,
    });
    if (!update) throw httpError.notFound('Invoice line not found');
    res.json(update);
  }),
);

// GET /api/receiving/invoices/:id/events - audit trail for this invoice.
router.get(
  '/invoices/:id/events',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = invoiceId(req);
    const invoice = loadScopedInvoice(res, id);
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const events = listScanEvents(invoice.id, limit).map(eventToDTO);
    res.json({ events });
  }),
);

// GET /api/receiving/invoices/:id/stream - live SSE progress feed.
router.get(
  '/invoices/:id/stream',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = invoiceId(req);
    const invoice = loadScopedInvoice(res, id);
    subscribe(invoiceTopic(invoice.id), res, { userId: getAuth(res).userId });
  }),
);

export default router;
