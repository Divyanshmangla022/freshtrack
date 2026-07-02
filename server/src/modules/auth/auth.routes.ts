import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, httpError } from '../../http/errors.ts';
import { EMAIL_REGEX, parse } from '../../http/validate.ts';
import { ROLES, toUserDTO, toWarehouseDTO } from '../../types.ts';
import { getUserByEmail, getUserById } from '../users/users.repo.ts';
import {
  getWarehouseById,
  isUserMappedToWarehouse,
  listWarehousesForUser,
} from '../warehouses/warehouses.repo.ts';
import { logAudit } from '../audit/audit.repo.ts';
import { getAuth, requireAuth, requireRole } from './auth.middleware.ts';
import { signToken, verifyPassword } from './auth.service.ts';

const router = Router();

const LoginSchema = z.object({
  email: z.string().trim().regex(EMAIL_REGEX, 'Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

const SelectWarehouseSchema = z.object({
  warehouseId: z.number().int().positive(),
});

// POST /api/auth/login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = parse(LoginSchema, req.body);
    const normalized = email.toLowerCase();
    const user = getUserByEmail(normalized);

    // Uniform failure to avoid leaking which accounts exist. Still run a hash
    // comparison against the stored (or a dummy) hash to reduce timing signal.
    const dummyHash = '$2a$10$C6UzMDM.H6dfI/f/IKcEeO3aa1a1a1a1a1a1a1a1a1a1a1a1a1a1';
    const ok = await verifyPassword(password, user?.password_hash ?? dummyHash);
    if (!user || user.is_active !== 1 || !ok) {
      throw httpError.unauthorized('Invalid credentials');
    }

    const token = signToken({
      userId: user.id,
      role: user.role,
      email: user.email,
      username: user.username,
    });
    const assigned = user.role === ROLES.HUB ? listWarehousesForUser(user.id) : undefined;
    logAudit({ actorUserId: user.id, action: 'AUTH_LOGIN', entity: 'user', entityId: user.id });

    res.json({ token, user: toUserDTO(user, assigned) });
  }),
);

// GET /api/auth/me
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const auth = getAuth(res);
    const user = getUserById(auth.userId);
    if (!user) throw httpError.unauthorized();
    const assigned = user.role === ROLES.HUB ? listWarehousesForUser(user.id) : undefined;
    const activeWarehouse =
      auth.activeWarehouseId !== undefined ? getWarehouseById(auth.activeWarehouseId) : undefined;
    res.json({
      user: toUserDTO(user, assigned),
      activeWarehouse: activeWarehouse ? toWarehouseDTO(activeWarehouse) : null,
    });
  }),
);

// POST /api/auth/select-warehouse  (hub users choose their active dock)
router.post(
  '/select-warehouse',
  requireAuth,
  requireRole(ROLES.HUB),
  asyncHandler(async (req, res) => {
    const auth = getAuth(res);
    const { warehouseId } = parse(SelectWarehouseSchema, req.body);

    if (!isUserMappedToWarehouse(auth.userId, warehouseId)) {
      throw httpError.forbidden('You are not assigned to this warehouse');
    }
    const warehouse = getWarehouseById(warehouseId);
    if (!warehouse || warehouse.is_active !== 1) {
      throw httpError.badRequest('Warehouse is unavailable');
    }

    const token = signToken({
      userId: auth.userId,
      role: auth.role,
      email: auth.email,
      username: auth.username,
      activeWarehouseId: warehouseId,
    });
    logAudit({
      actorUserId: auth.userId,
      action: 'WAREHOUSE_ENTER',
      entity: 'warehouse',
      entityId: warehouseId,
    });
    res.json({ token, activeWarehouse: toWarehouseDTO(warehouse) });
  }),
);

// POST /api/auth/logout  (stateless JWT - client discards the token)
router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const auth = getAuth(res);
    logAudit({ actorUserId: auth.userId, action: 'AUTH_LOGOUT', entity: 'user', entityId: auth.userId });
    res.status(204).end();
  }),
);

export default router;
