# Stage 1: build — has all deps (incl. dev) and the TypeScript compiler
FROM node:22-alpine AS build
WORKDIR /app

# Copy manifests first so `npm ci` is cached until dependencies change
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Drop devDependencies so the runtime stage gets a lean node_modules
RUN npm prune --omit=dev

# Stage 2: runtime — only dist/ + production deps, no TS, no tests, no eslint
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Run as the non-root `node` user that the base image provides
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node

EXPOSE 3000

# Exec form so node is PID 1 and receives SIGTERM from `docker stop`
CMD ["node", "dist/server.js"]