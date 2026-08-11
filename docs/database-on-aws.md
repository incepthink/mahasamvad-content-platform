# The database on AWS

The database moved off Supabase on **2026-08-09** (the free-tier project was over quota and
due to be restricted). It is now **our own PostgreSQL on RDS, behind our own PostgREST**.

**No application code changed.** `packages/database` still uses `@supabase/supabase-js`, and
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` keep their names — they simply point at our
instance now, with a JWT we sign ourselves. supabase-js speaks PostgREST's wire protocol and
PostgREST is the same software Supabase runs, so all 56 queries behave identically.

The rationale, the traps hit on the way, and the verification are in the 2026-08-09 milestone
in [AGENTS.md](../AGENTS.md). This file is the operational half.

---

## What runs where

| Piece | Where | Public? |
|---|---|---|
| PostgreSQL 17.10 | RDS `dgipr-postgres`, us-east-2a, `db.t4g.small`, 20 GB gp3, encrypted | **No** — no public IP |
| PostgREST | `deploy-postgrest-1` on the EC2 box | **No** — compose network only |
| Path-strip proxy | `deploy-pgrst-proxy-1` (`deploy/pgrst-proxy.Caddyfile`) | **No** — compose network only |
| The API | `deploy-api-1`, reaches the proxy as `http://pgrst-proxy:8000` | via Caddy, as before |

```
api ──► pgrst-proxy:8000 ──strips /rest/v1──► postgrest:3000 ──► RDS:5432
```

Three roles exist on the database, mirroring Supabase's own arrangement:

- **`authenticator`** — the LOGIN role PostgREST connects as. `NOINHERIT`, holds nothing.
- **`service_role`** — the role named in our JWT. **`BYPASSRLS`.**
- **`anon`** — `PGRST_DB_ANON_ROLE`, granted nothing.

> **Do not remove `BYPASSRLS` from `service_role`.** Every table has RLS enabled with **zero
> policies** (migration 0002), so without it every query returns **zero rows and no error**.
> That is a silent failure, not a crash. `postgrest-roles.sql` re-asserts it on every run.

## Why the `/rest/v1` proxy exists

supabase-js hardcodes a `/rest/v1` prefix onto every request and offers no way to change it;
PostgREST serves at the root. Caddy's `handle_path` strips it.

It is a **separate container on purpose**. The public `deploy/Caddyfile` terminates TLS for
`api.indicex.xyz` and `n8n.indicex.xyz` — a syntax error in that file takes the site down.
Never move this route into it.

## Connecting from your laptop

RDS has no public IP and PostgREST is internal-only, so **the whole local app** — not just
scripts like `embed:news` and `retrieve:test` — needs a tunnel through the EC2 box. This is
the one workflow the migration made harder.

```bash
pnpm db:tunnel      # leave running in its own terminal, then `pnpm dev`
```

`scripts/db-tunnel.sh` needs only a logged-in `aws` CLI (no pem — EC2 Instance Connect pushes
a throwaway key). The local `.env` is already pointed at it:

```
SUPABASE_URL=http://localhost:8000
SUPABASE_SERVICE_ROLE_KEY=<PGRST_SERVICE_JWT from .env>
```

> **This is the production database.** There is no separate dev copy, so anything local dev
> writes — a generation, a chat, a deletion — is a production write.

**`-L 8000:pgrst-proxy:8000` does not work**, despite being the obvious command. `pgrst-proxy`
is a compose-network alias, resolvable only from inside another container on that network;
from the EC2 host it fails with `Temporary failure in name resolution`. The forward is still
accepted, so the symptom is a tunnel that connects and then drops every request. The host can
route to the container's IP directly, so the script looks that IP up per run rather than
hardcoding it — it changes whenever the container is recreated.

If you have the `general-instance` key pair, the equivalent by hand is:

```bash
IP=$(ssh -i <key>.pem ubuntu@3.149.1.222 \
  "sudo docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' deploy-pgrst-proxy-1")
ssh -i <key>.pem -L 8000:$IP:8000 \
  -L 5432:dgipr-postgres.cba8c0aw8j13.us-east-2.rds.amazonaws.com:5432 ubuntu@3.149.1.222
```

Symptom cheat-sheet when local dev misbehaves:

| What you see | What it means |
|---|---|
| `fetch failed` on every query | tunnel is down — run `pnpm db:tunnel` |
| `Could not find the table 'public.x' in the schema cache` | `.env` points at the retired Supabase project, or a migration has not been applied to RDS |
| `bind [127.0.0.1]:8000: Address already in use` | an older tunnel is still holding the port |

For raw `psql`, tunnel 5432 and connect as `postgres` with `RDS_MASTER_PASSWORD`.

## Uploading to S3 from your laptop — set `S3_USE_ACCELERATE=true`

Storage moved to S3 in the same week, and it has its own local-development trap. A single
TCP connection from India to `us-east-2` is **loss-limited to ~26 KiB/s**, so a 6.4 MB poster
takes ~200 s and intermittently dies with `read ECONNRESET` — which fails the job **after the
image model has been billed**, throwing away a paid render.

It is not bandwidth and it is not the app. Measured 2026-08-10 from the dev laptop:

| | |
|---|---|
| Upload 1 MiB → Cloudflare | 0.12 s (~8 MB/s) |
| Upload 1 MiB → S3 us-east-2 | 39 s (26 KiB/s) |
| Upload 5 MiB → S3 us-east-2 | 198 s (26 KiB/s) |
| 5 × 1 MiB in parallel → S3 | 38 s (135 KiB/s — scales ~linearly) |
| RTT to us-east-2 | 230 ms, 0% ICMP loss |

