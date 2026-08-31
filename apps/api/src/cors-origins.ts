// Which browser origins the API answers, in ONE place.
//
// There are two readers and they must never disagree: @fastify/cors in index.ts, and the
// hand-written header in routes/chat.ts, which has to set its own because writing to
// `reply.raw` bypasses Fastify's reply pipeline. A second copy of this list is how a chat
// stream ends up rejected by the browser on a surface where every other route works.
//
// CORS_ORIGIN is a comma-separated list. An entry is either an exact origin
// (`https://newsroom.indicex.xyz`) or a PATTERN containing `*`
// (`https://mahasamvad-content-platform-web-*.vercel.app`), which exists for Vercel: a
// deployment there gets a fresh hostname per push and the branch alias
// (`...-git-staging-hashcase.vercel.app`) is only stable per branch, so pinning exact
// preview URLs means editing the server's env every time a branch is created — and the
// symptom is a preview site whose every request fails in the browser while the API is
// answering perfectly.
//
// A `*` stands for ONE hostname label: it matches any run of characters containing
// neither `.` nor `/`, so a pattern cannot widen past the domain it was written against.
// `https://*.vercel.app` allows `https://foo.vercel.app` and rejects both
// `https://foo.bar.vercel.app` and `https://vercel.app.evil.example`. The whole origin is
// matched, so the scheme is always part of the rule and `http://` never satisfies an
// `https://` entry.
//
// Matching is done with string operations rather than a generated RegExp on purpose: an
// entry is operator-supplied text, and turning it into a pattern means escaping every
// regex metacharacter correctly or silently accepting more than the operator wrote.

const DEFAULT_ORIGINS = 'http://localhost:3000,http://127.0.0.1:3000';

function entries(): string[] {
  return (process.env.CORS_ORIGIN ?? DEFAULT_ORIGINS)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function wildcardSegmentIsLabel(segment: string): boolean {
  return !segment.includes('.') && !segment.includes('/');
}

function matchesPattern(pattern: string, origin: string): boolean {
  const parts = pattern.split('*');
  if (!origin.startsWith(parts[0]!)) return false;
  let at = parts[0]!.length;

  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i]!;
    const isLast = i === parts.length - 1;

    // A trailing `*` consumes whatever is left, which must still be a single label.
    if (isLast && part === '') {
      return wildcardSegmentIsLabel(origin.slice(at));
    }

    const found = isLast
      ? origin.length - part.length
      : origin.indexOf(part, at);
    if (found < at) return false;
    if (isLast && !origin.endsWith(part)) return false;
    if (!wildcardSegmentIsLabel(origin.slice(at, found))) return false;
    at = found + part.length;
  }

  return at === origin.length;
}

export function isAllowedOrigin(origin: string): boolean {
  return entries().some((entry) =>
    entry.includes('*') ? matchesPattern(entry, origin) : entry === origin,
  );
}

// Free harness: `npx tsx apps/api/src/cors-origins.ts`
if (process.argv[1]?.endsWith('cors-origins.ts')) {
  const cases: Array<[string | undefined, string, boolean]> = [
    // The default list, unchanged by this file.
    [undefined, 'http://localhost:3000', true],
    [undefined, 'http://127.0.0.1:3000', true],
    [undefined, 'https://newsroom.indicex.xyz', false],
    // Exact entries, whitespace around a comma tolerated.
    ['https://a.example, https://b.example', 'https://b.example', true],
    ['https://a.example', 'https://a.example:443', false],
    // The Vercel case this exists for.
    [
      'https://newsroom.indicex.xyz,https://mahasamvad-content-platform-web-*.vercel.app',
      'https://mahasamvad-content-platform-web-git-staging-hashcase.vercel.app',
      true,
    ],
    [
      'https://mahasamvad-content-platform-web-*.vercel.app',
      'https://mahasamvad-content-platform-web-abc123-hashcase.vercel.app',
      true,
    ],
    [
      'https://newsroom.indicex.xyz,https://mahasamvad-content-platform-web-*.vercel.app',
      'https://newsroom.indicex.xyz',
      true,
    ],
    // A second front end on its own domain. Nothing about it is Vercel-shaped, so it is
    // an EXACT entry added to the live CORS_ORIGIN - a wildcard would only widen the
    // rule past the one hostname the operator actually meant.
    [
      'https://newsroom.indicex.xyz,https://staging.hashcase.tech',
      'https://staging.hashcase.tech',
      true,
    ],
    [
      'https://newsroom.indicex.xyz,https://staging.hashcase.tech',
      'https://staging.hashcase.tech.evil.example',
      false,
    ],
    ['https://staging.hashcase.tech', 'http://staging.hashcase.tech', false],
    ['https://staging.hashcase.tech', 'https://hashcase.tech', false],
    // A wildcard is one label, so it cannot widen past its own domain.
    ['https://*.vercel.app', 'https://foo.vercel.app', true],
    ['https://*.vercel.app', 'https://foo.bar.vercel.app', false],
    ['https://*.vercel.app', 'https://vercel.app.evil.example', false],
    ['https://*.vercel.app', 'https://foo.vercel.app.evil.example', false],
    ['https://*.vercel.app', 'http://foo.vercel.app', false],
    ['https://*.vercel.app', 'https://.vercel.app', true],
    // Regex metacharacters in an entry are literal text.
    ['https://a+b-*.example', 'https://aab-x.example', false],
    ['https://a+b-*.example', 'https://a+b-x.example', true],
    // A pattern in the middle of a label.
    [
      'https://web-*-hashcase.vercel.app',
      'https://web-abc-hashcase.vercel.app',
      true,
    ],
    [
      'https://web-*-hashcase.vercel.app',
      'https://web-abc-other.vercel.app',
      false,
    ],
  ];
  let failed = 0;
  for (const [env, origin, expected] of cases) {
    if (env === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = env;
    const got = isAllowedOrigin(origin);
    if (got !== expected) {
      failed += 1;
      console.error(
        `FAIL CORS_ORIGIN=${env ?? '(unset)'} origin=${origin} -> ${got}, expected ${expected}`,
      );
    }
  }
  console.log(
    failed === 0
      ? `cors-origins: ${cases.length}/${cases.length} checks passed`
      : `cors-origins: ${failed} of ${cases.length} FAILED`,
  );
  process.exit(failed === 0 ? 0 : 1);
}
