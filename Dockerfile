# syntax=docker/dockerfile:1
# Imagen única: bot + dashboard bajo pm2-runtime (un solo contenedor).
# Se usa pm2 dentro del contenedor A PROPÓSITO: los botones Iniciar/Detener/
# Reiniciar del dashboard controlan el bot vía `pm2` (dashboard/routes) — con
# procesos en contenedores separados ese control se rompería.

# ── deps: node_modules de producción (compila better-sqlite3 si hace falta) ──
FROM node:20-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json .puppeteerrc.cjs ./
RUN npm ci --omit=dev

# ── ui: build del panel React ────────────────────────────────────────────────
FROM node:20-bookworm AS ui
WORKDIR /app/dashboard-ui
COPY dashboard-ui/package.json dashboard-ui/package-lock.json ./
RUN npm ci
COPY dashboard-ui/ ./
RUN npm run build

# ── final ────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium ca-certificates fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pm2@5

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=ui /app/dashboard-ui/dist ./dashboard-ui/dist

# DB_PATH apunta al volumen /data (ver docker-compose.yml). El bot ya arranca
# Chromium con --no-sandbox/--disable-dev-shm-usage (bot/index.js).
ENV NODE_ENV=production \
    CHROME_PATH=/usr/bin/chromium \
    DB_PATH=/data/jugueteria.db

EXPOSE 3001
CMD ["pm2-runtime", "ecosystem.config.js"]
