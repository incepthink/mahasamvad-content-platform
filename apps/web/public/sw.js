/* global self, caches */

// Android Web Share Target receiver.
//
// An installed PWA receives a shared recording as a navigation POST. Sending that POST to
// a Next/Vercel route would put a meeting-sized file through a serverless request limit, so
// the service worker intercepts it on the PHONE, stores it briefly in Cache Storage, and
// redirects to /transcribe. The page consumes and deletes the cached bytes, then uploads
// through the existing recording API exactly like a file picked by hand.

const SHARE_ACTION = '/share/audio';
const SHARE_CACHE = 'dgipr-shared-audio-v1';
const SHARE_PREFIX = '/__dgipr-shared-audio/';
const MAX_FILES = 10;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === SHARE_ACTION) {
    event.respondWith(receiveSharedAudio(event.request));
  }
});

async function receiveSharedAudio(request) {
  try {
    const form = await request.formData();
    const shared = form
      .getAll('recordings')
      .filter((value) => value instanceof File)
      .filter((file) => file.size > 0);
    const files = shared
      .filter((file) => file.size <= MAX_FILE_BYTES)
      .slice(0, MAX_FILES);

    if (files.length === 0) {
      // A meeting recording over the per-file ceiling is the likeliest way to arrive here,
      // and it needs its own answer: told only that the share "could not be opened", an
      // officer re-shares the same too-large file indefinitely.
      return redirectToTranscribe({
        share_error: shared.length > 0 ? 'too-large' : 'no-audio',
      });
    }

    const id = crypto.randomUUID();
    const cache = await caches.open(SHARE_CACHE);
    await removeExpiredShares(cache);

    const metadata = {
      id,
      createdAt: Date.now(),
      files: files.map((file, index) => ({
        index,
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
      })),
    };

    await Promise.all(
      files.map((file, index) =>
        cache.put(
          shareRequest(id, `file-${index}`),
          new Response(file, {
            headers: {
              'content-type': file.type || 'application/octet-stream',
            },
          }),
        ),
      ),
    );
    // Write metadata LAST. Its presence means every file body is ready to consume.
    await cache.put(
      shareRequest(id, 'metadata'),
      new Response(JSON.stringify(metadata), {
        headers: { 'content-type': 'application/json' },
      }),
    );

    return redirectToTranscribe({ share: id });
  } catch (error) {
    console.error('[share-target] Could not receive shared audio:', error);
    return redirectToTranscribe({ share_error: 'storage' });
  }
}

function shareRequest(id, leaf) {
  return new Request(
    new URL(
      `${SHARE_PREFIX}${encodeURIComponent(id)}/${leaf}`,
      self.location.origin,
    ),
  );
}

function redirectToTranscribe(params) {
  const target = new URL('/transcribe', self.location.origin);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  return Response.redirect(target, 303);
}

async function removeExpiredShares(cache) {
  const requests = await cache.keys();
  const metadataRequests = requests.filter((request) =>
    new URL(request.url).pathname.endsWith('/metadata'),
  );
  await Promise.all(
    metadataRequests.map(async (request) => {
      const response = await cache.match(request);
      if (!response) return;
      try {
        const metadata = await response.json();
        if (
          typeof metadata.createdAt !== 'number' ||
          Date.now() - metadata.createdAt > MAX_AGE_MS
        ) {
          await removeShare(cache, metadata.id);
        }
      } catch {
        await cache.delete(request);
      }
    }),
  );
}

async function removeShare(cache, id) {
  const requests = await cache.keys();
  const prefix = `${SHARE_PREFIX}${encodeURIComponent(id)}/`;
  await Promise.all(
    requests
      .filter((request) => new URL(request.url).pathname.startsWith(prefix))
      .map((request) => cache.delete(request)),
  );
}
