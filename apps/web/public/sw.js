/* global self, caches */

// Android Web Share Target receiver.
//
// An installed PWA receives a shared recording as a navigation POST. Sending that POST to
// a Next/Vercel route would put a meeting-sized file through a serverless request limit, so
// the service worker intercepts it on the PHONE, stores it briefly in Cache Storage, and
// redirects to the page the officer was last on — /dlo or /transcribe, remembered by the
// app itself (lib/sharedAudio.ts, rememberShareDestination) because Android's Share sheet
// offers one entry per app and the share carries no hint of where it was started. The page
// consumes and deletes the cached bytes: /transcribe uploads them at once, /dlo attaches
// them to its form.

const SHARE_ACTION = '/share/audio';
const SHARE_CACHE = 'dgipr-shared-audio-v1';
const SHARE_PREFIX = '/__dgipr-shared-audio/';
const MAX_FILES = 10;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Written by the page, read here. Outside SHARE_PREFIX so removeShare never deletes it.
const DESTINATION_KEY = '/__dgipr-share-destination';
// An allow-list, not the stored string: a redirect target must never come from storage.
const DESTINATIONS = ['/dlo', '/transcribe'];
const DEFAULT_DESTINATION = '/transcribe';

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
  const destination = await readDestination();
  const redirectBack = (params) => redirectTo(destination, params);
  try {
    const form = await request.formData();
    const shared = form
      .getAll('recordings')
      .filter((value) => value instanceof File)
      .filter((file) => file.size > 0);
    // No per-file size ceiling, matching the recording API: /transcribe stopped capping an
    // upload on 2026-08-24, and a share sheet dropping a two-hour recording the server would
    // have accepted is a refusal the officer cannot act on. The count still bounds one share.
    const files = shared.slice(0, MAX_FILES);

    if (files.length === 0) {
      // 'too-large' is unreachable while nothing is filtered by size, and is kept only so a
      // future ceiling has somewhere to land: told only that the share "could not be
      // opened", an officer re-shares the same rejected file indefinitely.
      return redirectBack({
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

    return redirectBack({ share: id });
  } catch (error) {
    console.error('[share-target] Could not receive shared audio:', error);
    return redirectBack({ share_error: 'storage' });
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

async function readDestination() {
  try {
    const cache = await caches.open(SHARE_CACHE);
    const response = await cache.match(
      new Request(new URL(DESTINATION_KEY, self.location.origin)),
    );
    if (!response) return DEFAULT_DESTINATION;
    const { path } = await response.json();
    return DESTINATIONS.includes(path) ? path : DEFAULT_DESTINATION;
  } catch {
    return DEFAULT_DESTINATION;
  }
}

function redirectTo(path, params) {
  const target = new URL(path, self.location.origin);
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
