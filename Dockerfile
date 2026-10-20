FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 AI_ENABLED=false
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY next.config.ts tsconfig.json tsconfig.app.json ./
ARG MOSAIC_BUILD_COMMIT=local
ENV MOSAIC_BUILD_COMMIT=$MOSAIC_BUILD_COMMIT
RUN npm run build

FROM build AS migrate
COPY scripts ./scripts
COPY migrations ./migrations
CMD ["node", "--import", "tsx", "scripts/migrate.ts"]

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 AI_ENABLED=false ALLOW_REGISTRATION=false HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
