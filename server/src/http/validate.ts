import type { ZodType } from 'zod';

/**
 * Practical email format check (local-part @ domain . TLD>=2). Shared by the
 * login and user-creation schemas so both enforce the same rule.
 */
export const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/**
 * Parse `data` against a Zod schema, returning the typed result. A ZodError
 * thrown here is caught by the central error handler and rendered as a 400.
 * Using inline `parse(...)` in handlers keeps full static typing (no `any`
 * leaking from a generic middleware) while centralising error formatting.
 */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data);
}
