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
RUN mkdir -p /app/data
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["bun", "./dist/server/entry.mjs"]
