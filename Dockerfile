# Stage 1: Build
# Debian (glibc) instead of Alpine so node_modules match the Playwright runtime below
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Copy all project files, including routes, modules, controllers, etc.
COPY . .

RUN npm run build

# Remove development dependencies
RUN npm prune --omit=dev

# Stage 2: Runtime
# Official Playwright image ships Chromium + its system libraries.
# Keep this tag in sync with the "playwright" version in package-lock.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build --chown=pwuser:pwuser /app/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /app/dist ./dist
COPY --from=build --chown=pwuser:pwuser /app/package.json ./

USER pwuser

EXPOSE 3000

CMD ["node", "dist/server.js"]
