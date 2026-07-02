# FreshTrack — Technical Proposal & Architecture

This document is the "technical proposal that balances architectural scale with deployment speed" requested by the BRD. It explains the current implementation, the trade‑offs behind it, and a concrete path to production scale.

## 1. Guiding principles

1. **Deployment speed first, without painting into a corner.** The system runs with `npm install && npm run seed && npm run dev` — no database server, no native compilation, no build step for the API. Every choice that favors speed is isolated behind a seam so it can be upgraded for scale (e.g. the SQL repository layer, the SSE hub).
2. **Correctness of the count is sacred.** Receiving is the money path — a lost or double‑counted scan is financial leakage. The scan pipeline is designed so counts cannot be lost or raced.
3. **Data isolation is enforced server‑side, in depth.** The client is never trusted to scope data.
4. **Everything is data‑driven.** No hardcoded warehouse lists, column maps, or variance logic.

## 2. System overview

- **API** — Node 26 + Express, TypeScript executed natively (type‑stripping). Modular by domain: `modules/<domain>/{repo,service,routes}.ts`.
  - `repo` — SQL over the built‑in `node:sqlite` driver (prepared statements).
  - `service` — business logic (ingestion, scan application, reconciliation, AI).
  - `routes` — thin Express handlers with Zod validation.
- **Persistence** — a single SQLite file in WAL mode, foreign keys enforced.
- **Real‑time** — Server‑Sent Events; the receiving service publishes authoritative progress to an in‑process topic hub.
- **Web** — React + Vite + TypeScript SPA with a typed fetch client, a JWT auth context, and a dark, high‑contrast design system tuned for a low‑light dock.

## 3. Data model

```
users(id, email⋆, username, password_hash, role, is_active, created_at)
warehouses(id, code⋆, name, location, is_active, created_at)
user_warehouses(user_id→users, warehouse_id→warehouses)                 -- N:N mapping
invoices(id, invoice_id⋆, vendor_name, warehouse_id→warehouses, status, uploaded_by→users, created_at)
invoice_lines(id, invoice_ref→invoices, item_sku, item_name,
              expected_quantity, received_quantity, UNIQUE(invoice_ref,item_sku))
scan_events(id, invoice_line_id→invoice_lines, invoice_ref→invoices, invoice_business_id,
            item_sku, warehouse_id, user_id, type, delta, quantity_after, reason,
            client_event_id, created_at)                                 -- immutable audit trail
audit_logs(id, actor_user_id, action, entity, entity_id, metadata, created_at)
```

`received_quantity` is a **materialized counter** on `invoice_lines` for O(1) progress reads, kept consistent with the append‑only `scan_events` ledger inside the same transaction. The ledger is the source of truth and the audit record (timestamp + Invoice_ID + Item_SKU + User_ID + type + delta, per BRD §4).

## 4. RBAC & data isolation

- **Roles:** `CENTRAL_ADMIN` (global) and `HUB_USER` (assigned warehouses only).
- **Session:** JWT (bcrypt‑hashed passwords). `requireAuth` re‑loads the user from the DB on every request, so role changes and de‑activations take effect immediately — the token is not the source of truth.
- **Active warehouse:** a hub user selects a warehouse (`POST /auth/select-warehouse`); the server verifies the mapping and mints a token carrying `activeWarehouseId`.
- **Every warehouse‑scoped operation** (invoice list/detail, scan, override, stream, events) re‑checks `user_warehouses` in the DB and that the resource's warehouse equals the active warehouse. Revoking a mapping revokes access instantly, even for a live token.

## 5. The scan pipeline (deep dive)

The BRD demands "rapid‑fire barcode scan inputs without lagging, skipping counts, or causing UI freeze." How each property is guaranteed:

| Property | Mechanism |
|---|---|
| **No UI freeze / instant feedback** | Every scan updates an optimistic local counter synchronously (a `Map` ref) and renders immediately; the network call is off the input path. |
| **No lag** | Scans are buffered and flushed in batches (~180 ms or 20 events) as a single request, collapsing N round‑trips into one. |
| **No skipped counts** | The client queue is never cleared until the server acknowledges; a failed batch is re‑queued (front) and retried. |
| **No races / no lost updates server‑side** | A batch is applied in one synchronous `BEGIN IMMEDIATE` transaction. Node's single thread + `node:sqlite`'s synchronous API mean there are no interleaving `await` points inside the transaction, so concurrent requests are serialized and increments cannot interleave. |
| **Multi‑device consistency** | After applying, authoritative counts are broadcast over SSE to every device on that invoice; clients reconcile to server truth (optimistic values are corrected, never doubled — the server returns absolute quantities). |
| **Audit** | Each event appends an immutable `scan_events` row; overrides and manual increments are typed and carry a reason. |

