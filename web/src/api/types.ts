// Client-side mirror of the FreshTrack API DTOs.

export type Role = 'CENTRAL_ADMIN' | 'HUB_USER';
export type InvoiceStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED';
export type ScanType = 'SCAN' | 'MANUAL_INCREMENT' | 'OVERRIDE';

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  location: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface User {
  id: number;
  email: string;
  username: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  warehouses?: Warehouse[];
}

export interface InvoiceLine {
  id: number;
  itemSku: string;
  itemName: string;
  expectedQuantity: number;
  receivedQuantity: number;
  variance: number;
}

export interface InvoiceSummary {
  id: number;
  invoiceId: string;
  vendorName: string;
  warehouseId: number;
  warehouseCode: string;
  status: InvoiceStatus;
  createdAt: string;
  totalExpected: number;
  totalReceived: number;
  lineCount: number;
}

export interface InvoiceDetail extends InvoiceSummary {
  lines: InvoiceLine[];
}

export interface ScanEvent {
  id: number;
  invoiceLineId: number;
  invoiceBusinessId: string;
  itemSku: string;
  type: ScanType;
  delta: number;
  quantityAfter: number;
  reason: string | null;
  clientEventId: string | null;
  userId: number;
  userName: string | null;
  createdAt: string;
}

export interface ReceivingTotals {
  expected: number;
  received: number;
  lineCount: number;
  completedLines: number;
}

export interface ScanResult {
  clientEventId?: string;
  itemSku: string;
  matched: boolean;
  receivedQuantity?: number;
  expectedQuantity?: number;
  variance?: number;
}

export interface ReceivingUpdate {
  results?: ScanResult[];
  lines: InvoiceLine[];
  totals: ReceivingTotals;
  status: InvoiceStatus;
}

// --- Invoice ingestion (upload/preview) ---
export interface ColumnMapping {
  mapping: Record<string, number>;
  matchedHeaders: Record<string, string | null>;
  unmatched: string[];
  method: 'heuristic' | 'ai-assisted';
  aiUsed: boolean;
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
  errors: Array<{ row: number; message: string }>;
  createdInvoiceIds: number[];
}

// --- Reports ---
export interface ReconciliationRow {
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
export interface GroupAggregate {
  key: string;
  label: string;
  invoices: number;
  expected: number;
  received: number;
  variance: number;
}
export interface ReportSummary {
  totals: {
    invoices: number;
    lines: number;
    expected: number;
    received: number;
    variance: number;
    fillRate: number;
    completedInvoices: number;
    linesWithVariance: number;
  };
  byWarehouse: GroupAggregate[];
  byVendor: GroupAggregate[];
  topVariances: ReconciliationRow[];
}
export interface ReconciliationResponse {
  filter: Record<string, unknown>;
  rows: ReconciliationRow[];
  summary: ReportSummary;
}

export interface ReportFilter {
  dateFrom?: string;
  dateTo?: string;
  warehouseId?: number;
  vendor?: string;
  status?: InvoiceStatus;
}

// --- AI ---
export interface AiStatus {
  enabled: boolean;
  provider: string;
  mappingModel: string;
  assistantModel: string;
}
export interface AssistantAnswer {
  aiEnabled: boolean;
  grounded: boolean;
  answer: string;
  summary: ReportSummary;
}

// --- Audit ---
export interface AuditEntry {
  id: number;
  action: string;
  entity: string | null;
  entityId: string | null;
  actorUserId: number | null;
  actorUsername: string | null;
  actorEmail: string | null;
  metadata: unknown;
  createdAt: string;
}
