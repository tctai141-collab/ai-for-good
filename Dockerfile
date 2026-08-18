FROM oven/bun:1.3.14-alpine AS build
WORKDIR /app
ENV ASTRO_TELEMETRY_DISABLED=1
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bunx astro build
# Drop dev-only packages before they are copied into the runtime image. The
# runtime needs the production dependency tree; TypeScript and the type
# packages have no business in a deployed container.
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /app
ENV ASTRO_TELEMETRY_DISABLED=1
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NODE_ENV=production
ENV DB_PATH=/app/data/sprint-buddy.db
# Mount point for the persistent disk. Everything — accounts, conversations,
# check-ins — lives here, so it must be a volume rather than image layers.
RUN mkdir -p /app/data
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
# Needed so `bun scripts/create-organizer.ts` can be run from a shell on the
# deployed instance to bootstrap the first organizer. Bun executes the
# TypeScript directly; the script imports from src/.
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json

# NOT run as a non-root user, deliberately.
#
# `USER bun` was added here as a hardening step and broke production. /app/data
# is a persistent disk that Render mounts at *runtime*; the chown above runs at
# *build* time and never touches it. The database files on that disk were
# created by an earlier root container and stay root-owned 0644, so a non-root
# process can read them and not write them:
#
#   uid=1000(bun)
#   -rw-r--r-- 1 root bun  sprint-buddy.db
#   [unhandled] attempt to write a readonly database { path: "/api/session" }
#
# Fixing it properly needs a root entrypoint that chowns the mount and then
# drops privileges, which is more moving parts than the benefit justifies for a
# single-tenant container whose only writable state is that disk. Revisit only
# if the entrypoint is worth adding.

EXPOSE 3000
CMD ["bun", "./dist/server/entry.mjs"]
