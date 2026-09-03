# Deployment runbook — DGIPR Marathi Content Platform

Target topology (pilot):

```
Vercel                         AWS EC2 (single host, docker compose)          Supabase (managed, existing)
  └─ web  (Next.js)              ├─ caddy  (TLS, :80/:443)                       ├─ Postgres + pgvector
     calls API over HTTPS ──────►│    ├─ api  (Fastify, no Chromium :3001)       ├─ Storage: posters/ (+ references/)
                                 │    └─ n8n  (social-post + article-poster :5678)  ◄─┘  masters fetched over HTTPS
                                 └─ (api ⇄ n8n over internal compose network)
```

- **web** → Vercel
- **api + n8n** → one EC2 box, `docker compose`, behind Caddy (auto-HTTPS)
- **Supabase** → your existing managed project (shared with local dev for now)
- **Posters render in n8n** (both workflows call the OpenAI image API), so the API
  needs no Chromium — `ARTICLE_POSTER_MODE=n8n` is the default; the in-container
  HTML/Playwright renderer stays as an off-by-default fallback (not built into the image).

Files in this directory:

| File | Purpose |
| --- | --- |
| `api.Dockerfile` | Builds the monorepo and runs `apps/api` (lean, no Chromium) |
| `docker-compose.yml` | api + n8n + caddy on the EC2 host |
| `Caddyfile` | Reverse proxy + automatic TLS for `api.indicex.xyz` and `n8n.indicex.xyz` |
| `.env.prod.example` | Template for the API container's runtime env (copy to `.env.prod`) |
| `health-check.js` | Stuck-job + 24h-failure digest, read from the DB (the record that survives a deploy) |
| `health-check.sh` | Cron wrapper for the above — silent when healthy, so a quiet mailbox is the all-clear |

---

## Prerequisites you provide

- **Domain**: `indicex.xyz` — `api.indicex.xyz` (API), `n8n.indicex.xyz` (n8n
  editor), `newsroom.indicex.xyz` (web, as a Vercel custom domain).
- The **existing Supabase** URL + anon key + service-role key.
- An **OpenAI API key**.

---

## Phase A — Supabase (existing project): confirm it's prod-ready

You're reusing your current project, so migrations `0001`–`0010` are already applied
and `posters/references/master-*.png` are already uploaded. Just confirm:

1. **Glossary seed `0010`** — this was the one item still outstanding. If the
   `/glossary` page is empty in prod, apply it in the Supabase SQL editor
   (paste `supabase/migrations/0010_glossary_seed.sql`).
2. **Reference templates exist** — open in a browser:
   `https://<PROJECT>.supabase.co/storage/v1/object/public/posters/references/master-quote.png`
   If 404, re-run locally: `pnpm --filter @dgipr/content-engine upload:references`.
3. **Article master exists** — the article-poster workflow edits it:
   `https://<PROJECT>.supabase.co/storage/v1/object/public/posters/references/master-article.png`
   If 404, re-run locally: `pnpm --filter @dgipr/content-engine upload:article-master`.

> ⚠️ Shared DB caveat: local dev and prod now hit the same tables/bucket. Fine for
> a pilot; split into a second project when you want isolation.

---

## Phase B — EC2 host: run api + n8n

1. **EC2 host**: Ubuntu, `t3.small`/`t3.medium` is plenty — no Chromium here, so
   RAM is modest (API is Node/Fastify; n8n calls the OpenAI image API). **Root EBS
   volume: 30 GB gp3** — the 8 GB AMI default runs out of disk mid-build (n8n image
   + API image + Docker build cache). Attach an **Elastic IP** so the address is
   stable.
2. **Security group inbound**: `80` and `443` from `0.0.0.0/0`; `22` from *your IP
   only*. Do **not** expose 3001 or 5678 publicly — Caddy fronts them.
3. **DNS**: point `api.indicex.xyz` and `n8n.indicex.xyz` (A records) at the Elastic
   IP. (`newsroom.indicex.xyz` points at Vercel — handled in Phase D.)
