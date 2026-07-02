import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../config.ts';
import type { AuthContext, Role } from '../../types.ts';

const BCRYPT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

interface TokenClaims {
  uid: number;
  role: Role;
  email: string;
  username: string;
  /** active warehouse (hub users only) */
  wh?: number;
}

export function signToken(input: {
  userId: number;
  role: Role;
  email: string;
  username: string;
  activeWarehouseId?: number;
}): string {
  const claims: TokenClaims = {
    uid: input.userId,
    role: input.role,
    email: input.email,
    username: input.username,
    ...(input.activeWarehouseId !== undefined ? { wh: input.activeWarehouseId } : {}),
  };
  return jwt.sign(claims, config.jwtSecret, { expiresIn: config.tokenTtl } as jwt.SignOptions);
}

export function verifyToken(token: string): AuthContext | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as TokenClaims;
    if (typeof decoded !== 'object' || typeof decoded.uid !== 'number') return null;
    return {
      userId: decoded.uid,
      role: decoded.role,
      email: decoded.email,
      username: decoded.username,
      ...(decoded.wh !== undefined ? { activeWarehouseId: decoded.wh } : {}),
    };
  } catch {
    return null;
  }
}
