# Moving object storage from Supabase to AWS S3 + CloudFront

_2026-08-09. The database stays on Supabase; only the files moved._

The code side is done. This is the AWS provisioning and the cutover order.

## Why this was a one-file change

Every storage operation in the repo goes through the eight helpers in
`packages/database/src/storage.ts`. Their bodies now call S3; **their signatures
are unchanged**, including the leading `client` argument that S3 does not use.
So the ~30 call sites in `runner.ts`, `video-runner.ts`, `routes/generations.ts`,
`routes/video.ts` and `references/*` were not touched.

**No migration file, no row rewrites.** The database stores object _paths_
(`generations/{id}/poster-v3.png`), never URLs — the URL is built at read time
by `publicUrl`. An S3 key is byte-identical to what the row already held.

`publicUrl`/`publicUrlIn` stay **synchronous**, which is why the public objects
are served through CloudFront rather than presigned URLs. Presigned URLs are
async (they would ripple through ~20 inline call sites) and they expire, which
would break n8n's fetch of the reference masters mid-workflow.

## 1. Create three S3 buckets

Region **us-east-2 (Ohio)** — must match the EC2 box running the API, because
same-region S3 → EC2 transfer is free. That is what eliminates the ~9.6 GB of
server-side egress (the video restitch re-downloading every clip, the CMO photo
re-composite, the poster download proxy).

| Bucket              | Holds                                              | Access                      |
| ------------------- | -------------------------------------------------- | --------------------------- |
| `dgipr-posters`     | posters, scenes, feedback marks, reference library | private, CloudFront via OAC |
| `dgipr-videos`      | stills, clips, MP4s, SRTs, narration WAVs          | private, CloudFront via OAC |
| `dgipr-dlo-uploads` | recordings, source PDFs/DOCX                       | private, never public       |

Names are globally unique across all of AWS, so pick your own if these are
taken — they are only read from `S3_BUCKET_*` env vars.

**Leave "Block all public access" ON for all three.** CloudFront reads the two
public-facing buckets through an Origin Access Control, so the buckets
themselves never need to be public. That is both safer and the AWS-recommended
setup.

## 2. Two CloudFront distributions

One per public bucket (`dgipr-posters`, `dgipr-videos`). CloudFront bills on
traffic, not per distribution, so two costs nothing extra and keeps the mapping
one-to-one with no path rewriting.

For each:

- **Origin**: the S3 bucket. Choose **Origin access control**, create an OAC,
  and let the console apply the generated bucket policy for you.
- **Viewer protocol policy**: Redirect HTTP to HTTPS.
- **Allowed methods**: GET, HEAD.
- **Cache policy**: `CachingOptimized`. Safe because storage paths are versioned
  per render and never reused — the reason that rule exists.

Note the two `d….cloudfront.net` domains. A custom domain on `indicex.xyz` can
be added later without a code change.

> Why CloudFront matters more with Ohio: your users are in Maharashtra. Without
> it, every ~5 MB poster and every multi-MB video clip crosses the planet from
> us-east-2 on each request.

## 3. An IAM user for the API

Create a user with programmatic access and this least-privilege policy (swap in
your bucket names):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::dgipr-posters/*",
        "arn:aws:s3:::dgipr-videos/*",
        "arn:aws:s3:::dgipr-dlo-uploads/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": [
        "arn:aws:s3:::dgipr-posters",
        "arn:aws:s3:::dgipr-videos",
        "arn:aws:s3:::dgipr-dlo-uploads"
      ]
    }
  ]
}
```

`ListBucket` is needed by the migration script's existence checks; `DeleteObject`
by `removeObjects` when a reference master or custom type is deleted.

## 4. Fill in `.env`

> **This file is tracked by git — never paste real credentials into it.** Only
> `.env*` is gitignored. Keys belong in `.env` on each machine and nowhere else.

```bash
AWS_REGION=us-east-2
AWS_ACCESS_KEY_ID=<from the dgipr-api IAM user>
AWS_SECRET_ACCESS_KEY=<from the dgipr-api IAM user>

S3_BUCKET_POSTERS=dgipr-posters
S3_BUCKET_VIDEOS=dgipr-videos
S3_BUCKET_DLO_UPLOADS=dgipr-dlo-uploads

CLOUDFRONT_POSTERS_URL=https://d1nr4shsuejhcs.cloudfront.net
CLOUDFRONT_VIDEOS_URL=https://d10xqbwc7l68wy.cloudfront.net
```

Keep the `SUPABASE_*` vars — the database still uses them, and the migration
script reads the old buckets through them.

If the `CLOUDFRONT_*` vars are unset the code falls back to the direct S3 URL,
which is a bring-up convenience only. With buckets private (as above) that
fallback will 403, which is intended — set the CloudFront vars.

## 5. Copy the files across

```bash
pnpm --filter @dgipr/database storage:migrate -- --dry-run   # lists, writes nothing
pnpm --filter @dgipr/database storage:migrate                # ~2 GB, takes a while
pnpm --filter @dgipr/database storage:migrate -- --bucket=videos   # one bucket
```

It is **idempotent** — every object is HEADed in S3 first and skipped if
present, so an interrupted run is resumed by re-running it. A single unreadable
object is reported and skipped rather than sinking the whole run.

It **never deletes anything from Supabase.**

## 6. Cutover

1. Run the migration to completion.
2. Rebuild and restart: `pnpm --filter @dgipr/database build`, then the API.
3. Verify, in this order:
   - an old poster still loads in `/generations` (proves the copy + CloudFront)
   - a **new** social poster renders end to end (proves upload + the n8n fetch of
     the reference master over the new URL)
   - a `/dlo` upload and its OCR re-read (proves the private bucket)
   - a video project page plays a stored clip (proves the videos distribution)
4. Only then empty the Supabase buckets. **This is the step that fixes the
   Storage Size quota**, and it is the only one of the three breached metrics
   that responds immediately — the two egress counters are cumulative for the
   billing cycle and reset on 15 Aug.

## Notes for later

- **The `poster.png` download proxy can be deleted.** It exists because a
  cross-origin `download` attribute is ignored, so the API pulls the whole PNG
  and re-streams it. S3 presigned URLs accept `response-content-disposition`,
  which forces the download natively — that would remove a route and halve the
  bytes per download. Left alone here to keep this change to one file.
- **The `client` first argument on every storage helper is now dead.** Removing
  it is a mechanical, separate commit.
- If server-side transfers still show as billed egress, the EC2 box is not in
  us-east-2 — check that before anything else.