4. **Install Docker** on the box:
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER && newgrp docker
   ```
5. **Get the code** on the box (`git clone` your repo, or `rsync` it up).
6. **Configure** two files in `deploy/` (both gitignored):
   ```bash
   cd <repo>/deploy

   # (a) API container env — Supabase + OpenAI + N8N_WEBHOOK_SECRET + CORS
   cp .env.prod.example .env.prod

   # (b) docker-compose variable substitution (N8N editor host + basic-auth).
   #     compose auto-reads a file literally named `.env` in this dir; shell
   #     `export`s would be lost on the next SSH session, so use this file.
   cat > .env <<'EOF'
   N8N_SUBDOMAIN=n8n.indicex.xyz
   N8N_BASIC_AUTH_USER=admin
   N8N_BASIC_AUTH_PASSWORD=a-strong-password
   EOF
   ```
   Set `CORS_ORIGIN` in `.env.prod` to `https://newsroom.indicex.xyz`. An entry may be a
   pattern containing `*` (one hostname label — it matches no dot, so it cannot widen past
   its own domain), which is how the Vercel URLs are covered without editing this value
   per deployment:
   `https://newsroom.indicex.xyz,https://mahasamvad-content-platform-web-*.vercel.app`.
   Every OTHER front end that calls this API needs its own entry here as well —
   `https://staging.hashcase.tech` is one such origin. An origin missing from this
   list is not refused by the API; it simply gets no `access-control-allow-origin`
   header back, which the browser reports as "No 'Access-Control-Allow-Origin'
   header is present on the requested resource" while the request itself succeeded.
   The repository-root `.env` is for local development only and is excluded from
   the Docker image. Video storyboards therefore require `GEMINI_API_KEY` in
   `deploy/.env.prod` (or `OPENAI_API_KEY` with `VIDEO_IMAGE_PROVIDER=openai`).
   Then edit `Caddyfile` if your ACME email should differ from the default.
