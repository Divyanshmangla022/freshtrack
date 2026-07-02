import type { SQLInputValue } from 'node:sqlite';
import { db } from '../../db/database.ts';
import type { InvoiceStatus } from '../../types.ts';

export interface ReconciliationFilter {
  dateFrom?: string; // 'YYYY-MM-DD' (inclusive)
  dateTo?: string; // 'YYYY-MM-DD' (inclusive)
  warehouseId?: number;
  vendor?: string;
  status?: InvoiceStatus;
}

export interface ReconciliationRow {
  invoice_id: string;
  vendor_name: string;
  warehouse_id: number;
  warehouse_code: string;
  item_sku: string;
  item_name: string;
  expected_quantity: number;
  received_quantity: number;
  variance: number;
  status: InvoiceStatus;
  created_at: string;
}

function buildWhere(filter: ReconciliationFilter): { clause: string; params: SQLInputValue[] } {
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  if (filter.dateFrom) {
    clauses.push('i.created_at >= ?');
    params.push(filter.dateFrom);
  }
  if (filter.dateTo) {
    // Inclusive of the whole end day (created_at is ISO with a time component).
    clauses.push('i.created_at <= ?');
    params.push(`${filter.dateTo}T23:59:59.999Z`);
  }
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
  return { clause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/** One row per invoice line - the reconciliation grain required by the BRD §3.4. */
export function getReconciliationRows(filter: ReconciliationFilter): ReconciliationRow[] {
  const { clause, params } = buildWhere(filter);
  const sql = `
    SELECT i.invoice_id, i.vendor_name, i.warehouse_id, w.code AS warehouse_code,
           l.item_sku, l.item_name, l.expected_quantity, l.received_quantity,
           (l.expected_quantity - l.received_quantity) AS variance,
           i.status, i.created_at
    FROM invoice_lines l
    JOIN invoices i   ON i.id = l.invoice_ref
    JOIN warehouses w ON w.id = i.warehouse_id
    ${clause}
    ORDER BY i.invoice_id ASC, l.item_sku ASC`;
  return db.prepare(sql).all(...params) as unknown as ReconciliationRow[];
}
