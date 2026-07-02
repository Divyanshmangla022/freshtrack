import { Router } from 'express';
import { asyncHandler } from '../../http/errors.ts';
import { ROLES } from '../../types.ts';
import { requireAuth, requireRole } from '../auth/auth.middleware.ts';
import { listRecentAudit } from './audit.repo.ts';
import type { AuditLogRow } from './audit.repo.ts';

const router = Router();

router.use(requireAuth, requireRole(ROLES.ADMIN));

function toDTO(r: AuditLogRow) {
  let metadata: unknown = null;
  if (r.metadata) {
    try {
      metadata = JSON.parse(r.metadata);
    } catch {
      metadata = r.metadata;
    }
  }
  return {
    id: r.id,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    actorUserId: r.actor_user_id,
    actorUsername: r.actor_username,
    actorEmail: r.actor_email,
    metadata,
    createdAt: r.created_at,
  };
}

// GET /api/audit - recent audit log entries (admin).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json({ entries: listRecentAudit(limit).map(toDTO) });
  }),
);

export default router;
