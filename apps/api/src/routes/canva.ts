import type { FastifyInstance } from 'fastify';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { z } from 'zod';
import {
  downloadPng,
  getGeneration,
  type SupabaseClient,
} from '@dgipr/database';
import { buildCanvaSocialPosterLayers } from '@dgipr/poster-renderer';
import { isSocialCategory } from '@dgipr/schemas';
import { createLayeredSocialPosterPptx } from '../canva/layered-poster.js';

const CANVA_API = 'https://api.canva.com/rest/v1';
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const DEFAULT_ACCOUNT_KEY = 'default';
const ASSET_POLL_ATTEMPTS = 40;
const ASSET_POLL_DELAY_MS = 750;

const GenerationParamsSchema = z.object({ id: z.string().uuid() });
const StartQuerySchema = z.object({ account: z.string().min(1).optional() });
const CallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});
const TokenResponseSchema = z.object({ access_token: z.string().min(1) });
const AssetUploadResponseSchema = z.object({
  job: z.object({
    id: z.string().min(1),
    status: z.enum(['failed', 'in_progress', 'success']),
    asset: z.object({ id: z.string().min(1) }).optional(),
    error: z.object({ message: z.string().optional() }).optional(),
  }),
});
const DesignImportResponseSchema = z.object({
  job: z.object({
    id: z.string().min(1),
    status: z.enum(['failed', 'in_progress', 'success']),
    result: z
      .object({
        designs: z.array(
          z.object({ urls: z.object({ edit_url: z.string().url() }) }),
        ),
      })
      .optional(),
    error: z.object({ message: z.string().optional() }).optional(),
  }),
});
const CreateDesignResponseSchema = z.object({
  design: z.object({
    urls: z.object({ edit_url: z.string().url() }),
  }),
});

// One Canva Connect integration this deployment can hand a poster to. There may be
// several, and the reason is Canva's, not ours: an integration that has not been released
// for public use is reachable only from inside the Canva team that owns it, and everyone
// else is turned away at the authorize screen with "The client ID is invalid." So a second
// team is served by registering a SECOND integration in that team and adding its
// credentials here -- not by cloning ours, which would fail for them identically.
//
// An account is a DEPLOYMENT-level credential set, never a per-officer record. Within one
// account every officer still signs in to Canva as themselves through the ordinary OAuth
// flow and the poster lands in their own Canva account; nothing is stored per user, and no
// token is persisted at all.
type CanvaAccount = {
  key: string;
  label: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type OAuthState = {
  account: string;
  generationId: string;
  codeVerifier: string;
  createdAt: number;
};

// The key may not contain a dot: it travels as the plaintext prefix of the OAuth state,
// which is split on the first one. It names a credential set rather than holding a value,
// so it is not a secret, and the sealed half stays authenticated under that account's own
// client secret.
const AccountSchema = z.object({
  key: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9_-]{0,31}$/,
      'each key must be 1-32 lower-case letters, digits, hyphens or underscores',
    ),
  label: z.string().trim().min(1).max(60),
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  redirectUri: z.string().trim().url().optional(),
});

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

