// ---------------------------------------------------------------------------
// Shared domain constants + row/DTO types. Kept dependency-free so both the API
// layer and the data layer can import it without cycles.
// ---------------------------------------------------------------------------

export const ROLES = {
  ADMIN: 'CENTRAL_ADMIN',
  HUB: 'HUB_USER',
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

export const SCAN_TYPES = {
  SCAN: 'SCAN',
  MANUAL: 'MANUAL_INCREMENT',
  OVERRIDE: 'OVERRIDE',
} as const;
export type ScanType = (typeof SCAN_TYPES)[keyof typeof SCAN_TYPES];

export const INVOICE_STATUS = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
} as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

// The canonical invoice-line schema from the BRD (§3.2).
export const CANONICAL_FIELDS = [
  'Invoice_ID',
  'Vendor_Name',
  'Target_Warehouse_ID',
  'Item_SKU',
  'Item_Name',
  'Expected_Quantity',
] as const;
export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

// --- Raw DB rows (snake_case, as returned by node:sqlite) ---

export interface UserRow {
  id: number;
  email: string;
  username: string;
  password_hash: string;
  role: Role;
  is_active: number;
  created_at: string;
}

export interface WarehouseRow {
  id: number;
  code: string;
  name: string;
  location: string | null;
  is_active: number;
  created_at: string;
}

export interface InvoiceRow {
  id: number;
  invoice_id: string;
  vendor_name: string;
  warehouse_id: number;
  status: InvoiceStatus;
  uploaded_by: number | null;
  created_at: string;
}

export interface InvoiceLineRow {
  id: number;
  invoice_ref: number;
  item_sku: string;
  item_name: string;
  expected_quantity: number;
  received_quantity: number;
  created_at: string;
}

export interface ScanEventRow {
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
}

// --- Auth context attached to a request after authentication ---

export interface AuthContext {
  userId: number;
  role: Role;
  email: string;
  username: string;
  /** Present only for hub users who have selected an active warehouse. */
  activeWarehouseId?: number;
}

// --- Client-facing DTOs (camelCase) ---

export interface WarehouseDTO {
  id: number;
  code: string;
  name: string;
  location: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface UserDTO {
  id: number;
  email: string;
  username: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  warehouses?: WarehouseDTO[];
}

export interface InvoiceLineDTO {
  id: number;
  itemSku: string;
  itemName: string;
  expectedQuantity: number;
  receivedQuantity: number;
  variance: number;
}

export interface InvoiceSummaryDTO {
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

export interface InvoiceDetailDTO extends InvoiceSummaryDTO {
  lines: InvoiceLineDTO[];
}

export function toWarehouseDTO(w: WarehouseRow): WarehouseDTO {
  return {
    id: w.id,
    code: w.code,
    name: w.name,
    location: w.location,
    isActive: w.is_active === 1,
    createdAt: w.created_at,
  };
}

export function toUserDTO(u: UserRow, warehouses?: WarehouseRow[]): UserDTO {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    role: u.role,
    isActive: u.is_active === 1,
    createdAt: u.created_at,
    ...(warehouses ? { warehouses: warehouses.map(toWarehouseDTO) } : {}),
  };
}
