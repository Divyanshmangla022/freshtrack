# FreshTrack — Inbound Fruit & Vegetable Receiving System

FreshTrack digitizes the receiving of fresh produce at regional fulfillment hubs. Central Operations upload expected inventory via master invoices; Hub Users physically **scan-to-receive** items on the dock, with live progress and a full audit trail; Central Admins reconcile expected vs. received across every warehouse and export the results.

This is a complete, runnable full‑stack implementation of the PS2 BRD — auth & RBAC, warehouse‑scoped data isolation, CSV/Excel invoice ingestion with dynamic column mapping, a rapid‑fire scan pipeline, reconciliation reporting with CSV/Excel export, and an optional AI layer (Google Gemini) that degrades gracefully when no key is configured.

---

## Table of contents
- [Quick start](#quick-start)
- [Demo accounts](#demo-accounts)
- [How it maps to the BRD](#how-it-maps-to-the-brd)
- [Architecture](#architecture)
- [Tech stack & why](#tech-stack--why)
- [Project structure](#project-structure)
- [Key design decisions](#key-design-decisions)
- [AI enhancements (Gemini)](#ai-enhancements-gemini)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [Testing](#testing)
- [Proactive improvements](#proactive-improvements-beyond-the-brd)

---

## Quick start

**Prerequisites:** Node.js **22+** (Node **26** recommended — the backend runs TypeScript natively with no build step). No database server, no native compilation.

```bash
cd freshtrack
npm install          # installs server + web workspaces
npm run seed         # creates the SQLite DB, an admin, warehouses, hub users, sample invoices
npm run dev          # starts API (http://localhost:4000, hot-reload via nodemon) + web (http://localhost:5173, Vite HMR)
```

Open **http://localhost:5173** and sign in with a demo account below.

**Production‑style single process** (API serves the built SPA):

```bash
npm run build        # builds the web client into web/dist
npm start            # API on :4000 also serves web/dist (open http://localhost:4000)
```

For Docker, managed hosts (Render/Railway/Fly), GitHub publishing, and env-var details, see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Demo accounts

Seeded by `npm run seed` (credentials are configurable via env — see [Configuration](#configuration)):

| Role | Email | Password | Scope |
|---|---|---|---|
| Central Admin | `admin@freshtrack.io` | `Admin@12345` | Global / cross‑warehouse |
| Hub User | `nyc.hub@freshtrack.io` | `Hub@12345` | WH‑NYC‑01 |
| Hub User | `chi.hub@freshtrack.io` | `Hub@12345` | WH‑CHI‑01 |
| Hub User (multi) | `regional.hub@freshtrack.io` | `Hub@12345` | WH‑NYC‑01 + WH‑CHI‑01 |

Sample vendor files for testing invoice upload live in [`sample-data/`](sample-data) — `clean_invoice.csv` (canonical headers) and `messy_invoice.csv` (non‑canonical headers, to exercise the dynamic column mapper).

---

## How it maps to the BRD

| BRD requirement | Where it lives |
|---|---|
| **RBAC** — Central Admin vs Hub User | `server/src/modules/auth/auth.middleware.ts` (`requireRole`, `requireActiveWarehouse`) |
| **Secure login + session mgmt** | JWT (bcrypt hashing), `auth.service.ts` / `auth.routes.ts` |
| **User→warehouse mapping** | `PUT /api/users/:id/warehouses`, `users.repo.ts` (`user_warehouses`) |
| **Data isolation** | Hub token carries an active warehouse; every hub read/scan re‑checks the mapping in the DB |
| **Invoice ingestion (CSV/Excel)** | `invoices.parser.ts` (SheetJS) + `invoices.service.ts` |
| **Required fields + validation** | `invoices.service.ts` — per‑row validation, positive‑integer quantities |
| **Target_Warehouse_ID must exist** | Validated per row against `warehouses` before commit |
| **Warehouse entry / invoice selection** | Hub UI: `WarehouseSelectPage` → `HubInvoicesPage` → `ScanPage` |
| **Scan‑to‑Receive (+1 per scan)** | `receiving.service.ts` (`applyScanBatch`) + `ScanPage.tsx` |
| **Barcode scanner / camera** | `ScannerInput.tsx` (keyboard‑wedge + manual) & `CameraScanner.tsx` (ZXing) |
| **Real‑time progress** | SSE hub (`realtime/hub.ts`) → `GET /api/receiving/invoices/:id/stream` |
| **No lag / no skipped counts** | Optimistic UI + client batching + atomic synchronous DB transactions |
| **Reconciliation report + filters** | `reports.repo.ts` / `reports.routes.ts` (date range, warehouse, vendor, status) |
| **Report schema + Variance = Expected − Received** | `reports.service.ts` (variance computed dynamically) |
| **CSV/Excel export** | `GET /api/reports/reconciliation/export?format=csv|xlsx` |
| **Audit trail** (timestamp, Invoice_ID, Item_SKU, User_ID) | `scan_events` table; every scan/manual/override logs a row |
| **Low‑light, fast UI** | Dark, high‑contrast design system (`web/src/index.css`), large touch targets |

---

## Architecture

```
┌───────────────────────────┐         ┌──────────────────────────────────────┐
│  Web client (React/Vite)  │  HTTPS  │  API (Node 26 + Express, native TS)    │
│  • Admin console          │◀──────▶ │  /api/auth  /users  /warehouses         │
│  • Hub scan UX            │  + SSE  │  /invoices  /receiving  /reports  /ai   │
│  • Optimistic scan queue  │         │  RBAC + warehouse-scoped guards         │
└───────────────────────────┘         │  ┌──────────────┐   ┌───────────────┐  │
                                       │  │ node:sqlite  │   │ Gemini (opt.) │  │
                                       │  │ (WAL, FK on) │   │ graceful      │  │
                                       │  └──────────────┘   └───────────────┘  │
                                       └──────────────────────────────────────┘
```

- **Server** — modular Express app (`modules/<domain>/{repo,service,routes}.ts`). Data access is a thin repository layer over the built‑in `node:sqlite` driver; business logic lives in services; routes are thin and validated with Zod.
- **Real‑time** — Server‑Sent Events broadcast authoritative scan progress to every device viewing an invoice.
- **Client** — React + React Router, a typed `fetch` client, an auth context (JWT in `localStorage`), and a hand‑built dark design system tuned for the dock.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the deeper technical proposal (scale, trade‑offs, and a production hardening path).

## Tech stack & why

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | **Node 26**, TypeScript run **natively** (type‑stripping) | Zero build step for the API; fewer moving parts; fast iteration |
| Web framework | **Express** | Ubiquitous, minimal, easy to reason about |
| Database | **`node:sqlite`** (built into Node) | No server, no ORM engine download, no native compile → trivially portable & deployable. WAL + synchronous API is ideal for atomic, low‑latency scan increments. The repository layer isolates SQL so a swap to Postgres is localized. |
| Validation | **Zod** | Runtime‑safe request validation with clean error mapping |
| Auth | **JWT + bcryptjs** | Stateless sessions; pure‑JS hashing (no native build) |
| Spreadsheets | **SheetJS (`xlsx`)** | One library parses **and** writes both CSV and Excel |
| Real‑time | **SSE** | One‑directional, auto‑reconnecting, dependency‑free |
| Web | **React + Vite + TypeScript** | Fast dev server, first‑class TS, small runtime |
| Barcode (camera) | **@zxing** | Decodes common 1‑D product barcodes (EAN/UPC/Code128) + QR |
| AI (optional) | **Google Gemini (`@google/genai`)** | Smart column mapping + grounded ops assistant; **optional dependency** so install never fails and the app runs fully offline |

## Project structure

```
freshtrack/
├─ package.json               # npm workspaces + dev runner
├─ scripts/dev.mjs            # runs API + web together (no extra deps)
├─ sample-data/               # sample vendor CSVs for upload testing
├─ docs/ARCHITECTURE.md       # technical proposal / deep dive
├─ server/
│  ├─ src/
│  │  ├─ index.ts app.ts config.ts
│  │  ├─ db/ (database.ts, migrate.ts, seed.ts)
│  │  ├─ http/ (errors.ts, validate.ts)
│  │  ├─ realtime/hub.ts
│  │  └─ modules/{auth,users,warehouses,invoices,receiving,reports,ai,audit}/
│  └─ package.json
└─ web/
   ├─ src/
   │  ├─ main.tsx App.tsx index.css
   │  ├─ api/ (client.ts, types.ts)
   │  ├─ auth/AuthContext.tsx
   │  ├─ components/ (Layout, ProtectedRoute, Toast, ScannerInput, CameraScanner, ProgressBar, StatusBadge)
   │  └─ pages/ (LoginPage, hub/*, admin/*)
   └─ package.json
```

## Key design decisions

### Data isolation (defense in depth)
A Hub User authenticates, then **selects an active warehouse** — the server verifies the mapping and issues a token carrying that warehouse. Every warehouse‑scoped request (invoice list/detail, scan, override, stream) **re‑checks the mapping in the database**, so revoking a mapping instantly revokes access even for an already‑issued token. The token is never trusted as the source of truth for role or active status — the DB is.

### Rapid‑fire scanning without lag or skips
- **Client:** each scan increments an optimistic local count immediately (instant feedback) and pushes an event onto a queue. A flusher batches events (every ~180 ms, or when 20 accumulate) into a single request; failed batches are re‑queued for retry, so counts are never lost.
- **Server:** a batch is applied inside **one synchronous `IMMEDIATE` transaction**. Because Node is single‑threaded and `node:sqlite` is synchronous, there are no interleaving `await` points mid‑transaction — increments cannot race or be lost. Each event appends an immutable `scan_events` row (the audit trail) and the invoice status is recomputed.
- **Everyone stays in sync:** the authoritative counts are broadcast over SSE to all devices on that invoice, and each client reconciles to server truth.

Verified: **200 rapid scans → exactly 200 counted, zero skips** (see [Testing](#testing)).

### Dynamic column mapping (no hardcoding)
Vendor spreadsheets rarely use the canonical headers. `columnMapper.ts` scores every header against a synonym dictionary and greedily assigns a one‑to‑one mapping. If a required column is still unmatched **and** a Gemini key is configured, the AI fills the gap; otherwise the deterministic heuristic stands alone. Uploads are validated (dry‑run **preview** available) and committed **all‑or‑nothing** — including the mandatory check that every `Target_Warehouse_ID` already exists.

## AI enhancements (Gemini)

The AI layer is **optional and gracefully degrading**. With no `GEMINI_API_KEY`, the app is fully functional: column mapping uses the heuristic, and the assistant returns the deterministic reconciliation summary with a note.

Set a key to enable:
1. **Smart column mapping** — maps messy vendor headers to the canonical schema when the heuristic can't.
2. **Reconciliation assistant** — grounded natural‑language Q&A over the current reconciliation data (retrieves the summary + rows from SQLite and answers strictly from them).
3. **AI insights** — a short narrative of receiving performance on the dashboard.

```bash
# server/.env
GEMINI_API_KEY=...              # https://aistudio.google.com/apikey
AI_MAPPING_MODEL=gemini-2.5-flash
AI_ASSISTANT_MODEL=gemini-2.5-pro
```

## Configuration

Copy `.env.example` values into `server/.env` (created for you by the quick start with a random JWT secret). All variables have safe defaults.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | API port |
| `JWT_SECRET` | dev default (warns) | **Set a strong secret in production** |
| `TOKEN_TTL` | `12h` | Session lifetime |
| `DATABASE_FILE` | `./data/freshtrack.db` | SQLite file (dir auto‑created) |
| `CORS_ORIGIN` | `*` | Allowed origin(s) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | see table | Seed admin |
| `SEED_HUB_PASSWORD` | `Hub@12345` | Seed hub users |
| `GEMINI_API_KEY` | _unset_ | Enables AI features |
| `AI_MAPPING_MODEL` / `AI_ASSISTANT_MODEL` | Gemini 2.5 flash/pro | Model selection |

## API reference

All routes are under `/api`. Auth is `Authorization: Bearer <token>` (SSE/downloads accept `?token=`).

**Auth** — `POST /auth/login`, `GET /auth/me`, `POST /auth/select-warehouse`, `POST /auth/logout`
**Users (admin)** — `GET /users`, `GET /users/:id`, `POST /users`, `PATCH /users/:id`, `PUT /users/:id/warehouses`
**Warehouses** — `GET /warehouses` (scoped), `POST /warehouses` (admin), `PATCH /warehouses/:id` (admin)
**Invoices** — `POST /invoices/preview` (admin, dry‑run), `POST /invoices/upload` (admin), `GET /invoices` (scoped), `GET /invoices/:id` (scoped)
**Receiving (hub)** — `POST /receiving/invoices/:id/scan-batch`, `POST /receiving/invoices/:id/lines/:lineId/override`, `GET /receiving/invoices/:id/events`, `GET /receiving/invoices/:id/stream` (SSE)
**Reports (admin)** — `GET /reports/reconciliation`, `GET /reports/summary`, `GET /reports/reconciliation/export?format=csv|xlsx`
**AI** — `GET /ai/status`, `POST /ai/assistant` (admin), `POST /ai/insights` (admin)
**Audit (admin)** — `GET /audit`
**Health** — `GET /api/health`

## Testing

```bash
npm run typecheck                 # strict TypeScript check (server + web)
```

An end‑to‑end API smoke test (auth, RBAC, data isolation, dynamic upload/mapping, 200‑scan rapid‑fire, override, reconciliation, CSV/XLSX export, graceful AI) is included and was run during development — **all core flows pass**, including exact‑count verification of the rapid‑fire scan pipeline.

## Proactive improvements (beyond the BRD)

The BRD invites enhancements — implemented here:
- **Dry‑run upload preview** showing the resolved column mapping, per‑row validation errors, and the invoices that would be created — before committing.
- **Batched optimistic scan pipeline + SSE** for zero‑lag, multi‑device‑synchronized receiving.
- **Audited manual override** (set an absolute received count with a reason).
- **Reconciliation analytics dashboard** — fill rate, variance by warehouse/vendor, largest variances.
- **AI column mapping + grounded ops assistant + insights** (Gemini), all optional and degrading gracefully.
- **General audit log** (logins, uploads, user/warehouse changes, exports) in addition to the scan‑event trail.
- **All‑or‑nothing, idempotent‑safe ingestion** with duplicate‑invoice and unknown‑warehouse rejection.
- **Zero‑ops persistence** (built‑in SQLite, WAL) and a **single‑process production mode** (API serves the SPA).
```