// Adding an account is an edit to CANVA_ACCOUNTS plus a restart -- no migration, no code
// change, and no web deploy either, since the picker reads the list from this API. The
// single-account variables remain the fallback, so a deployment that has never heard of
// CANVA_ACCOUNTS behaves byte-for-byte as it did before.
function canvaAccounts(): CanvaAccount[] {
  const fallbackRedirect = process.env.CANVA_REDIRECT_URI?.trim();
  const raw = process.env.CANVA_ACCOUNTS?.trim();

  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw httpError('CANVA_ACCOUNTS is not valid JSON.', 503);
    }
    const result = z.array(AccountSchema).min(1).safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      const where = issue?.path.length ? ` at ${issue.path.join('.')}` : '';
      throw httpError(
        `CANVA_ACCOUNTS is malformed${where}: ${issue?.message ?? 'unknown error'}`,
        503,
      );
    }
    const seen = new Set<string>();
    return result.data.map((account) => {
      if (seen.has(account.key)) {
        throw httpError(
          `CANVA_ACCOUNTS names the account "${account.key}" twice.`,
          503,
        );
      }
      seen.add(account.key);
      // Each integration may register the SAME callback URL in its own Canva developer
      // portal, so one shared CANVA_REDIRECT_URI normally serves them all; the per-account
      // override is for the case where one of them cannot.
      const redirectUri = account.redirectUri ?? fallbackRedirect;
      if (!redirectUri) {
        throw httpError(
          `The Canva account "${account.key}" has no redirectUri and CANVA_REDIRECT_URI is unset.`,
          503,
        );
      }
      return {
        key: account.key,
        label: account.label,
        clientId: account.clientId,
        clientSecret: account.clientSecret,
        redirectUri,
      };
    });
  }

  const clientId = process.env.CANVA_CLIENT_ID?.trim();
  const clientSecret = process.env.CANVA_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || !fallbackRedirect) {
    throw httpError(
      'Canva integration is not configured. Set CANVA_ACCOUNTS, or CANVA_CLIENT_ID, CANVA_CLIENT_SECRET and CANVA_REDIRECT_URI.',
      503,
    );
  }
  return [
    {
      key: DEFAULT_ACCOUNT_KEY,
      label: process.env.CANVA_ACCOUNT_LABEL?.trim() || 'Canva',
      clientId,
      clientSecret,
      redirectUri: fallbackRedirect,
    },
  ];
}

// An unknown key is the CLIENT's error rather than the deployment's: it arrives from the
// picker, and a tab left open across a registry change can name an account that has since
// been removed. No key at all means the first configured account, which is what keeps a
// single-account deployment's links working unchanged.
function canvaAccount(key?: string): CanvaAccount {
  const accounts = canvaAccounts();
  const [first] = accounts;
  if (!first) throw httpError('No Canva account is configured.', 503);
  if (!key) return first;
  const account = accounts.find((entry) => entry.key === key);
  if (!account) throw httpError(`Unknown Canva account "${key}".`, 400);
  return account;
}

function stateKey(clientSecret: string): Buffer {
  return createHash('sha256')
    .update(`mahasamvad-canva-oauth:${clientSecret}`)
    .digest();
}

// The PKCE verifier must stay server-side. Encrypting it into the opaque OAuth state keeps
// the flow stateless without exposing it to browser JavaScript or requiring a session store.
//
// The account key rides in FRONT of the sealed payload, in plaintext, and it has to: the
// callback receives nothing but `code` and `state`, the payload cannot be opened until the
// secret that sealed it is known, and only the issuing integration's secret can exchange
// that code. base64url never contains a dot, so the split is unambiguous.
function sealState(value: OAuthState, account: CanvaAccount): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    stateKey(account.clientSecret),
    iv,
  );
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  const sealed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    'base64url',
  );
  return `${account.key}.${sealed}`;
}

function openState(value: string): {
  state: OAuthState;
  account: CanvaAccount;
} {
  const separator = value.indexOf('.');
  // A state minted before multi-account support carries no prefix, so an authorization
  // already in flight across the deploy still completes, against the default account.
  const key = separator === -1 ? undefined : value.slice(0, separator);
  const sealed = separator === -1 ? value : value.slice(separator + 1);
  const account = canvaAccount(key);
  try {
    const bytes = Buffer.from(sealed, 'base64url');
    if (bytes.length < 29) throw new Error('OAuth state is too short.');
    const iv = bytes.subarray(0, 12);
    const tag = bytes.subarray(12, 28);
    const encrypted = bytes.subarray(28);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      stateKey(account.clientSecret),
      iv,
    );
    decipher.setAuthTag(tag);
    const parsed = JSON.parse(
      Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
        'utf8',
      ),
    ) as unknown;
    const state = z
      .object({
        account: z.string().optional(),
        generationId: z.string().uuid(),
        codeVerifier: z.string().min(43).max(128),
        createdAt: z.number().int(),
      })
      .parse(parsed);
    // Binds the plaintext prefix to the authenticated payload. A swapped prefix already
    // fails to decrypt; this makes that explicit rather than incidental.
    if (state.account && state.account !== account.key) {
      throw new Error('OAuth state names a different Canva account.');
    }
    if (
      state.createdAt > Date.now() + 60_000 ||
      Date.now() - state.createdAt > OAUTH_STATE_MAX_AGE_MS
    ) {
      throw new Error('OAuth state has expired.');
    }
    return { state: { ...state, account: account.key }, account };
  } catch {
    throw httpError(
      'The Canva authorization request is invalid or expired.',
      400,
    );
  }
}

