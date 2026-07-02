import { db } from '../../db/database.ts';
import type { ScanType } from '../../types.ts';

const setLineQuantity = db.prepare('UPDATE invoice_lines SET received_quantity = ? WHERE id = ?');
const existsByClientEventId = db.prepare('SELECT 1 AS ok FROM scan_events WHERE client_event_id = ?');
const insertEvent = db.prepare(
  `INSERT INTO scan_events
     (invoice_line_id, invoice_ref, invoice_business_id, item_sku, warehouse_id, user_id, type, delta, quantity_after, reason, client_event_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const selectEvents = db.prepare(
  `SELECT s.*, u.username AS user_name, u.email AS user_email
   FROM scan_events s
   LEFT JOIN users u ON u.id = s.user_id
   WHERE s.invoice_ref = ?
   ORDER BY s.created_at DESC, s.id DESC
   LIMIT ?`,
);

export function setLineReceived(lineId: number, quantity: number): void {
  setLineQuantity.run(quantity, lineId);
}

/** True if a scan with this client_event_id has already been recorded. */
export function scanEventExists(clientEventId: string): boolean {
  return existsByClientEventId.get(clientEventId) !== undefined;
}

export function recordScanEvent(e: {
  invoiceLineId: number;
  invoiceRef: number;
  invoiceBusinessId: string;
  itemSku: string;
  warehouseId: number;
  userId: number;
  type: ScanType;
  delta: number;
  quantityAfter: number;
  reason?: string | null;
  clientEventId?: string | null;
}): void {
  insertEvent.run(
    e.invoiceLineId,
    e.invoiceRef,
    e.invoiceBusinessId,
    e.itemSku,
    e.warehouseId,
    e.userId,
    e.type,
    e.delta,
    e.quantityAfter,
    e.reason ?? null,
    e.clientEventId ?? null,
  );
}

export interface ScanEventWithUser {
  id: number;
  invoice_line_id: number;
  invoice_ref: number;
  invoice_business_id: string;
  item_sku: string;
  warehouse_id: number;
  user_id: number;
  type: ScanType;
  delta: number;
  quantity_after: number;
  reason: string | null;
  client_event_id: string | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
}

export function listScanEvents(invoiceRef: number, limit = 200): ScanEventWithUser[] {
  return selectEvents.all(invoiceRef, limit) as unknown as ScanEventWithUser[];
}
