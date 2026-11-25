# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl python3 make g++

COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm ci
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN npm run build
RUN npm prune --omit=dev

# Stage 2: Production runtime
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache openssl \
  && addgroup -g 1001 -S aquasafe \
  && adduser -S aquasafe -u 1001 -G aquasafe

COPY --from=builder --chown=aquasafe:aquasafe /app/node_modules ./node_modules
COPY --from=builder --chown=aquasafe:aquasafe /app/dist ./dist
COPY --from=builder --chown=aquasafe:aquasafe /app/prisma ./prisma
COPY --from=builder --chown=aquasafe:aquasafe /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=aquasafe:aquasafe /app/package.json ./package.json

USER aquasafe

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

CMD ["node", "dist/main.js"]
