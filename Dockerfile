# quappe-web — multi-stage build → standalone Node server (adapter-node).
# Presentation-only: no native deps, no database. Talks to the service via the
# reverse proxy (PRIVATE_SERVICE_URL) at runtime.

# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build \
	&& npm prune --omit=dev

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Where the API lives. Override in prod (e.g. the internal service address).
ENV PRIVATE_SERVICE_URL=http://quappe-service:3000

COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node
EXPOSE 3000
CMD ["node", "build"]
