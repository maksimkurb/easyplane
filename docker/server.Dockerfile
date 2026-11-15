# EasyPlane server + bundled web UI.
#
#   docker build -f docker/server.Dockerfile -t easyplane/server .
#
# The runtime image contains the compiled server, the Drizzle migrations and
# the built SPA; the server serves both on EASYPLANE_HTTP_PORT (8080).
#
# EASYPLANE_VERSION is baked in as a runtime env var and reported by /health.
# CI passes the release version (or "edge" on main); a local build leaves it
# empty and the server falls back to its built-in default.

ARG EASYPLANE_VERSION=

FROM oven/bun:1.4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/proto/package.json packages/proto/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

FROM deps AS build
WORKDIR /app
COPY . .
RUN bun run build && bun run web:build

FROM deps AS prod-deps
WORKDIR /app
RUN bun install --frozen-lockfile --production

FROM node:22-bookworm-slim AS runtime
ARG EASYPLANE_VERSION
WORKDIR /app
ENV NODE_ENV=production \
    EASYPLANE_HOST=0.0.0.0 \
    EASYPLANE_HTTP_PORT=8080 \
    EASYPLANE_WEB_DIR=/app/apps/web/dist \
    EASYPLANE_VERSION=${EASYPLANE_VERSION}
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps ./apps
COPY --from=prod-deps /app/packages ./packages
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/drizzle ./apps/server/drizzle
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/proto/dist ./packages/proto/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
USER node
EXPOSE 8080 22020 22023
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.EASYPLANE_HTTP_PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/main.js"]
