import { AUDIO_FILE_EXTENSIONS, VIDEO_FILE_EXTENSIONS } from '@dgipr/schemas';

const SHARE_CACHE = 'dgipr-shared-audio-v1';
const SHARE_PREFIX = '/__dgipr-shared-audio/';
// Where the service worker sends a share. Deliberately OUTSIDE SHARE_PREFIX, so the
// worker's per-share cleanup can never sweep it away. Read by public/sw.js — keep the
// key and the JSON shape ({ path }) in step with it.
const SHARE_DESTINATION_KEY = '/__dgipr-share-destination';

// The pages that can receive a shared recording. Android's Share sheet offers ONE entry per
// app, so it cannot know whether the officer came from /dlo or /transcribe; the share goes
// to whichever of these the officer was last looking at. Every other page — including the
// /dlo/[id] workspaces, which take no new recordings — is mapped to the form that can.
export type ShareDestination = '/dlo' | '/transcribe';

export function shareDestinationFor(pathname: string): ShareDestination {
  return pathname === '/dlo' || pathname.startsWith('/dlo/')
    ? '/dlo'
    : '/transcribe';
}

let lastRememberedDestination: ShareDestination | null = null;

// Best-effort and silent: a failure here costs only where the next share lands, which then
// falls back to /transcribe exactly as before.
export async function rememberShareDestination(
  pathname: string,
): Promise<void> {
  const path = shareDestinationFor(pathname);
  if (path === lastRememberedDestination) return;
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    const cache = await caches.open(SHARE_CACHE);
    await cache.put(
      new Request(new URL(SHARE_DESTINATION_KEY, window.location.origin)),
      new Response(JSON.stringify({ path }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    lastRememberedDestination = path;
  } catch {
    // Private mode, a storage quota, an embedded webview: the share keeps its old default.
  }
}

// The one-shot query a share navigation arrives with. Reading it STRIPS it from the address,
// so a refresh cannot attach (or on /transcribe, submit) the same recording twice.
export function takeShareParams(): {
  shareId: string | null;
  shareError: string | null;
} {
  const url = new URL(window.location.href);
  const shareId = url.searchParams.get('share');
  const shareError = url.searchParams.get('share_error');
  if (shareId || shareError) {
    url.searchParams.delete('share');
    url.searchParams.delete('share_error');
    window.history.replaceState(
      null,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  }
  return { shareId, shareError };
}

type SharedAudioMetadata = Readonly<{
  id: string;
  createdAt: number;
  files: ReadonlyArray<
    Readonly<{
      index: number;
      name: string;
      type: string;
      size: number;
      lastModified: number;
    }>
  >;
}>;

// A shared recording is validated by the EXTENSION of its name — that is what both the
// picker and the API agree on (@dgipr/schemas' audioMimeForFileName). Android share intents
// routinely supply a display name with no extension at all, so the container has to be
// recovered from the MIME type instead. The aliases are here because a share sheet reports
// whatever the source app registered, not the canonical spelling.
const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/x-mpeg': '.mp3',
  'audio/mpeg3': '.mp3',
  'audio/x-mpeg-3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/x-aac': '.aac',
  'audio/aacp': '.aac',
  'audio/aiff': '.aiff',
  'audio/x-aiff': '.aiff',
  'audio/ogg': '.ogg',
  'audio/x-ogg': '.ogg',
  'audio/vorbis': '.ogg',
  'audio/opus': '.opus',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/vnd.wave': '.wav',
  'audio/x-pn-wav': '.wav',
  'audio/flac': '.flac',
  'audio/x-flac': '.flac',
  'audio/webm': '.webm',
  // A shared VIDEO (WhatsApp, the camera app) is converted to its audio track before it is
  // submitted (TranscriptionForm), and that conversion is chosen by extension too — so a
  // nameless shared video needs one as much as a nameless voice note does.
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
  'video/3gpp': '.3gp',
  'video/webm': '.webm',
};

// `audio/ogg; codecs=opus` and `audio/mp4; codecs="mp4a.40.2"` are what WhatsApp and the
// stock recorders actually hand over. The parameters describe the codec, never the
// container, so they are dropped before the lookup — matching on the full string silently
// failed to recognise the two most common Android recordings there are.
function baseMimeType(type: string): string {
  const [essence = ''] = type.toLowerCase().split(';');
  return essence.trim();
}

function sharedRequest(id: string, leaf: string): Request {
  return new Request(
    new URL(
      `${SHARE_PREFIX}${encodeURIComponent(id)}/${leaf}`,
      window.location.origin,
    ),
  );
}

// The accepted extensions come from @dgipr/schemas rather than a copy, so a container added
// there can never be one this path still strips the name of.
function fileNameWithAudioExtension(name: string, type: string): string {
  const clean = name.trim() || 'ध्वनिमुद्रण';
  const dot = clean.lastIndexOf('.');
  const current = dot === -1 ? '' : clean.slice(dot).toLowerCase();
  if (
    AUDIO_FILE_EXTENSIONS.includes(current) ||
    VIDEO_FILE_EXTENSIONS.includes(current)
  ) {
    return clean;
  }
  return `${clean}${EXTENSION_BY_MIME[baseMimeType(type)] ?? ''}`;
}

async function removeShare(cache: Cache, id: string): Promise<void> {
  const prefix = `${SHARE_PREFIX}${encodeURIComponent(id)}/`;
  const requests = await cache.keys();
  await Promise.all(
    requests
      .filter((request) => new URL(request.url).pathname.startsWith(prefix))
      .map((request) => cache.delete(request)),
  );
}

// Consume once: after the File objects exist in React state they can be retried without
// Cache Storage, while leaving a second durable copy on the phone would only leak space.
export async function consumeSharedAudio(id: string): Promise<File[]> {
  if (!('caches' in window)) throw new Error('Cache Storage unavailable.');
  const cache = await caches.open(SHARE_CACHE);
  const metadataResponse = await cache.match(sharedRequest(id, 'metadata'));
  if (!metadataResponse)
    throw new Error('Shared audio is no longer available.');

  const metadata = (await metadataResponse.json()) as SharedAudioMetadata;
  const files = await Promise.all(
    metadata.files.map(async (entry) => {
      const response = await cache.match(
        sharedRequest(id, `file-${entry.index}`),
      );
      if (!response) throw new Error(`Missing shared audio ${entry.index}.`);
      const blob = await response.blob();
      const type = entry.type || blob.type;
      return new File([blob], fileNameWithAudioExtension(entry.name, type), {
        type,
        lastModified: entry.lastModified || Date.now(),
      });
    }),
  );

  await removeShare(cache, id);
  return files;
}
