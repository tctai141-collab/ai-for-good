FROM oven/bun:1.3.14-alpine AS build
WORKDIR /app
ENV ASTRO_TELEMETRY_DISABLED=1
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bunx astro build

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
EXPOSE 3000
CMD ["bun", "./dist/server/entry.mjs"]
