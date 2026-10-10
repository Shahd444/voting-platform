# MC2026 voting — one image: NestJS API serving the built React app.

# 1) React front-end
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2) NestJS API
FROM node:22-alpine AS api
WORKDIR /api
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

# 3) Runtime (small, non-root)
FROM node:22-alpine
ENV NODE_ENV=production FRONTEND_DIST=/app/web
WORKDIR /app/api
RUN apk add --no-cache tini
COPY --from=api /api/node_modules ./node_modules
COPY --from=api /api/dist ./dist
COPY backend/package.json ./
COPY backend/seed ./seed
COPY --from=web /web/dist /app/web
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
