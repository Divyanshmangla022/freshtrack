# FreshTrack - single-image build. Builds the web client and runs the API,
# which also serves the built SPA (one process, one SQLite file).
FROM node:24-alpine

WORKDIR /app

# Install dependencies (dev deps included so the web build can run).
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

# Copy source and build the web client into web/dist.
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=4000
# JWT_SECRET must be provided at runtime (the app refuses the dev default in production).
EXPOSE 4000

# SQLite database lives here; mount a volume to persist it across restarts.
VOLUME ["/app/server/data"]

CMD ["node", "server/src/index.ts"]
