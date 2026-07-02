import type { NextFunction, Request, Response } from 'express';
import { httpError } from '../../http/errors.ts';
import type { AuthContext, Role } from '../../types.ts';
import { verifyToken } from './auth.service.ts';
import { getUserById } from '../users/users.repo.ts';
import { getWarehouseById, isUserMappedToWarehouse } from '../warehouses/warehouses.repo.ts';

// res.locals is loosely typed; centralise access through these helpers.
export function getAuth(res: Response): AuthContext {
  const auth = (res.locals as { auth?: AuthContext }).auth;
  if (!auth) throw httpError.unauthorized();
  return auth;
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  // Fallback for EventSource / file downloads that cannot set headers.
  const q = req.query.token;
  if (typeof q === 'string' && q.length > 0) return q;
  return null;
}

/**
 * Authenticate the request from its bearer token, then re-load the user from the
 * database so role changes and de-activations take effect immediately (the token
 * is not the source of truth for role/active state - the DB is).
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) return next(httpError.unauthorized());

  const claims = verifyToken(token);
  if (!claims) return next(httpError.unauthorized('Invalid or expired session'));

  const user = getUserById(claims.userId);
  if (!user || user.is_active !== 1) {
    return next(httpError.unauthorized('Account is inactive or no longer exists'));
  }

  const auth: AuthContext = {
    userId: user.id,
    role: user.role,
    email: user.email,
    username: user.username,
    ...(claims.activeWarehouseId !== undefined ? { activeWarehouseId: claims.activeWarehouseId } : {}),
  };
  (res.locals as { auth?: AuthContext }).auth = auth;
  next();
}

export function requireRole(...roles: Role[]) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const auth = getAuth(res);
    if (!roles.includes(auth.role)) {
      return next(httpError.forbidden('Your role does not permit this action'));
    }
    next();
  };
}

/**
 * Enforce warehouse-scoped data isolation for hub users: the request must carry
 * an active warehouse in its token, and the user must still be mapped to it.
 * Re-checking the mapping on every request means revoking a mapping instantly
 * revokes access even for an already-issued token.
 */
export function requireActiveWarehouse(_req: Request, res: Response, next: NextFunction): void {
  const auth = getAuth(res);
  if (auth.activeWarehouseId === undefined) {
    return next(httpError.forbidden('Select an active warehouse before accessing this resource'));
  }
  if (!isUserMappedToWarehouse(auth.userId, auth.activeWarehouseId)) {
    return next(httpError.forbidden('You are no longer authorized for this warehouse'));
  }
  const warehouse = getWarehouseById(auth.activeWarehouseId);
  if (!warehouse || warehouse.is_active !== 1) {
    return next(httpError.forbidden('This warehouse is currently unavailable'));
  }
  next();
}