The near-linear parallel scaling is the tell: it is per-connection loss on the long haul, not
a throughput cap. All three buckets therefore have **Transfer Acceleration `Status=Enabled`**,
which only ADDS the `s3-accelerate` endpoint and leaves the normal one untouched. Which
endpoint a process uses is a per-machine choice:

```
S3_USE_ACCELERATE=true      # local .env ONLY
```

Same 6.4 MB poster over the accelerate endpoint: **2.3 s**.

> **Never set it on the EC2 box.** The API runs in `us-east-2` beside the buckets, so
> accelerating buys nothing and costs $0.04/GB. It is off unless the env var is exactly
> `true`, so production is unaffected by default.

Reads are unaffected either way — `publicUrl` serves posters and videos through CloudFront,
not through S3.

`getS3Client` also sets a 6 s connection timeout and a 60 s **idle** timeout (both default to
0 = wait forever, which is why a stalled upload hung for minutes before failing). The idle
timeout is on socket inactivity, not total duration, so a large video that keeps making
progress is never cut off.

Multipart upload was considered and **not** added: S3 requires every part but the last to be
≥ 5 MiB, so a ~6 MB poster is one part and gains nothing, and acceleration already covers the
video case.

## Rollback

Valid only while the Supabase project still exists.

```bash
cd /home/ubuntu/mahasamvad-content-platform/deploy
sudo cp .env.prod.bak-presupabase-migration .env.prod
sudo docker compose up -d api
```

## Rotating the service key

```bash
# 1. new secret
openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c 48
# 2. re-mint the JWT with it (see the minter in the migration session, or any HS256 signer
#    producing {"role":"service_role","iss":"dgipr","iat":...,"exp":...})
# 3. set PGRST_JWT_SECRET and SUPABASE_SERVICE_ROLE_KEY in deploy/.env.prod
# 4. sudo docker compose up -d postgrest api
```

Rotating the database password is `aws rds modify-db-instance --master-user-password`, then
`PGRST_DB_URI` — but note that URI holds the **`authenticator`** password, not the master's;
change that one with `alter role authenticator with password '...'`.

## Adding a migration

Migrations are no longer applied through the Supabase SQL editor. Tunnel in and:

```bash
psql "postgresql://postgres:<RDS_MASTER_PASSWORD>@localhost:5432/dgipr" -f supabase/migrations/00NN_x.sql
```

New tables are covered automatically — `alter default privileges` was set for `service_role`.
After DDL, PostgREST needs its schema cache refreshed: `docker compose restart postgrest`
(or `NOTIFY pgrst, 'reload schema'`).

---

## Security checklist

### Done during the migration

- RDS created **not publicly accessible**, SG `sg-0bf2ce65bf33adb0a` allows 5432 from the
  EC2's SG only. (The VPC has no private subnets — all three are public — so it is the
  *publicly-accessible flag*, not the subnet, doing the work here.)
- Storage encrypted at rest; 7-day automated backups; **deletion protection enabled**;
  manual snapshot `dgipr-postgres-post-migration-20260809`.
- PostgREST and the proxy are **never published** — no host port, no Caddy route.
- `authenticator` is `NOINHERIT` and privilege-free until a validated JWT triggers `SET ROLE`.
- The 195 MB plaintext dump and the bootstrap SQL were **deleted from the EC2 box** after the
  restore.
- Secrets live in gitignored `.env` / `.env.prod` only.

### Do next — in priority order

1. **Narrow SSH.** `sg-0358381af160ba99e` allows port 22 from `0.0.0.0/0`. This predates the
   migration and is the largest standing exposure, because that box holds `.env.prod` — every
   API key plus the database credentials.
   ```bash
   aws ec2 revoke-security-group-ingress --region us-east-2 --group-id sg-0358381af160ba99e \
     --protocol tcp --port 22 --cidr 0.0.0.0/0
   aws ec2 authorize-security-group-ingress --region us-east-2 --group-id sg-0358381af160ba99e \
     --protocol tcp --port 22 --cidr <your.ip>/32
   ```
   Keep EC2 Instance Connect working by allowing the service range for your region instead of
   a personal IP (`EC2_INSTANCE_CONNECT` in `ip-ranges.json`), or attach an SSM instance
   profile and drop public SSH entirely — SSM is the better end state, since it needs no
   inbound port at all.
2. **Rotate the Supabase database password**, or delete the project once you are confident in
   the migration. It was shared in plaintext during this work and is weak by modern standards.
   Nothing in the app uses it (the app never spoke the Postgres protocol to Supabase), so
   rotating it breaks nothing.
3. **Enforce TLS to the database.** Add `?sslmode=require` to `PGRST_DB_URI`, and set the
   `rds.force_ssl` parameter to `1` in a custom parameter group so an unencrypted connection
   is refused rather than merely unused.
4. **Rotate the AWS access keys** for `claude-provisioning` if that IAM user's key was used
   anywhere transient, and scope its policy down — provisioning rights are broader than the
   running app needs. The app itself only needs S3.
5. **Take the local dump off your Desktop** once you trust the migration
   (`C:\Users\shaik\Desktop\dev-work\dgipr-db-backup\`) — it is a full plaintext copy of the
   database, including every article and transcript. Keep it encrypted or delete it; the RDS
   snapshot is the durable restore point now.

### Ongoing

- The service JWT carries `BYPASSRLS` and a 10-year expiry. That is acceptable *only* because
  PostgREST is unreachable from outside the compose network. **If PostgREST is ever exposed
  publicly, this token becomes a full-database credential** — at that point it needs a short
  expiry, a narrower role, and rate limiting in front.
- Watch the RDS free-storage and CPU-credit metrics for the first weeks; `db.t4g.small` is
  burstable, and the HNSW index wants to stay in RAM.
- Restore-test the snapshot once. A backup nobody has restored is a hypothesis.
