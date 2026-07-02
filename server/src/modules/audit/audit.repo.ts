import { db } from '../../db/database.ts';

const insert = db.prepare(
  'INSERT INTO audit_logs (actor_user_id, action, entity, entity_id, metadata) VALUES (?, ?, ?, ?, ?)',
);
const selectRecent = db.prepare(
  `SELECT a.*, u.username AS actor_username, u.email AS actor_email
   FROM audit_logs a
   LEFT JOIN users u ON u.id = a.actor_user_id
   ORDER BY a.created_at DESC, a.id DESC
   LIMIT ?`,
);

export function logAudit(entry: {
  actorUserId?: number | null;
  action: string;
  entity?: string | null;
  entityId?: string | number | null;
  metadata?: unknown;
}): void {
  insert.run(
    entry.actorUserId ?? null,
    entry.action,
    entry.entity ?? null,
    entry.entityId != null ? String(entry.entityId) : null,
    entry.metadata !== undefined ? JSON.stringify(entry.metadata) : null,
  );
}

export interface AuditLogRow {
  id: number;
  actor_user_id: number | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  metadata: string | null;
  created_at: string;
  actor_username: string | null;
  actor_email: string | null;
}

export function listRecentAudit(limit = 100): AuditLogRow[] {
  return selectRecent.all(limit) as unknown as AuditLogRow[];
}
