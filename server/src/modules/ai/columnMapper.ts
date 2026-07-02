import { config } from '../../config.ts';
import { CANONICAL_FIELDS } from '../../types.ts';
import type { CanonicalField } from '../../types.ts';
import { aiEnabled, completeJSON } from './ai.client.ts';

// ---------------------------------------------------------------------------
// Maps arbitrary vendor spreadsheet headers to the canonical invoice schema.
// Deterministic heuristic runs first (works fully offline). If required columns
// remain unmatched and an API key is configured, the model fills the gaps. The
// heuristic result is authoritative for columns it already matched.
// ---------------------------------------------------------------------------

export interface ColumnMapping {
  /** canonical field -> header index (or -1 when unmatched) */
  mapping: Record<CanonicalField, number>;
  matchedHeaders: Record<CanonicalField, string | null>;
  unmatched: CanonicalField[];
  method: 'heuristic' | 'ai-assisted';
  aiUsed: boolean;
}

const SYNONYMS: Record<CanonicalField, string[]> = {
  Invoice_ID: ['invoiceid', 'invoice', 'invoiceno', 'invoicenumber', 'invno', 'invoicecode', 'inv', 'billno', 'billnumber', 'ponumber', 'po', 'ordernumber', 'orderid'],
  Vendor_Name: ['vendorname', 'vendor', 'supplier', 'suppliername', 'seller', 'manufacturer', 'brand', 'company', 'vendorcompany', 'source'],
  Target_Warehouse_ID: ['targetwarehouseid', 'warehouseid', 'warehouse', 'warehousecode', 'whid', 'wh', 'destination', 'destinationwarehouse', 'facility', 'hub', 'site', 'warehousename', 'dc', 'fulfillmentcenter'],
  Item_SKU: ['itemsku', 'sku', 'skucode', 'productcode', 'productid', 'itemcode', 'barcode', 'upc', 'ean', 'gtin', 'articlecode', 'partnumber', 'partno'],
  Item_Name: ['itemname', 'productname', 'description', 'itemdescription', 'product', 'producttitle', 'goods', 'commodity', 'itemdesc', 'productdesc', 'title'],
  Expected_Quantity: ['expectedquantity', 'quantity', 'qty', 'expectedqty', 'units', 'unitcount', 'count', 'expected', 'orderedqty', 'orderedquantity', 'eaches', 'expectedunits'],
};

function normalize(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Score a (field, header) pair: 3 = exact synonym, 1 = partial substring, 0 = none. */
function scorePair(field: CanonicalField, normHeader: string): number {
  if (normHeader.length === 0) return 0;
  const candidates = new Set<string>([normalize(field), ...SYNONYMS[field]]);
  if (candidates.has(normHeader)) return 3;
  for (const c of candidates) {
    if (c.length >= 3 && (normHeader.includes(c) || c.includes(normHeader))) return 1;
  }
  return 0;
}

function heuristicMap(headers: string[]): Record<CanonicalField, number> {
  const normHeaders = headers.map(normalize);
  const mapping: Record<CanonicalField, number> = {
    Invoice_ID: -1, Vendor_Name: -1, Target_Warehouse_ID: -1, Item_SKU: -1, Item_Name: -1, Expected_Quantity: -1,
  };

  type Cand = { field: CanonicalField; header: number; score: number; fieldPriority: number };
  const candidates: Cand[] = [];
  CANONICAL_FIELDS.forEach((field, fieldPriority) => {
    normHeaders.forEach((nh, header) => {
      const score = scorePair(field, nh);
      if (score > 0) candidates.push({ field, header, score, fieldPriority });
    });
  });

  // Greedy one-to-one assignment: highest score first, ties broken by field order.
  candidates.sort((a, b) => b.score - a.score || a.fieldPriority - b.fieldPriority || a.header - b.header);
  const usedHeaders = new Set<number>();
  for (const c of candidates) {
    if (mapping[c.field] !== -1) continue;
    if (usedHeaders.has(c.header)) continue;
    mapping[c.field] = c.header;
    usedHeaders.add(c.header);
  }
  return mapping;
}

function buildResult(
  headers: string[],
  mapping: Record<CanonicalField, number>,
  aiUsed: boolean,
): ColumnMapping {
  const matchedHeaders = {} as Record<CanonicalField, string | null>;
  const unmatched: CanonicalField[] = [];
  for (const field of CANONICAL_FIELDS) {
    const idx = mapping[field];
    if (idx >= 0 && idx < headers.length) matchedHeaders[field] = headers[idx] ?? null;
    else {
      matchedHeaders[field] = null;
      unmatched.push(field);
    }
  }
  return { mapping, matchedHeaders, unmatched, method: aiUsed ? 'ai-assisted' : 'heuristic', aiUsed };
}

const AI_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(CANONICAL_FIELDS.map((f) => [f, { type: 'string' }])),
  required: [...CANONICAL_FIELDS],
};

async function aiFillGaps(
  headers: string[],
  sampleRows: string[][],
  base: Record<CanonicalField, number>,
): Promise<Record<CanonicalField, number> | null> {
  const system =
    'You map arbitrary spreadsheet column headers to a fixed canonical inventory-invoice schema. ' +
    'For each canonical field, return the EXACT header string that best matches, or an empty string if no column fits. ' +
    'Never invent headers; only choose from the provided list.';
  const user = JSON.stringify({
    canonical_fields: {
      Invoice_ID: 'Unique invoice identifier',
      Vendor_Name: 'Supplier / vendor name',
      Target_Warehouse_ID: 'Destination warehouse code or name',
      Item_SKU: 'Stock keeping unit / product/barcode code',
      Item_Name: 'Human-readable product name/description',
      Expected_Quantity: 'Expected count of units (eaches)',
    },
    headers,
    sample_rows: sampleRows.slice(0, 5),
  });

  const result = await completeJSON<Record<CanonicalField, string>>({
    model: config.ai.mappingModel,
    system,
    user,
    schema: AI_SCHEMA,
    maxTokens: 512,
  });
  if (!result) return null;

  const normHeaders = headers.map(normalize);
  const merged = { ...base };
  for (const field of CANONICAL_FIELDS) {
    if (merged[field] !== -1) continue; // keep confident heuristic matches
    const suggested = result[field];
    if (!suggested) continue;
    let idx = headers.indexOf(suggested);
    if (idx === -1) idx = normHeaders.indexOf(normalize(suggested));
    if (idx !== -1) merged[field] = idx;
  }
  return merged;
}

/**
 * Resolve the header->canonical mapping. Heuristic first; AI only to fill
 * required gaps when a key is configured. Always returns a result (never throws).
 */
export async function resolveColumnMapping(
  headers: string[],
  sampleRows: string[][],
): Promise<ColumnMapping> {
  const heuristic = heuristicMap(headers);
  const hasGaps = CANONICAL_FIELDS.some((f) => heuristic[f] === -1);

  if (hasGaps && aiEnabled()) {
    const merged = await aiFillGaps(headers, sampleRows, heuristic);
    if (merged) {
      const changed = CANONICAL_FIELDS.some((f) => merged[f] !== heuristic[f]);
      return buildResult(headers, merged, changed);
    }
  }
  return buildResult(headers, heuristic, false);
}
