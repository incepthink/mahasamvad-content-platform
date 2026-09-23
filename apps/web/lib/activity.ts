// Presentation helpers for the hidden /activity page. Pure, so they run anywhere.

import { ACTIVITY_STR } from './strings';

// `Chrome · Windows` from a stored user agent. Deliberately tiny: this labels a row so an admin
// can tell two officers on one office IP apart, it is not a device fingerprint. Order matters —
// Edge and Opera carry "Chrome" in their UA, Chrome carries "Safari".
export function browserOf(userAgent: string | null): string {
  if (!userAgent) return ACTIVITY_STR.unknownBrowser;
  if (/Edg\//.test(userAgent)) return 'Edge';
  if (/OPR\//.test(userAgent)) return 'Opera';
  if (/SamsungBrowser\//.test(userAgent)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(userAgent)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(userAgent)) return 'Chrome';
  if (/Safari\//.test(userAgent)) return 'Safari';
  if (/curl\//.test(userAgent)) return 'curl';
  return ACTIVITY_STR.unknownBrowser;
}

export function osOf(userAgent: string | null): string {
  if (!userAgent) return ACTIVITY_STR.unknownOs;
  if (/Android/.test(userAgent)) return 'Android';
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'iOS';
  if (/Windows/.test(userAgent)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(userAgent)) return 'macOS';
  if (/CrOS/.test(userAgent)) return 'ChromeOS';
  if (/Linux/.test(userAgent)) return 'Linux';
  return ACTIVITY_STR.unknownOs;
}

/** `Chrome · Windows · …a1b2` — the id's last four chars tell two devices of one kind apart. */
export function deviceLabel(
  deviceId: string | null,
  userAgent: string | null,
): string {
  const kind = `${browserOf(userAgent)} · ${osOf(userAgent)}`;
  if (!deviceId) return `${kind} · ${ACTIVITY_STR.noDevice}`;
  return `${kind} · …${deviceId.slice(-4)}`;
}

// Where a row's subject lives in the app, when it has a page of its own.
export function subjectHref(
  kind: string | null,
  id: string | null,
): string | null {
  if (!kind || !id) return null;
  switch (kind) {
    case 'generation':
      return `/generations/${id}`;
    case 'dlo_intake':
      return `/dlo/${id}`;
    case 'video_project':
      return `/video/${id}`;
    case 'chat_thread':
      return `/chat/${id}`;
    case 'nvw_conversation':
      return `/new-video-workflow/${id}`;
    default:
      return null;
  }
}

// Today in the reporting timezone as YYYY-MM-DD — the same calendar the API buckets by.
export function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