Manual increment and audited override reuse the same transactional path. Verified empirically: 200 back‑to‑back scans produce exactly 200 received units with zero skips.

## 6. Invoice ingestion

`parse (SheetJS) → map columns (dynamic) → validate per row → group → commit (all‑or‑nothing)`:

- **Dynamic column mapping** (`columnMapper.ts`): headers are normalized and scored against a synonym dictionary; a greedy one‑to‑one assignment resolves the six canonical fields. If a required column is unmatched **and** Gemini is configured, the model fills the gap; otherwise the heuristic stands alone. No vendor‑specific formats are hardcoded.
- **Validation:** required values present; `Expected_Quantity` a positive integer; **`Target_Warehouse_ID` must already exist** (BRD §3.2); duplicate `Invoice_ID`s (in‑file or in‑DB) rejected; duplicate SKUs within an invoice merged.
- **Preview vs commit:** `POST /invoices/preview` is a full dry run (mapping + validation, nothing written); `POST /invoices/upload` commits only when the file is fully valid — otherwise it returns the complete error report with HTTP 422 and writes nothing (transactional).

## 7. Reporting

`GET /reports/reconciliation` returns one row per invoice line at the BRD grain (Invoice_ID, Vendor, Warehouse_ID, SKU, Item, Expected, Received, **Variance = Expected − Received**) plus a computed summary (fill rate, variance by warehouse/vendor, largest variances). Filters: date range, warehouse, vendor, status. Export to CSV/XLSX (SheetJS) preserves the BRD column order and appends operational extras (Status, Delivery_Date).

## 8. AI layer (optional, Gemini)

A thin, lazily‑imported wrapper (`ai.client.ts`) over `@google/genai`, declared as an **optional dependency**. With no `GEMINI_API_KEY`, the app is fully functional (heuristic mapping; assistant returns the deterministic summary). With a key:
- **Column mapping** gap‑fill.
- **Reconciliation assistant** — retrieval‑augmented: the summary + relevant rows are pulled from SQLite and passed as grounding; the model answers strictly from them.
- **Insights** — a short performance narrative.

This keeps the AI a value‑add, never a dependency for core operations.

## 9. Scaling path (architectural scale)

The current stack comfortably serves a single hub cluster. To scale out:

| Concern | Today (speed) | At scale |
|---|---|---|
| Database | SQLite (WAL), single file | Swap the repository layer to **PostgreSQL** (same SQL shape; keep atomic increments as `UPDATE … SET received = received + ?`). Repos are the only files that change. |
| API instances | Single process | Stateless JWT auth → run N instances behind a load balancer. |
| Real‑time fan‑out | In‑process SSE hub | Back the hub with **Redis pub/sub** (or a message broker) so SSE works across instances; the `hub.ts` interface stays the same. |
| Ingestion of huge files | Synchronous request | Move parse/validate to a background job + progress channel. |
| Hot invoice contention | One writer, serialized | Per‑line atomic increments already avoid row‑level lost updates; Postgres row locks extend this across instances. |
| Bundle size | Single JS chunk (~ZXing) | Code‑split the camera scanner behind a dynamic import. |

## 10. Deployment (deployment speed)

- **Dev:** `npm run dev` (API + Vite with `/api` proxy).
- **Single‑process prod:** `npm run build` then `npm start` — the API serves `web/dist` with SPA fallback, so the whole app is one Node process and one SQLite file. Ideal for a hub appliance or a single container.
- **Containerization:** a minimal Node image, copy the repo, `npm ci`, `npm run build`, `CMD node server/src/index.ts`. The SQLite file lives on a mounted volume.

## 11. Security & hardening checklist

Implemented: bcrypt password hashing; JWT with expiry; server‑side RBAC + warehouse isolation re‑checked per request; Zod input validation; parameterized SQL (no string interpolation of user values); uniform login failures; audit logging; upload size limits and type checks; SQLite constraints (unique, FK, check) mapped to clean HTTP errors.

Before production: set a strong `JWT_SECRET`; serve over HTTPS; add rate limiting on `/auth/login`; consider refresh tokens / token revocation lists; restrict `CORS_ORIGIN`; add security headers (helmet); back up the SQLite file (or migrate to managed Postgres); scope Gemini key via a secrets manager.

## 12. Testing

- **Type safety:** strict TypeScript across server and web (`npm run typecheck`).
- **API E2E smoke:** auth, RBAC, data isolation (cross‑warehouse blocked), dynamic CSV upload + column mapping, 200‑scan rapid‑fire (exact‑count), audited override, reconciliation variance, CSV/XLSX export, and graceful AI degradation — all verified.
- **Adversarial code review:** a multi‑agent review pass over correctness, security/isolation, the scan concurrency model, and the SQL/data layer, with each finding independently verified before it is accepted.
