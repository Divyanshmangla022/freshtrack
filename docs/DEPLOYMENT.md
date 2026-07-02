# FreshTrack - Setup & Deployment

## Local setup

Prerequisites: Node.js 22+ (Node 24+ recommended; the backend runs TypeScript natively).

```bash
cd freshtrack
npm install
npm run seed        # creates the SQLite DB + admin, warehouses, hub users, sample invoices
npm run dev         # API on :4000 (nodemon hot-reload) + web on :5173 (Vite)
```

Open http://localhost:5173. Seeded logins:

| Role | Email | Password |
|---|---|---|
| Central Admin | admin@freshtrack.io | Admin@12345 |
| Hub User | nyc.hub@freshtrack.io | Hub@12345 |

## Environment variables

Copy the block below into `server/.env` (a dev file is created for you on first setup). All values have safe defaults except in production, where `JWT_SECRET` is mandatory.

```env
PORT=4000
CORS_ORIGIN=*
JWT_SECRET=<generate: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
TOKEN_TTL=12h
DATABASE_FILE=./data/freshtrack.db

# Seed accounts (used only by `npm run seed`)
SEED_ADMIN_EMAIL=admin@freshtrack.io
SEED_ADMIN_PASSWORD=Admin@12345
SEED_HUB_PASSWORD=Hub@12345

# AI features (OPTIONAL - Google Gemini). Leave unset to run fully offline.
# GEMINI_API_KEY=your-key-here      # https://aistudio.google.com/apikey
AI_MAPPING_MODEL=gemini-2.5-flash
AI_ASSISTANT_MODEL=gemini-2.5-pro
```

> In production (`NODE_ENV=production`) the server refuses to start with the insecure default `JWT_SECRET` - always set a strong one.

## Publish to GitHub

```bash
cd freshtrack
git init -b main            # (already initialized; skip if so)
git add -A
git commit -m "FreshTrack: inbound produce receiving system"

# create an empty repo on GitHub, then:
git remote add origin https://github.com/<you>/freshtrack.git
git push -u origin main
```

`node_modules/`, the SQLite database, and `.env` are git-ignored; only source + `.env.example` are committed.

## Deployment options

### Option A - Docker (any host)

```bash
docker build -t freshtrack .
docker run -d --name freshtrack -p 4000:4000 \
  -e JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" \
  -e GEMINI_API_KEY="your-key" \
  -v freshtrack_data:/app/server/data \
  freshtrack

# one-time: seed the database inside the container
docker exec freshtrack node server/src/db/seed.ts
```

The API serves the built web UI at http://localhost:4000.

### Option B - Managed Node host (Render / Railway / Fly.io / etc.)

- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`  (runs `node server/src/index.ts`, which serves the SPA from `web/dist`)
- **Env:** set `JWT_SECRET` (required), `NODE_ENV=production`, optional `GEMINI_API_KEY`. The platform provides `PORT`.
- **Persistent disk:** mount it at `server/data` so the SQLite file survives restarts.
- **First run:** execute `node server/src/db/seed.ts` once (a shell/release step) to create the admin, or create the admin another way.
- For serious scale, swap SQLite for PostgreSQL (only the `*.repo.ts` files change) - see `docs/ARCHITECTURE.md` section 9.

### Option C - VPS with a process manager

```bash
git clone <repo> && cd freshtrack
npm install && npm run build && npm run seed
JWT_SECRET=... NODE_ENV=production npx pm2 start "node server/src/index.ts" --name freshtrack
```
Put Nginx/Caddy in front for TLS.

## Post-deploy checklist

- [ ] Strong `JWT_SECRET` set
- [ ] Served over HTTPS (reverse proxy)
- [ ] Change the seeded admin password (or seed with your own `SEED_ADMIN_*`)
- [ ] Persistent volume mounted for the SQLite file
- [ ] (Optional) `GEMINI_API_KEY` set to enable AI features
