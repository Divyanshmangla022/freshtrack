import type {
  CanonicalField,
  InvoiceDetailDTO,
  InvoiceLineDTO,
  InvoiceLineRow,
  InvoiceSummaryDTO,
} from '../../types.ts';
import { resolveColumnMapping } from '../ai/columnMapper.ts';
import type { ColumnMapping } from '../ai/columnMapper.ts';
import { getWarehouseByCode } from '../warehouses/warehouses.repo.ts';
import { parseSpreadsheet } from './invoices.parser.ts';
import {
  createInvoices,
  getInvoiceByBusinessId,
  getInvoiceLines,
  getInvoiceSummary,
} from './invoices.repo.ts';
import type { InvoiceSummaryRow, NewInvoice } from './invoices.repo.ts';

export interface RowError {
  row: number; // 1-based spreadsheet row (header = row 1); 0 for file-level errors
  message: string;
}

export interface IngestInvoicePreview {
  invoiceId: string;
  vendorName: string;
  warehouseCode: string;
  warehouseId: number;
  lineCount: number;
  totalExpected: number;
}

export interface IngestResult {
  committed: boolean;
  fileName: string;
  sheetName: string;
  headers: string[];
  mapping: ColumnMapping;
  totalRows: number;
  validRows: number;
  invoices: IngestInvoicePreview[];
  errors: RowError[];
  createdInvoiceIds: number[];
}

function parseQuantity(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  if (/^\d+$/.test(cleaned)) return Number(cleaned);
  if (/^\d+\.0+$/.test(cleaned)) return parseInt(cleaned, 10); // tolerate "10.0"
  return null;
}

interface StagedLine {
  row: number;
  invoiceId: string;
  vendorName: string;
  warehouseCode: string;
  warehouseId: number;
  itemSku: string;
  itemName: string;
  expectedQuantity: number;
}

