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
   Set `CORS_ORIGIN` in `.env.prod` to `https://newsroom.indicex.xyz` (you can add
   the `https://<app>.vercel.app` URL too until the custom domain is live in Phase D).
   Then edit `Caddyfile` if your ACME email should differ from the default.
7. **Launch**:
   ```bash
   docker compose up -d --build      # builds the monorepo image (lean, no Chromium)
   docker compose logs -f api        # watch for "server listening" + no errors
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
3. **OpenAI credential**: create a Header Auth credential named exactly `OpenAI Bearer
   (DGIPR)` (Name `Authorization`, Value `Bearer sk-…`) and bind it on every HTTP node
   that calls OpenAI. The name must match — `pnpm n8n:push` re-binds by name on every
   later push.
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

It matches workflows **by name**, rewrites the export's credential ids to this instance's
(matched by credential name), preserves the Webhook node's Header Auth, and refuses to
guess if a name is missing or duplicated. It is idempotent — re-run it freely.

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
   `https://newsroom.indicex.xyz` (add the `https://<app>.vercel.app` URL too if you
   want the raw Vercel URL to work), then `docker compose up -d` again to pick it up.

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

## Operations notes

- **Logs**: `docker compose logs -f api` / `... n8n`.
- **Update the API**: `git pull && docker compose up -d --build`.
- **Update the workflows**: `pnpm n8n:push` (Phase C2) — *not* `git pull`, which cannot
  touch them. Do it after the API update, never before.
- **n8n data** (workflows, credentials, encryption key) lives in the `n8n_data`
  volume — back it up; losing it means re-importing + re-entering credentials.
- **Certs** live in the `caddy_data` volume — keep it so you don't re-issue on every
  restart.
- **OpenAI cost/limits**: poster rendering is now OpenAI image-API calls inside n8n —
  watch your image quota, not container RAM.
