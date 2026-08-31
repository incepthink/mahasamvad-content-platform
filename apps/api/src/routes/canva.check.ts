// Offline check of the multi-account Canva registry and the account-prefixed OAuth state.
// No network, no database, no Canva: every assertion is decided before the route reaches
// getGeneration (which a deliberately exploding stub client marks).
//
// Run from apps/api:  npx tsx ../../apps/api/src/routes/canva.check.ts
import Fastify from 'fastify';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { registerCanvaRoutes } from './canva.js';

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.log('  ok   ' + name);
  } else {
    failed += 1;
    console.log('  FAIL ' + name, detail === undefined ? '' : detail);
  }
}

// Mirrors sealState() so the callback can be driven with a state this test minted.
function seal(payload: unknown, key: string, secret: string): string {
  const material = createHash('sha256')
    .update(`mahasamvad-canva-oauth:${secret}`)
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', material, iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return `${key}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')}`;
}

const REACHED_DB = 'REACHED_DB';
const client = {
  from() {
    throw new Error(REACHED_DB);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const app = Fastify();
registerCanvaRoutes(app, client);

function clearEnv(): void {
  delete process.env.CANVA_ACCOUNTS;
  delete process.env.CANVA_CLIENT_ID;
  delete process.env.CANVA_CLIENT_SECRET;
  delete process.env.CANVA_REDIRECT_URI;
  delete process.env.CANVA_ACCOUNT_LABEL;
}

const TWO = JSON.stringify([
  { key: 'dgipr', label: 'DGIPR', clientId: 'id-a', clientSecret: 'sec-a' },
  { key: 'cmo', label: 'CMO', clientId: 'id-b', clientSecret: 'sec-b' },
]);

type AccountsBody = { accounts: { key: string; label: string }[] };

async function accounts(): Promise<{ status: number; body: AccountsBody }> {
  const res = await app.inject({ method: 'GET', url: '/canva/accounts' });
  return { status: res.statusCode, body: res.json<AccountsBody>() };
}

async function main(): Promise<void> {
  console.log('registry');
  clearEnv();
  let res = await accounts();
  check(
    'unconfigured returns an empty list, not a 5xx',
    res.status === 200 && res.body.accounts.length === 0,
    res.body,
  );

  process.env.CANVA_CLIENT_ID = 'legacy-id';
  process.env.CANVA_CLIENT_SECRET = 'legacy-secret';
  process.env.CANVA_REDIRECT_URI = 'http://127.0.0.1:3001/api/canva/callback';
  res = await accounts();
  check(
    'legacy three variables still make one default account',
    res.body.accounts.length === 1 &&
      res.body.accounts[0]?.key === 'default' &&
      res.body.accounts[0]?.label === 'Canva',
    res.body,
  );

  process.env.CANVA_ACCOUNT_LABEL = 'DGIPR मुख्य';
  res = await accounts();
  check(
    'CANVA_ACCOUNT_LABEL names the single account',
    res.body.accounts[0]?.label === 'DGIPR मुख्य',
    res.body,
  );

  process.env.CANVA_ACCOUNTS = TWO;
  res = await accounts();
  check(
    'CANVA_ACCOUNTS overrides the legacy variables',
    res.body.accounts.length === 2,
    res.body,
  );
  check(
    'keys and labels only — no client id, no secret',
    JSON.stringify(res.body).indexOf('sec-') === -1 &&
      JSON.stringify(res.body).indexOf('id-a') === -1,
    res.body,
  );

  process.env.CANVA_ACCOUNTS = '{not json';
  res = await accounts();
  check(
    'malformed CANVA_ACCOUNTS degrades to an empty list here',
    res.body.accounts.length === 0,
    res.body,
  );

  process.env.CANVA_ACCOUNTS = JSON.stringify([
    { key: 'Bad.Key', label: 'x', clientId: 'a', clientSecret: 'b' },
  ]);
  res = await accounts();
  check(
    'a key containing a dot is refused',
    res.body.accounts.length === 0,
    res.body,
  );

  process.env.CANVA_ACCOUNTS = JSON.stringify([
    { key: 'dup', label: 'a', clientId: 'a', clientSecret: 'b' },
    { key: 'dup', label: 'b', clientId: 'c', clientSecret: 'd' },
  ]);
  res = await accounts();
  check('a repeated key is refused', res.body.accounts.length === 0, res.body);

  console.log('authorize redirect');
  process.env.CANVA_ACCOUNTS = TWO;
  const verifier = randomBytes(64).toString('base64url');
  const uuid = '11111111-1111-4111-8111-111111111111';

  let r = await app.inject({
    method: 'GET',
    url: `/canva/generations/${uuid}?account=nope`,
  });
  check(
    'an unknown account key is a 400 before any database read',
    r.statusCode === 400 && !r.body.includes(REACHED_DB),
    r.statusCode + ' ' + r.body.slice(0, 120),
  );

  r = await app.inject({
    method: 'GET',
    url: `/canva/generations/${uuid}?account=cmo`,
  });
  check(
    'a known account key reaches the row lookup',
    r.body.includes(REACHED_DB),
    r.body.slice(0, 160),
  );

  console.log('callback state');
  const good = seal(
    {
      account: 'cmo',
      generationId: uuid,
      codeVerifier: verifier,
      createdAt: Date.now(),
    },
    'cmo',
    'sec-b',
  );
  r = await app.inject({
    method: 'GET',
    url: `/canva/callback?code=abc&state=${encodeURIComponent(good)}`,
  });
  check(
    "the callback opens its own account's state and gets to the row lookup",
    r.body.includes(REACHED_DB),
    r.body.slice(0, 160),
  );

  const swapped = 'dgipr.' + good.slice(good.indexOf('.') + 1);
  r = await app.inject({
    method: 'GET',
    url: `/canva/callback?code=abc&state=${encodeURIComponent(swapped)}`,
  });
  check(
    'a state re-prefixed with another account is rejected',
    r.statusCode === 400 && !r.body.includes(REACHED_DB),
    r.statusCode + ' ' + r.body.slice(0, 160),
  );

  const wrongSecret = seal(
    {
      account: 'cmo',
      generationId: uuid,
      codeVerifier: verifier,
      createdAt: Date.now(),
    },
    'cmo',
    'sec-a',
  );
  r = await app.inject({
    method: 'GET',
    url: `/canva/callback?code=abc&state=${encodeURIComponent(wrongSecret)}`,
  });
  check(
    "a state sealed with the wrong account's secret is rejected",
    r.statusCode === 400,
    r.statusCode + ' ' + r.body.slice(0, 160),
  );

  const stale = seal(
    {
      account: 'cmo',
      generationId: uuid,
      codeVerifier: verifier,
      createdAt: Date.now() - 20 * 60 * 1000,
    },
    'cmo',
    'sec-b',
  );
  r = await app.inject({
    method: 'GET',
    url: `/canva/callback?code=abc&state=${encodeURIComponent(stale)}`,
  });
  check(
    'an expired state is still rejected',
    r.statusCode === 400,
    r.statusCode,
  );

  // A state minted before this change carries no prefix and must still complete.
  process.env.CANVA_ACCOUNTS = '';
  const legacyMaterial = seal(
    { generationId: uuid, codeVerifier: verifier, createdAt: Date.now() },
    'x',
    'legacy-secret',
  );
  const legacy = legacyMaterial.slice(legacyMaterial.indexOf('.') + 1);
  r = await app.inject({
    method: 'GET',
    url: `/canva/callback?code=abc&state=${encodeURIComponent(legacy)}`,
  });
  check(
    'an in-flight prefixless state from the old build still opens',
    r.body.includes(REACHED_DB),
    r.statusCode + ' ' + r.body.slice(0, 160),
  );

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
