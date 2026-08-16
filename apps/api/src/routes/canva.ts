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
const ASSET_POLL_ATTEMPTS = 40;
const ASSET_POLL_DELAY_MS = 750;

const GenerationParamsSchema = z.object({ id: z.string().uuid() });
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

type CanvaConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type OAuthState = {
  generationId: string;
  codeVerifier: string;
  createdAt: number;
};

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function configFromEnv(): CanvaConfig {
  const clientId = process.env.CANVA_CLIENT_ID?.trim();
  const clientSecret = process.env.CANVA_CLIENT_SECRET?.trim();
  const redirectUri = process.env.CANVA_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw httpError(
      'Canva integration is not configured. Set CANVA_CLIENT_ID, CANVA_CLIENT_SECRET and CANVA_REDIRECT_URI.',
      503,
    );
  }
  return { clientId, clientSecret, redirectUri };
}

function stateKey(clientSecret: string): Buffer {
  return createHash('sha256')
    .update(`mahasamvad-canva-oauth:${clientSecret}`)
    .digest();
}

// The PKCE verifier must stay server-side. Encrypting it into the opaque OAuth state keeps
// the flow stateless without exposing it to browser JavaScript or requiring a session store.
function sealState(value: OAuthState, clientSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', stateKey(clientSecret), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    'base64url',
  );
}

function openState(value: string, clientSecret: string): OAuthState {
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.length < 29) throw new Error('OAuth state is too short.');
    const iv = bytes.subarray(0, 12);
    const tag = bytes.subarray(12, 28);
    const encrypted = bytes.subarray(28);
    const decipher = createDecipheriv(
      'aes-256-gcm',
      stateKey(clientSecret),
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
        generationId: z.string().uuid(),
        codeVerifier: z.string().min(43).max(128),
        createdAt: z.number().int(),
      })
      .parse(parsed);
    if (
      state.createdAt > Date.now() + 60_000 ||
      Date.now() - state.createdAt > OAUTH_STATE_MAX_AGE_MS
    ) {
      throw new Error('OAuth state has expired.');
    }
    return state;
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
  config: CanvaConfig,
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
  app.get('/canva/generations/:id', async (request, reply) => {
    const { id } = GenerationParamsSchema.parse(request.params);
    const row = await getGeneration(client, id);
    if (!row) return reply.code(404).send({ error: { message: 'Not found.' } });
    if (!row.posterPath) {
      return reply
        .code(409)
        .send({ error: { message: 'This generation has no poster yet.' } });
    }

    const config = configFromEnv();
    const codeVerifier = randomBytes(64).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    const state = sealState(
      { generationId: id, codeVerifier, createdAt: Date.now() },
      config.clientSecret,
    );
    const authorizationUrl = new URL(
      'https://www.canva.com/api/oauth/authorize',
    );
    authorizationUrl.search = new URLSearchParams({
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      scope: 'asset:read asset:write design:content:write',
      response_type: 'code',
      client_id: config.clientId,
      state,
      redirect_uri: config.redirectUri,
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

    const config = configFromEnv();
    const state = openState(query.state, config.clientSecret);
    const row = await getGeneration(client, state.generationId);
    if (!row) throw httpError('Generation not found.', 404);
    if (!row.posterPath) throw httpError('This generation has no poster.', 409);

    const accessToken = await exchangeCode(
      config,
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
