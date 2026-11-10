# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:26-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install -g pnpm@12.18.0
WORKDIR /src

# Install dependencies first (cached unless manifests change)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---------- runtime ----------
FROM node:26-slim AS runtime
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="kakebo" \
      org.opencontainers.image.description="Programmazione mensile delle finanze di casa" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/public \
    DATA_DIR=/data \
    KAKEBO_VERSION=${VERSION}

WORKDIR /app
# The API is bundled into a single file: no node_modules needed at runtime.
COPY --from=build /src/apps/api/dist/ ./
COPY --from=build /src/apps/web/dist/ ./public/

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "--enable-source-maps", "index.js"]
