// Which article provider a REQUEST writes on, decided from the browser origin it came from.
//
// One API serves production and staging. Production keeps ARTICLE_PROVIDER (the deployment
// default); staging's articles are written on the self-hosted gemma endpoint. So the API
// reads the request's Origin, maps it through ARTICLE_PROVIDER_BY_ORIGIN, and the create
// routes STORE the answer on the row (migration 0062). Everything after create — the /dlo
// names and generate routes, the generation job, a retry — reads the row, never the request,
// which is what keeps a run on the provider it started with.
//
// ARTICLE_PROVIDER_BY_ORIGIN is a comma-separated list of `origin=provider`:
//
//   ARTICLE_PROVIDER_BY_ORIGIN=https://staging.hashcase.tech=gemma
//
// An origin may be a `*` pattern with exactly the CORS_ORIGIN rules (cors-origins.ts), so a
// Vercel branch alias can be mapped too. The provider is split off the LAST `=`; an origin
// cannot contain one. An unknown provider in an entry is ignored with a warning rather than
// failing every request.
//
// The provider is decided by the SERVER from the Origin header, never by a field the browser
// sends. Origin is set by the browser and cannot be changed from page code; a non-browser
// client could forge it, which would only move its own run onto another configured provider.
// It is NOT authorization and grants nothing.

import type { FastifyRequest } from 'fastify';
import {
  parseArticleProvider,
  type ArticleProvider,
} from '@dgipr/content-engine';
import { matchesOriginPattern } from './cors-origins.js';

type OriginRule = Readonly<{ origin: string; provider: ArticleProvider }>;

let cachedRaw: string | undefined;
let cachedRules: readonly OriginRule[] = [];

function rules(): readonly OriginRule[] {
  const raw = process.env.ARTICLE_PROVIDER_BY_ORIGIN ?? '';
  if (raw === cachedRaw) return cachedRules;
  const parsed: OriginRule[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const at = trimmed.lastIndexOf('=');
    const origin = at > 0 ? trimmed.slice(0, at).trim() : '';
    const provider = parseArticleProvider(at > 0 ? trimmed.slice(at + 1) : '');
    if (!origin || !provider) {
      console.warn(
        `[article-provider] ignoring ARTICLE_PROVIDER_BY_ORIGIN entry "${trimmed}" ` +
          '(expected origin=openai|qwen|gemma).',
      );
      continue;
    }
    parsed.push({ origin, provider });
  }
  cachedRaw = raw;
  cachedRules = parsed;
  return parsed;
}

/** The provider an origin maps to, or null for "the deployment default". */
export function articleProviderForOrigin(
  origin: string | undefined,
): ArticleProvider | null {
  if (!origin) return null;
  for (const rule of rules()) {
    const hit = rule.origin.includes('*')
      ? matchesOriginPattern(rule.origin, origin)
      : rule.origin === origin;
    if (hit) return rule.provider;
  }
  return null;
}

/** The provider to STORE on a row created by this request; null = deployment default. */
export function articleProviderForRequest(
  request: FastifyRequest,
): ArticleProvider | null {
  const origin = request.headers.origin;
  return articleProviderForOrigin(
    typeof origin === 'string' ? origin : undefined,
  );
}

// Free harness: `npx tsx apps/api/src/article-provider-origin.ts` (from content-engine,
// which has tsx: `npx tsx ../../apps/api/src/article-provider-origin.ts`).
if (process.argv[1]?.endsWith('article-provider-origin.ts')) {
  const saved = process.env.ARTICLE_PROVIDER_BY_ORIGIN;
  let failed = 0;
  const check = (name: string, got: unknown, want: unknown) => {
    const ok = got === want;
    if (!ok) failed += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} → ${String(got)}`);
  };

  delete process.env.ARTICLE_PROVIDER_BY_ORIGIN;
  check(
    'unset → default',
    articleProviderForOrigin('https://staging.hashcase.tech'),
    null,
  );

  process.env.ARTICLE_PROVIDER_BY_ORIGIN =
    ' https://staging.hashcase.tech = Gemma , https://web-git-staging-*.vercel.app=gemma,junk,https://x.example=nope';
  check(
    'exact staging',
    articleProviderForOrigin('https://staging.hashcase.tech'),
    'gemma',
  );
  check(
    'prod untouched',
    articleProviderForOrigin('https://newsroom.indicex.xyz'),
    null,
  );
  check(
    'trailing slash is a different origin',
    articleProviderForOrigin('https://staging.hashcase.tech/'),
    null,
  );
  check(
    'http is not https',
    articleProviderForOrigin('http://staging.hashcase.tech'),
    null,
  );
  check(
    'vercel pattern',
    articleProviderForOrigin('https://web-git-staging-hashcase.vercel.app'),
    'gemma',
  );
  check(
    'pattern stays one label',
    articleProviderForOrigin('https://web-git-staging-a.b.vercel.app'),
    null,
  );
  check(
    'unknown provider ignored',
    articleProviderForOrigin('https://x.example'),
    null,
  );
  check('no origin', articleProviderForOrigin(undefined), null);

  if (saved === undefined) delete process.env.ARTICLE_PROVIDER_BY_ORIGIN;
  else process.env.ARTICLE_PROVIDER_BY_ORIGIN = saved;
  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} FAILED`);
  if (failed > 0) process.exitCode = 1;
}
