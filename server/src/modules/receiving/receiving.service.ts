import { tx, nowIso } from '../../db/database.ts';
import { INVOICE_STATUS, SCAN_TYPES } from '../../types.ts';
import type { AuthContext, InvoiceLineDTO, InvoiceStatus, ScanType } from '../../types.ts';
import {
  getInvoiceLineById,
  getInvoiceLines,
  setInvoiceStatus,
} from '../invoices/invoices.repo.ts';
import type { InvoiceLineRow } from '../../types.ts';
import { lineRowToDTO } from '../invoices/invoices.service.ts';
import { invoiceTopic, publish } from '../../realtime/hub.ts';
import { recordScanEvent, scanEventExists, setLineReceived } from './receiving.repo.ts';

export interface ScanEventInput {
  itemSku: string;
  delta?: number; // defaults to 1; must be a positive integer
  type?: ScanType; // SCAN (default) or MANUAL_INCREMENT
  clientEventId?: string;
}

export interface ScanEventResult {
  clientEventId?: string;
  itemSku: string;
  matched: boolean;
  receivedQuantity?: number;
  expectedQuantity?: number;
  variance?: number;
}

export interface ReceivingTotals {
  expected: number;
  received: number;
  lineCount: number;
  completedLines: number;
}

export interface ReceivingUpdate {
  results?: ScanEventResult[];
  lines: InvoiceLineDTO[]; // only the lines that changed
  totals: ReceivingTotals;
  status: InvoiceStatus;
}

function computeStatus(lines: InvoiceLineRow[]): InvoiceStatus {
  if (lines.length === 0) return INVOICE_STATUS.OPEN;
  const anyReceived = lines.some((l) => l.received_quantity > 0);
  const allComplete = lines.every((l) => l.received_quantity >= l.expected_quantity);
  if (allComplete) return INVOICE_STATUS.COMPLETED;
  if (anyReceived) return INVOICE_STATUS.IN_PROGRESS;
  return INVOICE_STATUS.OPEN;
}

function totalsOf(lines: InvoiceLineRow[]): ReceivingTotals {
  let expected = 0;
  let received = 0;
  let completedLines = 0;
  for (const l of lines) {
    expected += l.expected_quantity;
    received += l.received_quantity;
    if (l.received_quantity >= l.expected_quantity) completedLines += 1;
  }
  return { expected, received, lineCount: lines.length, completedLines };
}

function broadcast(invoiceRef: number, update: ReceivingUpdate): void {
  publish(invoiceTopic(invoiceRef), 'progress', {
    type: 'progress',
    invoiceRef,
    status: update.status,
    totals: update.totals,
    lines: update.lines,
    at: nowIso(),
  });
}

/**
 * Apply a batch of scan/manual-increment events to one invoice, atomically.
 * The whole batch runs in a single synchronous transaction - Node's single
 * thread plus node:sqlite's synchronous API mean there are no interleaving
 * await points, so rapid-fire scans cannot lose or skip counts. Every event
 * appends an immutable audit row.
 */
export function applyScanBatch(input: {
  auth: AuthContext;
  invoiceRef: number;
  invoiceBusinessId: string;
  warehouseId: number;
  events: ScanEventInput[];
}): ReceivingUpdate {
  const linesBySku = new Map<string, InvoiceLineRow>();
  for (const line of getInvoiceLines(input.invoiceRef)) linesBySku.set(line.item_sku, line);

  const results: ScanEventResult[] = [];
  const changedLineIds = new Set<number>();

  tx(() => {
    for (const ev of input.events) {
      const delta = ev.delta ?? 1;
      const type: ScanType = ev.type ?? SCAN_TYPES.SCAN;
      const line = linesBySku.get(ev.itemSku);
      if (!line) {
        results.push({ clientEventId: ev.clientEventId, itemSku: ev.itemSku, matched: false });
        continue;
      }
      // Idempotency: if this client_event_id was already recorded (e.g. a
      // lost-ACK retry that actually committed server-side), do not re-apply it.
      if (ev.clientEventId && scanEventExists(ev.clientEventId)) {
        results.push({
          clientEventId: ev.clientEventId,
          itemSku: ev.itemSku,
          matched: true,
          receivedQuantity: line.received_quantity,
          expectedQuantity: line.expected_quantity,
          variance: line.expected_quantity - line.received_quantity,
        });
        continue;
      }
      const newQty = line.received_quantity + delta;
      setLineReceived(line.id, newQty);
      recordScanEvent({
        invoiceLineId: line.id,
        invoiceRef: input.invoiceRef,
        invoiceBusinessId: input.invoiceBusinessId,
        itemSku: line.item_sku,
        warehouseId: input.warehouseId,
        userId: input.auth.userId,
        type,
        delta,
        quantityAfter: newQty,
        clientEventId: ev.clientEventId ?? null,
      });
      line.received_quantity = newQty;
      changedLineIds.add(line.id);
      results.push({
        clientEventId: ev.clientEventId,
        itemSku: ev.itemSku,
        matched: true,
        receivedQuantity: newQty,
        expectedQuantity: line.expected_quantity,
        variance: line.expected_quantity - newQty,
      });
    }

    const allLines = [...linesBySku.values()];
    setInvoiceStatus(input.invoiceRef, computeStatus(allLines));
  });

  const allLines = [...linesBySku.values()];
  const update: ReceivingUpdate = {
    results,
    lines: allLines.filter((l) => changedLineIds.has(l.id)).map(lineRowToDTO),
    totals: totalsOf(allLines),
    status: computeStatus(allLines),
  };
  if (changedLineIds.size > 0) broadcast(input.invoiceRef, update);
  return update;
}

/** Manually override a line's received quantity to an absolute value (audited). */
export function overrideLine(input: {
  auth: AuthContext;
  invoiceRef: number;
  invoiceBusinessId: string;
  warehouseId: number;
  lineId: number;
  quantity: number;
  reason?: string | null;
}): ReceivingUpdate | null {
  const line = getInvoiceLineById(input.lineId);
  if (!line || line.invoice_ref !== input.invoiceRef) return null;

  tx(() => {
    const delta = input.quantity - line.received_quantity;
    setLineReceived(line.id, input.quantity);
    recordScanEvent({
      invoiceLineId: line.id,
      invoiceRef: input.invoiceRef,
      invoiceBusinessId: input.invoiceBusinessId,
      itemSku: line.item_sku,
      warehouseId: input.warehouseId,
      userId: input.auth.userId,
      type: SCAN_TYPES.OVERRIDE,
      delta,
      quantityAfter: input.quantity,
      reason: input.reason ?? null,
    });
    line.received_quantity = input.quantity;
    const allLines = getInvoiceLines(input.invoiceRef);
    setInvoiceStatus(input.invoiceRef, computeStatus(allLines));
  });

  const allLines = getInvoiceLines(input.invoiceRef);
  const update: ReceivingUpdate = {
    lines: allLines.filter((l) => l.id === input.lineId).map(lineRowToDTO),
    totals: totalsOf(allLines),
    status: computeStatus(allLines),
  };
  broadcast(input.invoiceRef, update);
  return update;
}
