import * as XLSX from 'xlsx';
import type { InvoiceStatus } from '../../types.ts';
import type { ReconciliationRow } from './reports.repo.ts';

export interface ReconciliationRowDTO {
  invoiceId: string;
  vendorName: string;
  warehouseId: number;
  warehouseCode: string;
  itemSku: string;
  itemName: string;
  expectedQuantity: number;
  receivedQuantity: number;
  variance: number;
  status: InvoiceStatus;
  createdAt: string;
}

export function rowToDTO(r: ReconciliationRow): ReconciliationRowDTO {
  return {
    invoiceId: r.invoice_id,
    vendorName: r.vendor_name,
    warehouseId: r.warehouse_id,
    warehouseCode: r.warehouse_code,
    itemSku: r.item_sku,
    itemName: r.item_name,
    expectedQuantity: r.expected_quantity,
    receivedQuantity: r.received_quantity,
    variance: r.variance,
    status: r.status,
    createdAt: r.created_at,
  };
}

export interface GroupAggregate {
  key: string;
  label: string;
  invoices: number;
  expected: number;
  received: number;
  variance: number;
}

export interface InvoiceAggregate {
  invoiceId: string;
  vendorName: string;
  warehouseCode: string;
  status: string;
  expected: number;
  received: number;
  variance: number;
  lineCount: number;
}

export interface ReportSummary {
  totals: {
    invoices: number;
    lines: number;
    expected: number;
    received: number;
    variance: number;
    fillRate: number; // received / expected (0..1)
    completedInvoices: number;
    linesWithVariance: number;
  };
  byWarehouse: GroupAggregate[];
  byVendor: GroupAggregate[];
  byInvoice: InvoiceAggregate[];
  topVariances: ReconciliationRowDTO[];
}

export function buildSummary(rows: ReconciliationRow[]): ReportSummary {
  let expected = 0;
  let received = 0;
  let linesWithVariance = 0;

  const warehouses = new Map<string, GroupAggregate & { code: string }>();
  const vendors = new Map<string, GroupAggregate>();
  const invoiceIds = new Set<string>();
  const invoiceComplete = new Map<string, boolean>();
  const invoiceAgg = new Map<string, InvoiceAggregate>();

  for (const r of rows) {
    expected += r.expected_quantity;
    received += r.received_quantity;
    if (r.variance !== 0) linesWithVariance += 1;
    invoiceIds.add(r.invoice_id);

    // An invoice is "complete" only if every one of its lines is fully received.
    const lineComplete = r.received_quantity >= r.expected_quantity;
    const prev = invoiceComplete.get(r.invoice_id);
    invoiceComplete.set(r.invoice_id, prev === undefined ? lineComplete : prev && lineComplete);

    const wKey = String(r.warehouse_id);
    const w = warehouses.get(wKey) ?? { key: wKey, code: r.warehouse_code, label: r.warehouse_code, invoices: 0, expected: 0, received: 0, variance: 0 };
    w.expected += r.expected_quantity;
    w.received += r.received_quantity;
    w.variance += r.variance;
    warehouses.set(wKey, w);

    const vKey = r.vendor_name;
    const v = vendors.get(vKey) ?? { key: vKey, label: vKey, invoices: 0, expected: 0, received: 0, variance: 0 };
    v.expected += r.expected_quantity;
    v.received += r.received_quantity;
    v.variance += r.variance;
    vendors.set(vKey, v);

    const inv = invoiceAgg.get(r.invoice_id) ?? {
      invoiceId: r.invoice_id,
      vendorName: r.vendor_name,
      warehouseCode: r.warehouse_code,
      status: r.status,
      expected: 0,
      received: 0,
      variance: 0,
      lineCount: 0,
    };
    inv.expected += r.expected_quantity;
    inv.received += r.received_quantity;
    inv.variance += r.variance;
    inv.lineCount += 1;
    invoiceAgg.set(r.invoice_id, inv);
  }

  // Distinct invoice counts per group.
  const addToSet = (map: Map<string, Set<string>>, key: string, value: string): void => {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(value);
  };
  const whInvoiceSets = new Map<string, Set<string>>();
  const vnInvoiceSets = new Map<string, Set<string>>();
  for (const r of rows) {
    addToSet(whInvoiceSets, String(r.warehouse_id), r.invoice_id);
    addToSet(vnInvoiceSets, r.vendor_name, r.invoice_id);
  }
  for (const [k, g] of warehouses) g.invoices = whInvoiceSets.get(k)?.size ?? 0;
  for (const [k, g] of vendors) g.invoices = vnInvoiceSets.get(k)?.size ?? 0;

  const completedInvoices = [...invoiceComplete.values()].filter(Boolean).length;

  const topVariances = [...rows]
    .filter((r) => r.variance !== 0)
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
    .slice(0, 10)
    .map(rowToDTO);

  const stripCode = (g: GroupAggregate & { code?: string }): GroupAggregate => ({
    key: g.key, label: g.label, invoices: g.invoices, expected: g.expected, received: g.received, variance: g.variance,
  });

  return {
    totals: {
      invoices: invoiceIds.size,
      lines: rows.length,
      expected,
      received,
      variance: expected - received,
      fillRate: expected > 0 ? received / expected : 0,
      completedInvoices,
      linesWithVariance,
    },
    byWarehouse: [...warehouses.values()].map(stripCode).sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)),
    byVendor: [...vendors.values()].sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)),
    byInvoice: [...invoiceAgg.values()].sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)),
    topVariances,
  };
}

// Export column order matches the BRD §3.4 report schema, with two operational
// extras (Status, Delivery_Date) appended.
function toExportRecords(rows: ReconciliationRow[]): Array<Record<string, string | number>> {
  return rows.map((r) => ({
    Invoice_ID: r.invoice_id,
    Vendor_Name: r.vendor_name,
    Warehouse_ID: r.warehouse_code,
    Item_SKU: r.item_sku,
    Item_Name: r.item_name,
    Expected_Quantity: r.expected_quantity,
    Received_Quantity: r.received_quantity,
    Variance: r.variance,
    Status: r.status,
    Delivery_Date: r.created_at.slice(0, 10),
  }));
}

export interface ExportFile {
  buffer: Buffer;
  contentType: string;
  extension: 'csv' | 'xlsx';
}

export function buildExport(rows: ReconciliationRow[], format: 'csv' | 'xlsx'): ExportFile {
  const records = toExportRecords(rows);
  const worksheet = XLSX.utils.json_to_sheet(records, {
    header: ['Invoice_ID', 'Vendor_Name', 'Warehouse_ID', 'Item_SKU', 'Item_Name', 'Expected_Quantity', 'Received_Quantity', 'Variance', 'Status', 'Delivery_Date'],
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Reconciliation');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: format }) as Buffer;
  return {
    buffer,
    contentType:
      format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: format,
  };
}
