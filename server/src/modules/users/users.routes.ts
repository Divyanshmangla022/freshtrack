import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, httpError } from '../../http/errors.ts';
import { EMAIL_REGEX, parse } from '../../http/validate.ts';
import { ROLES, toUserDTO } from '../../types.ts';
import { hashPassword } from '../auth/auth.service.ts';
import { getAuth, requireAuth, requireRole } from '../auth/auth.middleware.ts';
import { logAudit } from '../audit/audit.repo.ts';
import { getWarehouseById, listWarehousesForUser } from '../warehouses/warehouses.repo.ts';
import {
  createUser,
  getUserByEmail,
  getUserById,
  listUsers,
  setUserActive,
  setUserPassword,
  setUserWarehouses,
} from './users.repo.ts';

const router = Router();

// All user administration is Central Admin only.
router.use(requireAuth, requireRole(ROLES.ADMIN));

const CreateSchema = z.object({
  email: z.string().trim().max(200).regex(EMAIL_REGEX, 'Enter a valid email address'),
  username: z.string().trim().min(1).max(120),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  role: z.enum([ROLES.ADMIN, ROLES.HUB]),
  warehouseIds: z.array(z.number().int().positive()).optional(),
});

const UpdateSchema = z
  .object({
    isActive: z.boolean().optional(),
    password: z.string().min(8).max(200).optional(),
  })
  .refine((v) => v.isActive !== undefined || v.password !== undefined, {
    message: 'Provide at least one field to update',
  });

const WarehousesSchema = z.object({
  warehouseIds: z.array(z.number().int().positive()),
});

function userWithWarehouses(id: number) {
  const u = getUserById(id)!;
  const wh = u.role === ROLES.HUB ? listWarehousesForUser(u.id) : undefined;
  return toUserDTO(u, wh);
}

function assertWarehousesExist(ids: number[]): void {
  const unique = [...new Set(ids)];
  for (const id of unique) {
    if (!getWarehouseById(id)) throw httpError.badRequest(`Warehouse ${id} does not exist`);
  }
}

// GET /api/users
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const users = listUsers().map((u) =>
      toUserDTO(u, u.role === ROLES.HUB ? listWarehousesForUser(u.id) : undefined),
    );
    res.json({ users });
  }),
);

// GET /api/users/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !getUserById(id)) throw httpError.notFound('User not found');
    res.json({ user: userWithWarehouses(id) });
  }),
);

// POST /api/users
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const admin = getAuth(res);
    const body = parse(CreateSchema, req.body);
    const email = body.email.toLowerCase();

    if (getUserByEmail(email)) throw httpError.conflict('A user with this email already exists');

    const wanted = body.warehouseIds ?? [];
    if (body.role !== ROLES.HUB && wanted.length > 0) {
      throw httpError.badRequest('Only hub users can be mapped to warehouses');
    }
    assertWarehousesExist(wanted);

    const passwordHash = await hashPassword(body.password);
    const created = createUser({ email, username: body.username, passwordHash, role: body.role });
    if (body.role === ROLES.HUB && wanted.length > 0) {
      setUserWarehouses(created.id, [...new Set(wanted)]);
    }
    logAudit({ actorUserId: admin.userId, action: 'USER_CREATE', entity: 'user', entityId: created.id, metadata: { role: body.role } });
    res.status(201).json({ user: userWithWarehouses(created.id) });
  }),
);

// PATCH /api/users/:id  (activate/deactivate, reset password)
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const admin = getAuth(res);
    const id = Number(req.params.id);
    const target = Number.isInteger(id) ? getUserById(id) : undefined;
    if (!target) throw httpError.notFound('User not found');
    const body = parse(UpdateSchema, req.body);

    if (body.isActive !== undefined) {
      if (target.id === admin.userId && body.isActive === false) {
        throw httpError.badRequest('You cannot deactivate your own account');
      }
      setUserActive(id, body.isActive);
    }
    if (body.password !== undefined) {
      setUserPassword(id, await hashPassword(body.password));
    }
    logAudit({ actorUserId: admin.userId, action: 'USER_UPDATE', entity: 'user', entityId: id, metadata: { fields: Object.keys(body) } });
    res.json({ user: userWithWarehouses(id) });
  }),
);

// PUT /api/users/:id/warehouses  (replace the user's full warehouse mapping)
router.put(
  '/:id/warehouses',
  asyncHandler(async (req, res) => {
    const admin = getAuth(res);
    const id = Number(req.params.id);
    const target = Number.isInteger(id) ? getUserById(id) : undefined;
    if (!target) throw httpError.notFound('User not found');
    if (target.role !== ROLES.HUB) throw httpError.badRequest('Only hub users can be mapped to warehouses');

    const { warehouseIds } = parse(WarehousesSchema, req.body);
    assertWarehousesExist(warehouseIds);
    setUserWarehouses(id, [...new Set(warehouseIds)]);
    logAudit({ actorUserId: admin.userId, action: 'USER_MAP_WAREHOUSES', entity: 'user', entityId: id, metadata: { warehouseIds } });
    res.json({ user: userWithWarehouses(id) });
  }),
);

export default router;
