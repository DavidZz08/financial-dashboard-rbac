# ---- stage 1: build the React SPA -------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY frontend frontend
RUN npm run build -w frontend

# ---- stage 2: slim runtime (API + static SPA, one process, one port) --------------------------
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# Production dependencies of the backend only (no vite, vitest, react... in the final image).
RUN npm ci --omit=dev -w backend --include-workspace-root=false && npm cache clean --force
COPY backend/src backend/src
COPY --from=build /app/frontend/dist frontend/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://localhost:4000/api/health || exit 1
CMD ["node", "backend/src/server.js"]
