# Dockerfile for @dgipr/api (Fastify).
#
# Build context is the REPO ROOT (this is a pnpm monorepo): the API imports the
# workspace packages @dgipr/{content-engine,poster-renderer,database,schemas},
# which build to their own dist/. We build ONLY the @dgipr/api subgraph
# (`--filter @dgipr/api...`) — api plus the packages it depends on — so we skip
# installing/building apps/web (Next.js), which deploys on Vercel and would
# otherwise bloat the image and build time.
#
#   docker build -f deploy/api.Dockerfile -t dgipr-api .
#
# NO CHROMIUM: posters are rendered by the n8n workflows (article-poster-v1-api /
# social-post-v2-api) via the OpenAI image API — the default ARTICLE_POSTER_MODE
# is 'n8n'. The in-container HTML/Playwright renderer (ARTICLE_POSTER_MODE=html)
# is kept in the codebase but is NOT installed here, so this image is lean and
# needs no browser system libs. To use html mode you must re-enable the Chromium
# layer at the bottom of this file and rebuild.
FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# Skip Playwright's postinstall browser download — the npm module still installs
# (imports resolve; launch is lazy), we just don't ship the ~150MB browser we
# never launch in n8n mode.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN corepack enable

WORKDIR /app

# Install deps first (better layer caching). Copy every package.json + the
# lockfile/workspace manifest so pnpm can resolve the full workspace graph, then
# install ONLY the @dgipr/api subgraph (skips Next.js/react/svgr from apps/web).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/content-engine/package.json packages/content-engine/
COPY packages/poster-renderer/package.json packages/poster-renderer/
COPY packages/database/package.json packages/database/
COPY packages/schemas/package.json packages/schemas/
COPY packages/social-publisher/package.json packages/social-publisher/
RUN pnpm install --frozen-lockfile --filter "@dgipr/api..."

# Now the source, then build the api + its workspace deps in topological order
# (NOT apps/web — that's Vercel's job).
COPY . .
RUN pnpm --filter "@dgipr/api..." --if-present build

# Bind to all interfaces inside the container (the app defaults to 127.0.0.1,
# which would be unreachable from outside). PORT/CORS_ORIGIN/etc. come from the
# runtime environment (docker-compose env_file), NOT a baked-in .env.
ENV HOST=0.0.0.0
ENV PORT=3001
EXPOSE 3001

# Note: no `--env-file` here (unlike the local `start` script) — env is injected
# by the container runtime.
CMD ["node", "apps/api/dist/index.js"]

# --- OPTIONAL: enable ARTICLE_POSTER_MODE=html (in-container Chromium) ---
# Requires the full (non-slim) base `FROM node:22-bookworm` above, then add:
#   RUN pnpm --filter @dgipr/poster-renderer exec playwright install --with-deps chromium
# and drop `ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. This makes the image large
# and raises the box's RAM needs — only do it if you actually use html mode.