async function canvaJson(
  url: string,
  init: RequestInit,
  operation: string,
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(30_000),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof body.message === 'string'
        ? `: ${body.message}`
        : '';
    throw httpError(`Canva ${operation} failed${detail}`, 502);
  }
  return body;
}

async function exchangeCode(
  config: CanvaAccount,
  code: string,
  codeVerifier: string,
): Promise<string> {
  const credentials = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
  ).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
    code,
    redirect_uri: config.redirectUri,
  });
  const response = await canvaJson(
    `${CANVA_API}/oauth/token`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${credentials}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    },
    'authorization',
  );
  return TokenResponseSchema.parse(response).access_token;
}

function assetIdFromJob(response: unknown): string | null {
  const { job } = AssetUploadResponseSchema.parse(response);
  if (job.status === 'failed') {
    throw httpError(
      `Canva poster upload failed${job.error?.message ? `: ${job.error.message}` : '.'}`,
      502,
    );
  }
  if (job.status === 'success') {
    if (!job.asset) {
      throw httpError('Canva poster upload completed without an asset.', 502);
    }
    return job.asset.id;
  }
  return null;
}

async function uploadPoster(
  accessToken: string,
  poster: Buffer,
  generationId: string,
): Promise<string> {
  const metadata = JSON.stringify({
    name_base64: Buffer.from(
      `Mahasamvad poster ${generationId.slice(0, 8)}`,
      'utf8',
    ).toString('base64'),
  });
  let response = await canvaJson(
    `${CANVA_API}/asset-uploads`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/octet-stream',
        'asset-upload-metadata': metadata,
      },
      body: new Uint8Array(poster),
    },
    'poster upload',
  );
  let assetId = assetIdFromJob(response);
  if (assetId) return assetId;

  const jobId = AssetUploadResponseSchema.parse(response).job.id;
  for (let attempt = 0; attempt < ASSET_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, ASSET_POLL_DELAY_MS));
    response = await canvaJson(
      `${CANVA_API}/asset-uploads/${encodeURIComponent(jobId)}`,
      { headers: { authorization: `Bearer ${accessToken}` } },
      'poster upload status check',
    );
    assetId = assetIdFromJob(response);
    if (assetId) return assetId;
  }
  throw httpError('Canva took too long to import the poster. Try again.', 504);
}

async function createDesign(
  accessToken: string,
  assetId: string,
): Promise<string> {
  const response = await canvaJson(
    `${CANVA_API}/designs`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        type: 'type_and_asset',
        asset_id: assetId,
        title: 'Mahasamvad poster',
      }),
    },
    'design creation',
  );
  return CreateDesignResponseSchema.parse(response).design.urls.edit_url;
}

function designUrlFromImportJob(response: unknown): string | null {
  const { job } = DesignImportResponseSchema.parse(response);
  if (job.status === 'failed') {
    throw httpError(
      `Canva layered poster import failed${job.error?.message ? `: ${job.error.message}` : '.'}`,
      502,
    );
  }
  if (job.status === 'success') {
    const editUrl = job.result?.designs[0]?.urls.edit_url;
    if (!editUrl) {
      throw httpError(
        'Canva layered poster import completed without a design.',
        502,
      );
    }
    return editUrl;
  }
  return null;
}

