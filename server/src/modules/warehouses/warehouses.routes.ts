import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, httpError } from '../../http/errors.ts';
import { parse } from '../../http/validate.ts';
import { ROLES, toWarehouseDTO } from '../../types.ts';
import { getAuth, requireAuth, requireRole } from '../auth/auth.middleware.ts';
import { logAudit } from '../audit/audit.repo.ts';
import {
  createWarehouse,
  getWarehouseByCode,
  getWarehouseById,
  listWarehouses,
  listWarehousesForUser,
  updateWarehouse,
} from './warehouses.repo.ts';

const router = Router();

const CreateSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).nullish(),
  isActive: z.boolean().optional(),
});

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).nullish(),
  isActive: z.boolean(),
});

// GET /api/warehouses - admins see all; hub users see only their assigned docks.
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const auth = getAuth(res);
    const rows = auth.role === ROLES.ADMIN ? listWarehouses() : listWarehousesForUser(auth.userId);
    res.json({ warehouses: rows.map(toWarehouseDTO) });
  }),
);

// POST /api/warehouses - Central Admin only.
router.post(
  '/',
  requireAuth,
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const auth = getAuth(res);
    const body = parse(CreateSchema, req.body);
    const code = body.code.toUpperCase();
    if (getWarehouseByCode(code)) {
      throw httpError.conflict(`Warehouse code "${code}" already exists`);
    }
    const created = createWarehouse({
      code,
      name: body.name,
      location: body.location ?? null,
      isActive: body.isActive,
    });
    logAudit({ actorUserId: auth.userId, action: 'WAREHOUSE_CREATE', entity: 'warehouse', entityId: created.id, metadata: { code } });
    res.status(201).json({ warehouse: toWarehouseDTO(created) });
  }),
);

// PATCH /api/warehouses/:id - Central Admin only.
router.patch(
  '/:id',
  requireAuth,
  requireRole(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const auth = getAuth(res);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw httpError.badRequest('Invalid warehouse id');
    if (!getWarehouseById(id)) throw httpError.notFound('Warehouse not found');
    const body = parse(UpdateSchema, req.body);
    const updated = updateWarehouse(id, {
      name: body.name,
      location: body.location ?? null,
      isActive: body.isActive,
    });
    logAudit({ actorUserId: auth.userId, action: 'WAREHOUSE_UPDATE', entity: 'warehouse', entityId: id });
    res.json({ warehouse: toWarehouseDTO(updated!) });
  }),
);

export default router;
