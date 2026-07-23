import { SocialPublishError, type PublishResult } from './types.js';

const DEFAULT_GRAPH_API_VERSION = 'v23.0';

// Graph's error envelope. `code` is what actually identifies the failure — the
// human `message` is often misleading (a permission failure on a Page edge is
// reported as the long-retired `publish_actions` permission, see below).
type GraphError = Readonly<{
  message?: string;
  code?: number;
  error_subcode?: number;
  type?: string;
}>;

// Publishes a photo post to a Facebook Page via the Graph API. `imageUrl` must be
// publicly reachable (the Supabase public poster URL is) — Meta fetches it
// server-side, so no byte upload is needed.
export async function publishFacebookPhotoPost(
  input: Readonly<{
    pageId: string;
    accessToken: string;
    caption: string;
    imageUrl: string;
    apiVersion?: string | undefined;
  }>,
): Promise<PublishResult> {
  const version = input.apiVersion ?? DEFAULT_GRAPH_API_VERSION;
  const endpoint = `https://graph.facebook.com/${version}/${encodeURIComponent(input.pageId)}/photos`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      body: new URLSearchParams({
        url: input.imageUrl,
        caption: input.caption,
        access_token: input.accessToken,
      }),
    });
  } catch (error) {
    throw new SocialPublishError('Facebook API unreachable.', { cause: error });
  }
  const payload = (await response.json().catch(() => null)) as {
    id?: string;
    post_id?: string;
    error?: GraphError;
  } | null;
  if (!response.ok || !payload || payload.error) {
    const graphError = payload?.error;
    throw new SocialPublishError(
      await describeFacebookError(graphError, response.status, {
        accessToken: input.accessToken,
        version,
      }),
      // The raw upstream text never reaches the officer's screen, so keep it here
      // for the server log (the route logs `err`).
      { cause: graphError ?? new Error(`HTTP ${response.status}`) },
    );
  }
  // post_id ("{pageId}_{postId}") requires pages_read_engagement; the bare photo
  // id still resolves to the post page as a fallback.
  const postId = payload.post_id ?? payload.id;
  if (!postId) {
    throw new SocialPublishError('Facebook API returned no post id.');
  }
  return { postId, postUrl: `https://www.facebook.com/${postId}` };
}

// Marathi guidance keyed off Graph's error code — the users of this platform are
// non-technical government staff, and the raw English Graph string is unactionable
// for them (mirrors describeTwitterError in twitter.js).
async function describeFacebookError(
  error: GraphError | undefined,
  httpStatus: number,
  probe: Readonly<{ accessToken: string; version: string }>,
): Promise<string> {
  const message = error?.message ?? '';
  const code = error?.code;

  // (#200) on a Page edge nearly always means a USER token was configured where a
  // PAGE token is required: Graph falls back to the permission check that the
  // retired `publish_actions` used to satisfy, so the message names a permission
  // that no longer exists and cannot be granted. pages_manage_posts on the user
  // token only entitles you to FETCH the Page token from /me/accounts.
  if (code === 200 || code === 10 || message.includes('publish_actions')) {
    const tokenType = await probeTokenType(probe.accessToken, probe.version);
    const diagnosis =
      tokenType === 'USER'
        ? 'सध्या User access token सेट केलेला आहे'
        : 'सेट केलेल्या टोकनला या पेजवर पोस्ट करण्याची परवानगी नाही';
    return `फेसबुक पेजवर पोस्ट करण्यासाठी Page access token आवश्यक आहे — ${diagnosis}. Graph API मध्ये /me/accounts कॉल करून त्या पेजचा access_token घ्या, तो सर्व्हरच्या .env मधील FACEBOOK_PAGE_ACCESS_TOKEN मध्ये ठेवा आणि API पुन्हा सुरू करा.`;
  }

  if (code === 190) {
    return 'फेसबुक टोकनची मुदत संपली आहे किंवा ते अवैध आहे — नवीन Page access token तयार करून सर्व्हरच्या .env मधील FACEBOOK_PAGE_ACCESS_TOKEN अद्ययावत करा आणि API पुन्हा सुरू करा.';
  }

  if (code === 100) {
    return 'फेसबुकने विनंती नाकारली — सर्व्हरच्या .env मधील FACEBOOK_PAGE_ID बरोबर आहे का, आणि पोस्टरची लिंक फेसबुकला उघडता येते का ते तपासा.';
  }

  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return 'फेसबुकची विनंती-मर्यादा गाठली आहे — काही वेळाने पुन्हा प्रयत्न करा.';
  }

  return message
    ? `Facebook API: ${message}`
    : `Facebook API request failed (HTTP ${httpStatus}).`;
}

// Best-effort, failure-path only: one call that turns "probably the wrong kind of
// token" into a statement of fact. Never throws — a diagnostic must not become a
// second source of failure.
async function probeTokenType(
  accessToken: string,
  version: string,
): Promise<string | null> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/${version}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(accessToken)}`,
    );
    const body = (await response.json()) as { data?: { type?: string } };
    return body.data?.type ?? null;
  } catch {
    return null;
  }
}
