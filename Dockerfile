ARG NODE_VERSION=24

# ---------- 1) dependências de produção (camada cacheada enquanto o package*.json não mudar) ----------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- 2) imagem final, enxuta e sem root ----------
FROM node:${NODE_VERSION}-alpine AS runtime
LABEL org.opencontainers.image.title="Estoque NTI" \
      org.opencontainers.image.description="Sistema de estoque do setor NTI"

# tzdata: sem ele a variável TZ (fuso horário) é ignorada no Alpine.
# (versão não fixada de propósito: o Alpine remove versões antigas do repositório e o build quebraria)
# hadolint ignore=DL3018
RUN apk add --no-cache tzdata

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY db ./db
COPY scripts ./scripts

# UID numérico (1000 = usuário "node" da imagem): funciona em Kubernetes com runAsNonRoot e em volumes montados
USER 1000:1000
EXPOSE 3000

# O healthcheck confere o app e o banco (GET /api/health). O Alpine não tem curl, então usamos o fetch do Node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "src/server.js"]
