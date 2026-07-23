# Social publishing setup (post to X / Facebook from the detail page)

Completed `twitter`/`facebook` runs show a publish button on their detail page that
posts the poster + caption to the **official department accounts** — one X account,
one Facebook Page, configured once in the server's root `.env`. This document is the
walkthrough for obtaining those credentials (works identically for the interim dummy
accounts and the real official ones — swapping is just editing `.env` and restarting
the API).

When a platform's env values are absent, its publish button returns a Marathi
message asking for configuration; nothing else in the platform is affected.

---

## X (Twitter)

The API posts with **OAuth 1.0a user-context keys** — four values that never expire
(no token-refresh machinery). Media upload uses the v2 endpoint (`twitter-api-v2`
library); the v1.1 upload endpoint is retired.

1. Sign in at [developer.x.com](https://developer.x.com) **as the account that
   should publish** (the dummy account now; the official one later) and create a
   project + app (the free tier is fine to start — it allows roughly **500 posts
   per month**, which also covers testing).
2. In the app's **Settings → User authentication settings**, enable OAuth 1.0a and
   set **App permissions = Read and Write**. Do this **before** the next step —
   access tokens minted while the app was read-only stay read-only even after the
   permission change (regenerate them if you got the order wrong).
3. In **Keys and tokens**, collect all four values:
   - **API Key** and **API Key Secret** → `TWITTER_API_KEY`, `TWITTER_API_SECRET`
   - **Access Token** and **Access Token Secret** (under "Authentication Tokens",
     for your own account) → `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`
4. Put the four values in the root `.env` and restart the API.

Notes:

- Captions longer than X's 280-char weighted limit are **rejected** with a Marathi
  error (never auto-truncated) — shorten the caption via feedback and retry.
- X rejects posting the exact same text twice in a row (duplicate rule); the error
  is surfaced as-is in the UI.

## Facebook (Page)

The API posts a photo to a **Page** via the Graph API (`POST /{page_id}/photos`,
passing the poster's public URL — Meta fetches the image itself). Personal profiles
**cannot** be posted to via API — the dummy account must create a dummy **Page**.

1. On the (dummy/official) Facebook account, create a Page if none exists
   (facebook.com → Pages → Create).
2. At [developers.facebook.com](https://developers.facebook.com), create an app
   (type Business). **Dev mode is sufficient** — no app review needed — as long as
   the person generating the token has a role on the app (they do, as its creator)
   and admin on the Page.
3. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer),
   select your app, and generate a **User access token** with permissions:
   `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`.
4. Exchange it for a **long-lived user token** (Explorer's ⓘ → "Open in Access
   Token Tool" → Extend, or the
   `GET /oauth/access_token?grant_type=fb_exchange_token&...` call).
5. With the long-lived user token, call `GET /me/accounts`. The response lists your
   Pages with an `access_token` each — that **Page token is non-expiring** (because
   it was derived from a long-lived user token) and an `id`.
6. Put them in the root `.env`:
   - Page `id` → `FACEBOOK_PAGE_ID`
   - Page `access_token` (from step 5 — **not** the token from step 3/4, see the
     warning below) → `FACEBOOK_PAGE_ACCESS_TOKEN`
   - (optional) `FACEBOOK_GRAPH_API_VERSION` — defaults to `v23.0`
7. Restart the API.

### ⚠️ Paste the **Page** token, not the User token

This is the easiest mistake to make and the hardest to spot: the User token from
step 3/4 is the one sitting in the Graph API Explorer box, it starts with the same
`EAA…` prefix as the Page token, and it carries all the right-sounding permissions
(`pages_manage_posts` &c.). It nonetheless **cannot publish**. Meta requires a Page
token on a Page's `/photos` edge; `pages_manage_posts` on the _user_ token only
entitles you to fetch the Page token in step 5.

Nothing rejects it at startup — the run fails only at publish time, with a message
naming a permission that was retired in 2018 and cannot be granted:

```
(#200) The permission(s) publish_actions are not available. It has been deprecated.
```

**Verify before you trust it.** Against the value you actually put in `.env`:

```bash
curl -s "https://graph.facebook.com/debug_token?input_token=$TOKEN&access_token=$TOKEN"
```

- `"type": "PAGE"` — correct. (`"USER"` is exactly the bug above.)
- `"expires_at": 0` — never expires, as a Page token should.
- `"profile_id"` — must equal your `FACEBOOK_PAGE_ID`.

`GET /me` with the token is the same check in one line: it must return the **Page's**
name, not a person's.

You can also sanity-check a token anytime in the
[Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/)
— "Expires: Never" is what you want on the Page token.

## Swapping dummy → official accounts

Repeat the same flows signed in as the official accounts, replace the values in the
production `.env`, and restart the API container. Nothing else changes — no
migration, no redeploy of web or n8n. Already-stored `published_url` links on old
runs keep pointing at wherever they were posted.

Re-run the `debug_token` check above on the new Facebook value before calling the
swap done — this is the step where the User-vs-Page token mistake is most likely to
recur, and it would surface as a failed publish on a real official account.

## Behaviour reference

- Endpoint: synchronous `POST /api/generations/:id/publish` (platform = the run's
  own category; article runs are rejected).
- The latest live post's URL is stored on the row (`published_url`/`published_at`,
  migration 0021) and shown on the detail page across reloads. Re-publishing (e.g.
  after a poster feedback round) overwrites it.
- Double-clicks can't double-post (in-process in-flight guard), and publishing is
  blocked while a job (e.g. a poster re-render) is running on the row.
