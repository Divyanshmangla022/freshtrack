import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

/** Application-level error carrying an HTTP status and a stable machine code. */
export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const httpError = {
  badRequest: (msg: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', msg, details),
  unauthorized: (msg = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', msg),
  forbidden: (msg = 'You do not have access to this resource') => new AppError(403, 'FORBIDDEN', msg),
  notFound: (msg = 'Resource not found') => new AppError(404, 'NOT_FOUND', msg),
  conflict: (msg: string, details?: unknown) => new AppError(409, 'CONFLICT', msg, details),
  unprocessable: (msg: string, details?: unknown) => new AppError(422, 'UNPROCESSABLE', msg, details),
};

/** Wrap an async route handler so rejected promises reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

// SQLite constraint messages we translate into clean 409s.
function mapSqliteError(err: Error): AppError | null {
  const msg = err.message || '';
  if (msg.includes('UNIQUE constraint failed')) {
    return new AppError(409, 'CONFLICT', 'A record with the same unique value already exists', { detail: msg });
  }
  if (msg.includes('FOREIGN KEY constraint failed')) {
    return new AppError(409, 'CONFLICT', 'Operation violates a referential constraint', { detail: msg });
  }
  if (msg.includes('CHECK constraint failed')) {
    return new AppError(422, 'UNPROCESSABLE', 'A value failed a validation constraint', { detail: msg });
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  if (err instanceof Error) {
    const mapped = mapSqliteError(err);
    if (mapped) {
      res.status(mapped.status).json({ error: { code: mapped.code, message: mapped.message, details: mapped.details } });
      return;
    }
    console.error('[error] unhandled:', err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'An unexpected error occurred' } });
    return;
  }
  console.error('[error] non-error thrown:', err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'An unexpected error occurred' } });
}