7. **Launch**. The `api` image is built by GitHub Actions and pulled (see
   [Updating the API](#updating-the-api-github-actions-builds-the-box-only-pulls)), so make
   sure a workflow run has gone green first, then here:
   ```bash
   docker login ghcr.io -u <github-user>   # once, unless the package is public
   docker compose pull                     # api from GHCR; n8n/caddy/postgrest upstream
   docker compose up -d
   docker compose logs -f api              # watch for "server listening" + no errors
   ```
8. **Smoke-test the API** publicly:
   ```bash
   curl https://api.indicex.xyz/health   # expect a 200/ok
   ```

---

## Phase C — n8n: import the workflows

> ⚠️ **n8n does not read workflow JSON from disk.** Workflows live in n8n's own database
> inside the `n8n_data` volume. `git pull` on this box — and `docker compose up -d --build`,
> which only rebuilds the **api** image — changes nothing about them. The workflows are
> shipped separately, by the two mechanisms below. This is the #1 cause of "I pushed my
> changes but the hosted workflow is still the old one".

### C1 — First-time bootstrap (once per n8n instance, in the browser)

Only the credentials must be created by hand — an API key cannot create them for you.

1. Open `https://n8n.indicex.xyz` and create the owner account if prompted.
2. **Import both workflows** (Workflows → Import from File):
   - `n8n/workflow-exports/social-post-v2-api.json` (twitter/social path)
   - `n8n/workflow-exports/article-poster-v1-api.json` (news/scheme article poster)

   The imported nodes arrive with their OpenAI credential **unbound** — by design. A
   credential id is meaningless outside the instance that minted it, so the committed
   JSON names the credential but carries no id. Step 3 is mandatory, not cleanup.
3. **OpenAI credential**: create a Header Auth credential named exactly `OpenAI Bearer
   (DGIPR)` (Name `Authorization`, Value `Bearer sk-…`) and bind it on **all 7** HTTP
   nodes that call OpenAI:
   - `article-poster-v1-api`: `Edit Image`
   - `social-post-v2-api`: `Classify L0`, `Generate Copy L1`, `Generate Image L2`,
     `Edit Image L2`, `Generate Caption L3`, `Edit Feedback Image`

   The name must match exactly — `pnpm n8n:push` re-binds by name on every later push,
   and refuses to push at all if it cannot find that name on the instance.
4. **Header Auth on each webhook** (enforces `N8N_WEBHOOK_SECRET`):
   - Webhook node → Authentication → **Header Auth**.
   - Create/reuse a Header Auth credential: Name `x-n8n-webhook-secret`, Value = the
     same `N8N_WEBHOOK_SECRET` you put in `.env.prod`.
   - `pnpm n8n:push` preserves this on later pushes (the committed JSON has auth off).
5. **Activate** both workflows. The API reaches them internally at
   `http://n8n:5678/webhook/dgipr-social-post` and
   `http://n8n:5678/webhook/dgipr-article-poster` (already wired in compose) — no
   public webhook call needed from the API.
6. In the n8n editor: **Settings → n8n API → Create an API key**. Keep it for C2.

### C2 — Every workflow change after that: `pnpm n8n:push`

From your laptop (root `.env`, gitignored):

```bash
N8N_API_URL=https://n8n.indicex.xyz
N8N_API_KEY=<the key from C1 step 6>
```

```bash
pnpm n8n:push --dry-run   # shows the name matches + credential remap; writes nothing
pnpm n8n:push             # PUTs both exports, then deactivate/activate to republish
```

It matches workflows **by name**, binds each node's credential to the id this instance's own
credential of that name actually has, preserves the Webhook node's Header Auth, and refuses
to guess if a name is missing or duplicated. It is idempotent — re-run it freely.

**If it aborts with "credential binding(s) cannot be resolved":** the named credential does
not exist on that n8n. Nothing was written — the live workflows are untouched. Create it in
the UI per C1 step 3 (exact name) and re-run. The guard exists because a workflow carrying a
credential id the instance does not have imports and *activates* perfectly, then dies mid-run
with `Credential with ID "…" does not exist for type "httpHeaderAuth"`. `--allow-unbound`
pushes anyway and leaves those nodes visibly unbound in the editor instead.

**Deploy the API before pushing workflows.** The current workflows are data-driven and
need payload fields (`types` catalog, `forced_type`, `reference_url`) that only the
current API sends; pushing them ahead of an API deploy breaks both paths.

---

## Phase D — Web on Vercel

1. Import the Git repo into Vercel. In project settings:
   - **Root Directory**: `apps/web`
   - **Framework preset**: Next.js (auto-detected)
   - Vercel handles the pnpm monorepo; if the build can't find workspace deps, set
     **Install Command** to `pnpm install` at the repo root and **Build Command** to
     `pnpm --filter @dgipr/web... build` (build web + its workspace deps).
2. **Environment variable**:
   - `NEXT_PUBLIC_API_URL = https://api.indicex.xyz`  (no trailing slash)
3. Deploy, then add the **custom domain `newsroom.indicex.xyz`** to the Vercel
   project (Settings → Domains) and create the CNAME/A record Vercel shows you.
4. **Back to the API**: set `CORS_ORIGIN` in `deploy/.env.prod` to
   `https://newsroom.indicex.xyz,https://mahasamvad-content-platform-web-*.vercel.app,https://staging.hashcase.tech`,
   then `docker compose up -d` again to pick it up. The wildcard entry covers the
   production Vercel URL **and** every branch preview
   (`https://mahasamvad-content-platform-web-git-staging-hashcase.vercel.app` and the
   per-push hostnames beside it), which is what keeps a preview from failing in the
   browser while the API answers perfectly. A preview also needs its own
   `NEXT_PUBLIC_API_URL` in Vercel: that variable is inlined at BUILD time, so it must be
   set for the **Preview** environment as well as Production, and the preview must be
   redeployed after adding it.

---

## Phase E — End-to-end verification

1. **Article + poster path**: on the Vercel site, create a `scheme`/`news` generation
   with a poster. Watch progress → article renders in Marathi → poster PNG loads. With
   the default `ARTICLE_POSTER_MODE=n8n`, the poster is a landscape banner produced by
   the `article-poster-v1-api` workflow (proves the API → n8n round-trip + Supabase
   Storage). Set `ARTICLE_POSTER_MODE=html` (compose env) to fall back to the
   in-container Chromium renderer instead.
2. **Twitter/social path**: create a `twitter`-category generation. Confirm the API
   → n8n round-trip returns `{ post_type, title, caption, poster_png_base64 }` and an
   on-brand poster (proves n8n fetched the Supabase reference template over HTTPS).
3. **Refresh mid-job**: reload the page while a job runs — it should recover state
   from the `generations` row (proves polling survives restarts).
4. **Glossary**: open `/glossary` — terms from seed `0010` show.

---

## Updating the API: GitHub Actions builds, the box only pulls

**Nothing is ever compiled on the EC2 host.** `.github/workflows/api-image.yml` builds the
image on every push to `main` and pushes it to GHCR; the box downloads it and restarts.
Building on the box means a `pnpm install`, a six-package `tsc` run and a ~500 MB
`playwright install chromium` competing for the RAM of a host that also runs n8n, Caddy and
PostgREST — which is why it took ~15 minutes and died non-deterministically in the
TypeScript step. The output is identical wherever it is produced.

> **What does *not* work**, because it silently appears to: `git pull` on the box then
> `docker compose restart api`. The Dockerfile does `COPY . .` and `pnpm build` *inside* the
> image, and the `api` service mounts no source volume — so pulled commits are never
> compiled, and `restart` reuses the container's existing image regardless. You end up
> debugging a fix against a container that never received it.

### One-time setup

1. **Push this commit to `main`.** The workflow runs and creates the package at
   `https://github.com/users/incepthink/packages`. Watch it under the repo's Actions tab;
   the first run is a cold cache and takes several minutes, later ones are much shorter.
2. **If that first run fails with a 403 on the package**, a `dgipr-api` package already
   exists from an earlier manual laptop push and is not linked to this repository. Fix it
   once at Package settings → *Manage Actions access* → add the repo with **Write**, or
   delete the old package and re-run. The workflow emits the
   `org.opencontainers.image.source` label, so a package it creates itself links
   automatically and this never recurs.
3. **Give the box read access** — either make the package public (Package settings →
   Change visibility), or on the box `docker login ghcr.io -u incepthink` with a PAT
   carrying `read:packages`. Once; Docker stores the credential.
4. **Get the new compose file onto the box.** This is the one thing `git pull` *is* for
   here — it ships `deploy/docker-compose.yml`, not the application:
   ```bash
   cd <repo> && git pull
   ```

No secrets to configure: the workflow pushes with the automatic `GITHUB_TOKEN`.

### Every deploy

Push to `main`, wait for the Actions run to go green, then **on the box only**:

```bash
cd <repo>/deploy
docker compose pull api     # must print a digest — see the gotcha below
docker compose up -d api
docker compose logs -f api  # "server listening", no errors
curl https://api.indicex.xyz/health
```

That is the whole deploy — a layer download and a container recreate, on the order of a
minute. The box never runs a compiler.

**Order still matters**, unchanged: migrations → API → `pnpm n8n:push`. Web deploys itself
from the Vercel git integration.

**A recreate kills in-flight jobs.** The API is a single-process service (see the orphan
reaper note in CLAUDE.md — two instances would fight over each other's jobs), so this is a
stop-then-start, not a rolling swap, and any article/video/DLO run in progress dies with the
old container. Deploy when it is quiet. Do not add a second `api` replica to avoid it.

### Which commits trigger a build

The workflow ignores pushes that touch only `apps/web/**`, `docs/**`, `n8n/**`,
`supabase/**` and `**/*.md` — none of which change what the API runs. It is a deny-list on
purpose: the default is to build, so a new directory nobody remembered to list still
produces an image. For an infrastructure-only rebuild, use the **Run workflow** button
(`workflow_dispatch`) on the Actions tab.

### Rollback

Every build is tagged with its short commit SHA, so rolling back is naming an older one in
`deploy/.env` on the box (the same file that holds `N8N_SUBDOMAIN`) — no rebuild, no revert
commit, no CI wait:

```bash
echo 'API_TAG=<older-sha>' >> .env
docker compose up -d api
```

Roll forward again by removing that line (back to `latest`) and `up -d api`.

### Gotchas

- **Check the pull actually succeeded.** There is no `build:` key in the compose file, so a
  failed pull is now a loud error rather than a silent fifteen-minute build on the box —
  but it still leaves the *old* container running. Read the `pull` output before `up -d`.
- **`up -d`, never `restart`.** `restart` reuses the existing container and its old image.
  It is for clearing a wedged process, not for deploying.
- **Architecture is pinned to `linux/amd64`** in the workflow, matching the `t3.*` box. If
  the host is ever moved to a Graviton (`t4g.*`) instance, change `platforms:` in
  `.github/workflows/api-image.yml` too, or the container dies instantly on `exec format
  error`.
- **Don't run `docker compose up` locally.** It would also start caddy and send it to
  Let's Encrypt for the production domains. To build the image locally, call docker
  directly: `docker build -f deploy/api.Dockerfile -t dgipr-api:local ..` from `deploy/`.
- **Keep the Chromium layer above `COPY . .`** in `api.Dockerfile`. Below it, every source
  change re-runs an apt install and a ~500 MB browser download; above it, it is cached
  until the lockfile changes. It needs no application source.

### Fallback: build on your laptop

If Actions is unavailable (outage, exhausted minutes) and something must ship, the manual
path still works — it is the same image, produced somewhere else. From the repo root, with
`docker login ghcr.io` done once using a PAT carrying `write:packages`:

```bash
export TAG=$(git rev-parse --short HEAD)
docker build --platform linux/amd64 -f deploy/api.Dockerfile \
  -t ghcr.io/incepthink/dgipr-api:$TAG \
  -t ghcr.io/incepthink/dgipr-api:latest .
docker push ghcr.io/incepthink/dgipr-api:$TAG
docker push ghcr.io/incepthink/dgipr-api:latest
```

Then pull on the box as usual. `--platform linux/amd64` is not optional on an ARM Mac.

Without any registry at all, pipe the image over SSH — `docker save dgipr-api:latest | gzip
| ssh <box> 'gunzip | docker load'`, with `image: dgipr-api:${API_TAG:-latest}` in the
compose file. It works, but re-ships well over a gigabyte on *every* deploy (the Chromium
layer), where a registry sends only the layers that changed.

---

## YouTube bot checks on `/transcribe`, `/dlo` and `/chat`

The API image already contains yt-dlp. If an ordinary YouTube link fails with the stored
per-file error `bot check`, YouTube is refusing the EC2/datacentre address; rebuilding the
same image does not change that address. Configure either cookies or an outbound proxy.
Directly uploaded recordings need neither.

**Cookies:** export only `youtube.com` cookies in Netscape/Mozilla `cookies.txt` format from
a dedicated YouTube browser session. Treat the file like a password. Copy it to the host
outside the repository, then point Compose at that host path and the API at the stable
container path:

```bash
sudo install -d -m 700 /opt/dgipr-secrets
sudo install -m 600 /tmp/youtube-cookies.txt /opt/dgipr-secrets/youtube-cookies.txt

# deploy/.env — consumed by Docker Compose on the HOST
YTDLP_COOKIES_HOST_FILE=/opt/dgipr-secrets/youtube-cookies.txt

# deploy/.env.prod — injected into the API CONTAINER
YTDLP_COOKIES_FILE=/run/secrets/youtube-cookies.txt
```

`docker-compose.yml` mounts a harmless tracked placeholder unless the host variable is set,
so developers and deployments without cookies keep working unchanged. The real mount is
writable because yt-dlp saves its jar on exit; it is never copied into the image. After
changing either env file, recreate the container and verify only the non-secret header:

```bash
docker compose up -d --force-recreate api
docker compose exec api sh -lc 'test -s "$YTDLP_COOKIES_FILE" && head -n 1 "$YTDLP_COOKIES_FILE"'
```

The expected first line is `# Netscape HTTP Cookie File` or `# HTTP Cookie File`.

**Proxy:** no mount is needed. Put the proxy URL only in `deploy/.env.prod`, then recreate
the API container:

```bash
YTDLP_PROXY=http://user:password@proxy-host:port
```

Do not print `docker compose config` into tickets or logs: it expands the API environment
and may expose the cookie path, proxy credentials and unrelated production secrets.

---

## Operations notes

- **Logs**: `docker compose logs -f api` / `... n8n`. Rotated at 50 MB x 5 per service
  (the `x-logging` anchor in `docker-compose.yml`) so they cannot fill the 30 GB root
  volume. **They are not history**: `docker compose up -d api` creates a new container and
  the old one's logs go with it, so an empty `--since=24h` right after a deploy means
  "no history", not "no errors".
- **Finding errors in the log**: pino logs errors as `"level":50`, not the word "error", and
  a *handled* rejection (a 413 file cap, a Marathi 400) never reaches the error handler at
  all — it appears as an ordinary `"level":30` line with a 4xx `statusCode`. So:
  ```bash
  docker compose logs --since=24h --no-color api \
    | grep -E '"level":(50|60)|\] failed:|"statusCode":(4[0-9][0-9]|5[0-9][0-9])'
  ```
  Do **not** grep for a bare `429` — it matches the digits inside `time` and `responseTime`
  on roughly one healthy line in a thousand.
- **Is anything broken right now?** `./health-check.sh` — a stuck-job + 24h-failure digest
  read from the DATABASE, which is where every job persists its own `status`/`error` and is
  the only record that survives a deploy. It prints **nothing when healthy**, so it is a
  cron one-liner (see the header of `health-check.sh`); a quiet mailbox is the all-clear.
  It is the only thing that reports a **stuck** run — a wedged job never sets `failed`, so
  it is invisible in the UI, in `/analytics` and in the logs alike, and the officer just
  watches a spinner. Idle video review gates are deliberately excluded (a project may sit
  at one for a week and be perfectly healthy).
- **Update the API**: push to `main`, wait for the GitHub Actions run, then on the box
  `docker compose pull api && docker compose up -d api` — full procedure in
  [Updating the API](#updating-the-api-github-actions-builds-the-box-only-pulls) below.
  Nothing is compiled on the box. **`git pull` on
  the box does not update the API**: the Dockerfile compiles the source *into* the image and
  the container mounts no source, so pulling commits there changes nothing that runs — the
  same trap as n8n workflows. And **`docker compose restart api` never picks up a new
  image**; it restarts the existing container, which is pinned to the image it was created
  from. Use it only to clear wedged in-flight jobs.
- **Update the workflows**: `pnpm n8n:push` (Phase C2) — *not* `git pull`, which cannot
  touch them. Do it after the API update, never before.
- **n8n data** (workflows, credentials, encryption key) lives in the `n8n_data`
  volume — back it up; losing it means re-importing + re-entering credentials.
- **Certs** live in the `caddy_data` volume — keep it so you don't re-issue on every
  restart.
- **OpenAI cost/limits**: poster rendering is now OpenAI image-API calls inside n8n —
  watch your image quota, not container RAM.
