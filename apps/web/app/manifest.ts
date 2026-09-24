import type { MetadataRoute } from 'next';

// `share_target` is part of the web-app manifest standard but is not yet present in
// Next's MetadataRoute.Manifest type. Keep the extension local so the emitted manifest
// stays typed without weakening the rest of the app's metadata.
type ShareTargetManifest = MetadataRoute.Manifest & {
  share_target: {
    action: string;
    method: 'POST';
    enctype: 'multipart/form-data';
    params: {
      files: Array<{
        name: string;
        accept: string[];
      }>;
    };
  };
};

export default function manifest(): ShareTargetManifest {
  return {
    id: '/',
    name: 'Newsroom',
    short_name: 'Newsroom',
    description: 'महाराष्ट्र शासनाच्या प्रसिद्धीसाठी मराठी सामग्री मंच',
    start_url: '/transcribe',
    scope: '/',
    display: 'standalone',
    background_color: '#fffaf0',
    theme_color: '#9f1d20',
    lang: 'mr',
    orientation: 'any',
    icons: [
      {
        src: '/pwa-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/pwa-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    prefer_related_applications: false,
    // Once the PWA is installed, Android registers Newsroom in the system Share sheet.
    // The service worker intercepts this POST before the recording ever reaches Vercel.
    share_target: {
      action: '/share/audio',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        files: [
          {
            name: 'recordings',
            // `audio/*` is what lets recorder and messaging apps offer Newsroom even
            // when their exact MIME spelling differs. The client and API still enforce
            // the narrower supported-container list before transcription. `video/*` is
            // there for a meeting filmed on the phone: the page pulls the audio track out
            // on the device and only that is uploaded.
            accept: [
              'audio/*',
              'video/*',
              '.mp4',
              '.m4v',
              '.mov',
              '.mkv',
              '.3gp',
              '.mp3',
              '.m4a',
              '.aac',
              '.aif',
              '.aiff',
              '.ogg',
              '.oga',
              '.opus',
              '.wav',
              '.flac',
              '.webm',
            ],
          },
        ],
      },
    },
  };
}
