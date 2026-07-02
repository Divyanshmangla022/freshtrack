import type { SQLInputValue } from 'node:sqlite';
import { db, tx } from '../../db/database.ts';
import type { InvoiceLineRow, InvoiceRow, InvoiceStatus } from '../../types.ts';

const insertInvoice = db.prepare(
  'INSERT INTO invoices (invoice_id, vendor_name, warehouse_id, uploaded_by) VALUES (?, ?, ?, ?)',
);
const insertLine = db.prepare(
  'INSERT INTO invoice_lines (invoice_ref, item_sku, item_name, expected_quantity) VALUES (?, ?, ?, ?)',
);
const selectByBusinessId = db.prepare('SELECT * FROM invoices WHERE invoice_id = ?');
const selectById = db.prepare('SELECT * FROM invoices WHERE id = ?');
const selectLines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_ref = ? ORDER BY item_sku ASC');
const selectLineBySku = db.prepare('SELECT * FROM invoice_lines WHERE invoice_ref = ? AND item_sku = ?');
const selectLineById = db.prepare('SELECT * FROM invoice_lines WHERE id = ?');
const updateStatus = db.prepare('UPDATE invoices SET status = ? WHERE id = ?');

export interface InvoiceSummaryRow {
  id: number;
  invoice_id: string;
  vendor_name: string;
  warehouse_id: number;
  warehouse_code: string;
  status: InvoiceStatus;
  created_at: string;
  total_expected: number;
  total_received: number;
  line_count: number;
}

export interface NewInvoice {
  invoiceId: string;
  vendorName: string;
  warehouseId: number;
  uploadedBy: number | null;
  lines: Array<{ itemSku: string; itemName: string; expectedQuantity: number }>;
}

export function getInvoiceByBusinessId(invoiceId: string): InvoiceRow | undefined {
  return selectByBusinessId.get(invoiceId) as InvoiceRow | undefined;
}

export function getInvoiceById(id: number): InvoiceRow | undefined {
  return selectById.get(id) as InvoiceRow | undefined;
}

export function getInvoiceLines(invoiceRef: number): InvoiceLineRow[] {
  return selectLines.all(invoiceRef) as unknown as InvoiceLineRow[];
}

export function getInvoiceLineBySku(invoiceRef: number, sku: string): InvoiceLineRow | undefined {
  return selectLineBySku.get(invoiceRef, sku) as InvoiceLineRow | undefined;
}

export function getInvoiceLineById(id: number): InvoiceLineRow | undefined {
  return selectLineById.get(id) as InvoiceLineRow | undefined;
}

export function setInvoiceStatus(id: number, status: InvoiceStatus): void {
  updateStatus.run(status, id);
}

/** Insert several invoices (with their lines) atomically. Returns created ids. */
export function createInvoices(invoices: NewInvoice[]): number[] {
  return tx(() => {
    const ids: number[] = [];
    for (const inv of invoices) {
      const info = insertInvoice.run(inv.invoiceId, inv.vendorName, inv.warehouseId, inv.uploadedBy);
      const invoiceRef = Number(info.lastInsertRowid);
      for (const line of inv.lines) {
        insertLine.run(invoiceRef, line.itemSku, line.itemName, line.expectedQuantity);
      }
      ids.push(invoiceRef);
    }
    return ids;
  });
}

function buildFilter(filter: {
  warehouseId?: number;
  vendor?: string;
  status?: InvoiceStatus;
  invoiceId?: number;
}): { clause: string; params: SQLInputValue[] } {
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  if (filter.warehouseId !== undefined) {
    clauses.push('i.warehouse_id = ?');
    params.push(filter.warehouseId);
  }
  if (filter.vendor) {
    const v = filter.vendor.replace(/[%_\\]/g, '\\$&'); // escape LIKE wildcards
    clauses.push("i.vendor_name LIKE ? ESCAPE '\\'");
    params.push(`%${v}%`);
  }
  if (filter.status) {
    clauses.push('i.status = ?');
    params.push(filter.status);
  }
  if (filter.invoiceId !== undefined) {
    clauses.push('i.id = ?');
    params.push(filter.invoiceId);
  }
  return { clause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

const SUMMARY_SELECT = `
  SELECT i.id, i.invoice_id, i.vendor_name, i.warehouse_id, w.code AS warehouse_code,
         i.status, i.created_at,
         COALESCE(SUM(l.expected_quantity), 0) AS total_expected,
         COALESCE(SUM(l.received_quantity), 0) AS total_received,
         COUNT(l.id) AS line_count
  FROM invoices i
  JOIN warehouses w ON w.id = i.warehouse_id
  LEFT JOIN invoice_lines l ON l.invoice_ref = i.id`;

export function listInvoiceSummaries(filter: {
  warehouseId?: number;
  vendor?: string;
  status?: InvoiceStatus;
}): InvoiceSummaryRow[] {
  const { clause, params } = buildFilter(filter);
  const sql = `${SUMMARY_SELECT} ${clause} GROUP BY i.id ORDER BY i.created_at DESC, i.id DESC`;
  return db.prepare(sql).all(...params) as unknown as InvoiceSummaryRow[];
}

export function getInvoiceSummary(id: number): InvoiceSummaryRow | undefined {
  const { clause, params } = buildFilter({ invoiceId: id });
  const sql = `${SUMMARY_SELECT} ${clause} GROUP BY i.id`;
  return db.prepare(sql).get(...params) as unknown as InvoiceSummaryRow | undefined;
}
