import type { DatabaseSync } from 'node:sqlite';

// Idempotent schema creation. Every table/index uses IF NOT EXISTS so this can
// be run on every boot. created_at columns are stored as ISO-8601 UTC strings so
// they sort lexicographically and round-trip cleanly to the client.
const ISO_NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     email         TEXT    NOT NULL UNIQUE,
     username      TEXT    NOT NULL,
     password_hash TEXT    NOT NULL,
     role          TEXT    NOT NULL CHECK (role IN ('CENTRAL_ADMIN','HUB_USER')),
     is_active     INTEGER NOT NULL DEFAULT 1,
     created_at    TEXT    NOT NULL DEFAULT ${ISO_NOW}
   )`,

  `CREATE TABLE IF NOT EXISTS warehouses (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     code       TEXT    NOT NULL UNIQUE,
     name       TEXT    NOT NULL,
     location   TEXT,
     is_active  INTEGER NOT NULL DEFAULT 1,
     created_at TEXT    NOT NULL DEFAULT ${ISO_NOW}
   )`,

  `CREATE TABLE IF NOT EXISTS user_warehouses (
     user_id      INTEGER NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
     warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
     created_at   TEXT    NOT NULL DEFAULT ${ISO_NOW},
     PRIMARY KEY (user_id, warehouse_id)
   )`,

  `CREATE TABLE IF NOT EXISTS invoices (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     invoice_id   TEXT    NOT NULL UNIQUE,
     vendor_name  TEXT    NOT NULL,
     warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
     status       TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED')),
     uploaded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at   TEXT    NOT NULL DEFAULT ${ISO_NOW}
   )`,

  `CREATE TABLE IF NOT EXISTS invoice_lines (
     id                INTEGER PRIMARY KEY AUTOINCREMENT,
     invoice_ref       INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
     item_sku          TEXT    NOT NULL,
     item_name         TEXT    NOT NULL,
     expected_quantity INTEGER NOT NULL CHECK (expected_quantity >= 0),
     received_quantity INTEGER NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
     created_at        TEXT    NOT NULL DEFAULT ${ISO_NOW},
     UNIQUE (invoice_ref, item_sku)
   )`,

  `CREATE TABLE IF NOT EXISTS scan_events (
     id                  INTEGER PRIMARY KEY AUTOINCREMENT,
     invoice_line_id     INTEGER NOT NULL REFERENCES invoice_lines(id) ON DELETE CASCADE,
     invoice_ref         INTEGER NOT NULL REFERENCES invoices(id)      ON DELETE CASCADE,
     invoice_business_id TEXT    NOT NULL,
     item_sku            TEXT    NOT NULL,
     warehouse_id        INTEGER NOT NULL REFERENCES warehouses(id),
     user_id             INTEGER NOT NULL REFERENCES users(id),
     type                TEXT    NOT NULL CHECK (type IN ('SCAN','MANUAL_INCREMENT','OVERRIDE')),
     delta               INTEGER NOT NULL,
     quantity_after      INTEGER NOT NULL,
     reason              TEXT,
     client_event_id     TEXT,
     created_at          TEXT    NOT NULL DEFAULT ${ISO_NOW}
   )`,

  `CREATE TABLE IF NOT EXISTS audit_logs (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     action        TEXT    NOT NULL,
     entity        TEXT,
     entity_id     TEXT,
     metadata      TEXT,
     created_at    TEXT    NOT NULL DEFAULT ${ISO_NOW}
   )`,

  `CREATE INDEX IF NOT EXISTS idx_invoices_warehouse ON invoices(warehouse_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_vendor    ON invoices(vendor_name)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_created   ON invoices(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_lines_invoice      ON invoice_lines(invoice_ref)`,
  `CREATE INDEX IF NOT EXISTS idx_scan_line          ON scan_events(invoice_line_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scan_invoice       ON scan_events(invoice_ref)`,
  `CREATE INDEX IF NOT EXISTS idx_scan_created       ON scan_events(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_scan_user          ON scan_events(user_id)`,
  // Idempotency: a client_event_id is applied at most once (safe scan retries).
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_client_event ON scan_events(client_event_id) WHERE client_event_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_userwh_user        ON user_warehouses(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_userwh_wh          ON user_warehouses(warehouse_id)`,
];

export function runMigrations(db: DatabaseSync): void {
  for (const stmt of STATEMENTS) db.exec(stmt);
}