export async function ingestInvoiceFile(input: {
  buffer: Buffer;
  fileName: string;
  commit: boolean;
  uploadedBy: number | null;
}): Promise<IngestResult> {
  const parsed = parseSpreadsheet(input.buffer);
  const mapping = await resolveColumnMapping(parsed.headers, parsed.rows.slice(0, 5));

  const result: IngestResult = {
    committed: false,
    fileName: input.fileName,
    sheetName: parsed.sheetName,
    headers: parsed.headers,
    mapping,
    totalRows: parsed.rows.length,
    validRows: 0,
    invoices: [],
    errors: [],
    createdInvoiceIds: [],
  };

  if (parsed.rows.length === 0) {
    result.errors.push({ row: 0, message: 'The file contains no data rows.' });
    return result;
  }

  if (mapping.unmatched.length > 0) {
    result.errors.push({
      row: 0,
      message: `Could not map required column(s): ${mapping.unmatched.join(', ')}. Detected headers: ${parsed.headers.join(', ')}`,
    });
    return result;
  }

  const idx = mapping.mapping;
  const get = (row: string[], field: CanonicalField): string => (row[idx[field]] ?? '').trim();

  // --- Row-level validation ---
  const staged: StagedLine[] = [];
  const warehouseCache = new Map<string, number | null>();

  parsed.rows.forEach((row, i) => {
    const rowNo = i + 2; // +1 for header, +1 for 1-based
    const invoiceId = get(row, 'Invoice_ID');
    const vendorName = get(row, 'Vendor_Name');
    const warehouseCode = get(row, 'Target_Warehouse_ID').toUpperCase();
    const itemSku = get(row, 'Item_SKU');
    const itemName = get(row, 'Item_Name');
    const qtyRaw = get(row, 'Expected_Quantity');

    const missing: string[] = [];
    if (!invoiceId) missing.push('Invoice_ID');
    if (!vendorName) missing.push('Vendor_Name');
    if (!warehouseCode) missing.push('Target_Warehouse_ID');
    if (!itemSku) missing.push('Item_SKU');
    if (!itemName) missing.push('Item_Name');
    if (missing.length > 0) {
      result.errors.push({ row: rowNo, message: `Missing required value(s): ${missing.join(', ')}` });
      return;
    }

    const qty = parseQuantity(qtyRaw);
    if (qty === null || qty < 1) {
      result.errors.push({ row: rowNo, message: `Expected_Quantity "${qtyRaw}" must be a positive integer` });
      return;
    }

    // Target_Warehouse_ID must exist in the system before committing (BRD §3.2).
    let warehouseId = warehouseCache.get(warehouseCode);
    if (warehouseId === undefined) {
      const wh = getWarehouseByCode(warehouseCode);
      warehouseId = wh && wh.is_active === 1 ? wh.id : null;
      warehouseCache.set(warehouseCode, warehouseId);
    }
    if (warehouseId === null) {
      result.errors.push({ row: rowNo, message: `Target_Warehouse_ID "${warehouseCode}" does not exist or is inactive` });
      return;
    }

    staged.push({ row: rowNo, invoiceId, vendorName, warehouseCode, warehouseId, itemSku, itemName, expectedQuantity: qty });
  });

  result.validRows = staged.length;

  // --- Group into invoices; enforce per-invoice consistency; merge duplicate SKUs ---
  interface Group {
    invoiceId: string;
    vendorName: string;
    warehouseCode: string;
    warehouseId: number;
    firstRow: number;
    lines: Map<string, { itemName: string; expectedQuantity: number }>;
  }
  const groups = new Map<string, Group>();

  for (const line of staged) {
    let g = groups.get(line.invoiceId);
    if (!g) {
      g = {
        invoiceId: line.invoiceId,
        vendorName: line.vendorName,
        warehouseCode: line.warehouseCode,
        warehouseId: line.warehouseId,
        firstRow: line.row,
        lines: new Map(),
      };
      groups.set(line.invoiceId, g);
    } else if (g.warehouseId !== line.warehouseId || g.vendorName !== line.vendorName) {
      result.errors.push({
        row: line.row,
        message: `Invoice "${line.invoiceId}" has inconsistent vendor/warehouse across rows (first seen on row ${g.firstRow})`,
      });
      continue;
    }
    const existing = g.lines.get(line.itemSku);
    if (existing) existing.expectedQuantity += line.expectedQuantity; // merge duplicate SKU lines
    else g.lines.set(line.itemSku, { itemName: line.itemName, expectedQuantity: line.expectedQuantity });
  }

  // Reject invoice IDs that already exist (Invoice_ID is unique - BRD §3.2).
  for (const g of groups.values()) {
    if (getInvoiceByBusinessId(g.invoiceId)) {
      result.errors.push({ row: g.firstRow, message: `Invoice_ID "${g.invoiceId}" already exists` });
    }
  }

  // Build preview + persistable payload.
  const toCreate: NewInvoice[] = [];
  for (const g of groups.values()) {
    const lines = [...g.lines.entries()].map(([itemSku, v]) => ({
      itemSku,
      itemName: v.itemName,
      expectedQuantity: v.expectedQuantity,
    }));
    const totalExpected = lines.reduce((s, l) => s + l.expectedQuantity, 0);
    result.invoices.push({
      invoiceId: g.invoiceId,
      vendorName: g.vendorName,
      warehouseCode: g.warehouseCode,
      warehouseId: g.warehouseId,
      lineCount: lines.length,
      totalExpected,
    });
    toCreate.push({ invoiceId: g.invoiceId, vendorName: g.vendorName, warehouseId: g.warehouseId, uploadedBy: input.uploadedBy, lines });
  }
  result.invoices.sort((a, b) => a.invoiceId.localeCompare(b.invoiceId));

  // Commit only when explicitly requested AND the file is fully valid.
  if (input.commit && result.errors.length === 0 && toCreate.length > 0) {
    result.createdInvoiceIds = createInvoices(toCreate);
    result.committed = true;
  }

  return result;
}

// --- DTO mappers ---

export function summaryRowToDTO(r: InvoiceSummaryRow): InvoiceSummaryDTO {
  return {
    id: r.id,
    invoiceId: r.invoice_id,
    vendorName: r.vendor_name,
    warehouseId: r.warehouse_id,
    warehouseCode: r.warehouse_code,
    status: r.status,
    createdAt: r.created_at,
    totalExpected: r.total_expected,
    totalReceived: r.total_received,
    lineCount: r.line_count,
  };
}

export function lineRowToDTO(l: InvoiceLineRow): InvoiceLineDTO {
  return {
    id: l.id,
    itemSku: l.item_sku,
    itemName: l.item_name,
    expectedQuantity: l.expected_quantity,
    receivedQuantity: l.received_quantity,
    variance: l.expected_quantity - l.received_quantity,
  };
}

export function buildInvoiceDetail(invoiceRef: number): InvoiceDetailDTO | undefined {
  const summary = getInvoiceSummary(invoiceRef);
  if (!summary) return undefined;
  const lines = getInvoiceLines(invoiceRef).map(lineRowToDTO);
  return { ...summaryRowToDTO(summary), lines };
}
