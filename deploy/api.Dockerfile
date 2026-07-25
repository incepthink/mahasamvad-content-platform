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
# CHROMIUM IS REQUIRED: the article-PDF export (GET /api/generations/:id/article.pdf)
# renders through headless Chromium — the same HarfBuzz shaper that makes the posters'
# Devanagari correct, and which no PDF library provides — so the browser ships in this
# image (see the install layer after the build step below). Posters themselves do not
# need it: ARTICLE_POSTER_MODE defaults to 'fresh' (the API builds the prompt and calls
# the OpenAI image API directly), with 'n8n' handled by the workflows. The in-container
# HTML poster renderer (ARTICLE_POSTER_MODE=html) now also works as a side effect.
FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# Skip Playwright's postinstall browser download so the dependency layer below stays
# lean and cacheable; the browser is installed explicitly, once, after the build step
# (overriding this variable for that one RUN).
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

# Chromium for the article-PDF export. --with-deps apt-installs the shared libraries it
# needs (and fonts-liberation, which is the template's Latin fallback) and works fine on
# -slim, which is still Debian bookworm with apt. PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is
# overridden for this RUN only, so the install layer above stays lean and cached.
# Cost: ~400-500MB of image and ~200-300MB peak RSS per export — check the box's memory
# headroom, since it also runs n8n.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0 \
    pnpm --filter @dgipr/poster-renderer exec playwright install --with-deps chromium

# Bind to all interfaces inside the container (the app defaults to 127.0.0.1,
# which would be unreachable from outside). PORT/CORS_ORIGIN/etc. come from the
# runtime environment (docker-compose env_file), NOT a baked-in .env.
ENV HOST=0.0.0.0
ENV PORT=3001
EXPOSE 3001

# Note: no `--env-file` here (unlike the local `start` script) — env is injected
# by the container runtime.
CMD ["node", "apps/api/dist/index.js"]

# --- Note on ARTICLE_POSTER_MODE=html ---
# The Chromium layer above is installed for the article-PDF export, so html poster mode
# now works too with no further change. It is still not the default (that is 'fresh').
# If the PDF export is ever dropped and this image should go back to being lean, remove
# that layer — the route then returns a Marathi 503 rather than crashing.
