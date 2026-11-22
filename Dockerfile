# syntax=docker/dockerfile:1
#
# Two images from one file:
#   docker build .                       the UI on its own (the last stage, `ui`): point it at your WireMock
#   docker build --target standalone .   the UI and WireMock in one container
#
# The build and dependency stages run on the builder's own platform ($BUILDPLATFORM): the output (the built app and
# pure-JS dependencies) is the same on every CPU, so a multi-platform build (linux/amd64 + linux/arm64) compiles once
# and never runs npm under emulation.

ARG NODE_VERSION=22
ARG WIREMOCK_VERSION=3.13.1

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Only the Node binary is taken from here (glibc, matching WireMock's Ubuntu base).
FROM node:${NODE_VERSION}-bookworm-slim AS node-glibc

# ---------------------------------------------------------------------------------------------------------------
# Standalone: WireMock and the UI in one container. docker/standalone-entrypoint.sh starts both, stops the
# container when either stops, makes WireMock's admin password and the session secret when they are not set, and
# keeps everything in /data.
FROM wiremock/wiremock:${WIREMOCK_VERSION} AS standalone
COPY --from=node-glibc /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ENV NODE_ENV=production PORT=3000 WIREMOCK_PORT=8080 SQLITE_PATH=/data/wiremock-ui.db
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.mjs ./
COPY examples ./examples
COPY --from=build /app/dist ./dist
COPY docker/standalone-entrypoint.sh /usr/local/bin/wiremock-ui-standalone
# The account command: docker exec -it <container> wiremock-ui create-admin
COPY docker/wiremock-ui /usr/local/bin/wiremock-ui
RUN chmod 755 /usr/local/bin/wiremock-ui-standalone /usr/local/bin/wiremock-ui \
  && useradd --system --uid 10001 --home-dir /data --shell /usr/sbin/nologin wmui \
  && mkdir -p /data && chown wmui:wmui /data && chmod 700 /data
VOLUME /data
USER wmui
EXPOSE 3000 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/wiremock-ui-standalone"]

# ---------------------------------------------------------------------------------------------------------------
# UI only (default target): runs next to your own WireMock (WIREMOCK_URL).
FROM node:${NODE_VERSION}-alpine AS ui
WORKDIR /app
# SQLITE_PATH is used only when REDIS_URL is unset (or STORE_DRIVER=sqlite).
ENV NODE_ENV=production PORT=3000 SQLITE_PATH=/data/wiremock-ui.db
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.mjs ./
# The example integrations and mocks: SEED_PATH=/app/examples/seed.json to try the app with something in it.
COPY examples ./examples
COPY --from=build /app/dist ./dist
# The account command: docker exec -it <container> wiremock-ui create-admin
COPY docker/wiremock-ui /usr/local/bin/wiremock-ui
RUN chmod 755 /usr/local/bin/wiremock-ui \
  && mkdir -p /data && chown node:node /data && chmod 700 /data
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
# node:sqlite needs --experimental-sqlite on Node 22.12; later versions accept it and only warn.
CMD ["node", "--experimental-sqlite", "--disable-warning=ExperimentalWarning", "server.mjs"]
