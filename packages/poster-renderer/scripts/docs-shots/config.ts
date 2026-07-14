// Shared configuration for the docs screenshot scripts (docs/user-guide assets).
// Everything derives from the repo layout so any phase can run from any cwd via
// `pnpm --filter @dgipr/poster-renderer docs:shots -- <phase>`.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');

export const WEB_URL =
  process.env.DOCS_SHOTS_WEB_URL ?? 'http://127.0.0.1:3000';
export const API_URL =
  process.env.DOCS_SHOTS_API_URL ?? 'http://127.0.0.1:3001';

export const OUT_DIR = path.join(REPO_ROOT, 'docs', 'user-guide', 'assets');
// The real GR note used for every live run (per the docs plan) — never a made-up note.
export const NOTE_FIXTURE_PATH = path.join(REPO_ROOT, 'trial-input.txt');
// Generation ids captured by the live-run phases, so later phases can find them.
export const STATE_PATH = path.join(here, '.state.json');

export const DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const;
export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

// --force re-takes screenshots that already exist (default: skip = idempotent re-runs).
export const FORCE = process.argv.includes('--force');