async function importLayeredPoster(
  accessToken: string,
  presentation: Buffer,
  generationId: string,
): Promise<string> {
  const title = `Mahasamvad poster ${generationId.slice(0, 8)}`;
  const metadata = JSON.stringify({
    title_base64: Buffer.from(title, 'utf8').toString('base64'),
    mime_type:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
  let response = await canvaJson(
    `${CANVA_API}/imports`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/octet-stream',
        'import-metadata': metadata,
      },
      body: new Uint8Array(presentation),
    },
    'layered poster import',
  );
  let editUrl = designUrlFromImportJob(response);
  if (editUrl) return editUrl;

  const jobId = DesignImportResponseSchema.parse(response).job.id;
  for (let attempt = 0; attempt < ASSET_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, ASSET_POLL_DELAY_MS));
    response = await canvaJson(
      `${CANVA_API}/imports/${encodeURIComponent(jobId)}`,
      { headers: { authorization: `Bearer ${accessToken}` } },
      'layered poster import status check',
    );
    editUrl = designUrlFromImportJob(response);
    if (editUrl) return editUrl;
  }
  throw httpError(
    'Canva took too long to import the layered poster. Try again.',
    504,
  );
}

export function registerCanvaRoutes(
  app: FastifyInstance,
  client: SupabaseClient,
): void {
  // What the officer's account picker is drawn from. A route rather than a NEXT_PUBLIC_*
  // build-time copy because which integrations exist is a runtime server fact, and a
  // build-time duplicate drifts the moment .env changes on the API box. Returns keys and
  // labels only -- never a client id, never a secret.
  app.get('/canva/accounts', async () => {
    try {
      return {
        accounts: canvaAccounts().map(({ key, label }) => ({ key, label })),
      };
    } catch {
      // "Not configured" is an ordinary answer here, not an error: the web then draws its
      // single plain button, whose click surfaces the real 503 and its actionable message.
      return { accounts: [] };
    }
  });

  app.get('/canva/generations/:id', async (request, reply) => {
    const { id } = GenerationParamsSchema.parse(request.params);
    const query = StartQuerySchema.parse(request.query);
    // Resolved before the row is read: the key is the client's own parameter, so a stale
    // tab naming a removed account is answered without a database round trip.
    const account = canvaAccount(query.account);
    const row = await getGeneration(client, id);
    if (!row) return reply.code(404).send({ error: { message: 'Not found.' } });
    if (!row.posterPath) {
      return reply
        .code(409)
        .send({ error: { message: 'This generation has no poster yet.' } });
    }

    const codeVerifier = randomBytes(64).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    const state = sealState(
      {
        account: account.key,
        generationId: id,
        codeVerifier,
        createdAt: Date.now(),
      },
      account,
    );
    const authorizationUrl = new URL(
      'https://www.canva.com/api/oauth/authorize',
    );
    authorizationUrl.search = new URLSearchParams({
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      scope: 'asset:read asset:write design:content:write',
      response_type: 'code',
      client_id: account.clientId,
      state,
      redirect_uri: account.redirectUri,
    }).toString();
    return reply.redirect(authorizationUrl.toString());
  });

  app.get('/canva/callback', async (request, reply) => {
    const query = CallbackQuerySchema.parse(request.query);
    if (query.error) {
      throw httpError(
        query.error_description ?? 'Canva authorization was cancelled.',
        400,
      );
    }
    if (!query.code || !query.state) {
      throw httpError('Canva did not return an authorization code.', 400);
    }

    const { state, account } = openState(query.state);
    const row = await getGeneration(client, state.generationId);
    if (!row) throw httpError('Generation not found.', 404);
    if (!row.posterPath) throw httpError('This generation has no poster.', 409);

    const accessToken = await exchangeCode(
      account,
      query.code,
      state.codeVerifier,
    );
    const poster = await downloadPng(client, row.posterPath);
    // Ordinary DGIPR social posters are transferred as three native Canva image elements:
    // editable artwork, untouched official logo, untouched official footer. CMO has a
    // full-canvas branded header/frame rather than the two DGIPR rectangles, while article and
    // YouTube posters use different chrome geometry, so those lanes retain the proven flat
    // asset handoff until they receive their own explicit layer map.
    const editUrl =
      isSocialCategory(row.category) && row.templateBrand === 'dgipr'
        ? await importLayeredPoster(
            accessToken,
            await createLayeredSocialPosterPptx(
              await buildCanvaSocialPosterLayers(poster),
            ),
            state.generationId,
          )
        : await createDesign(
            accessToken,
            await uploadPoster(accessToken, poster, state.generationId),
          );
    return reply.redirect(editUrl);
  });
}
