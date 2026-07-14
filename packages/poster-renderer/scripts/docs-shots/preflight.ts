// Preflight for the docs screenshot capture: verifies the local stack is ready
// WITHOUT printing any secret values — env vars are checked for presence only,
// and webhook URLs are reduced to their origin before anything is printed.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { API_URL, NOTE_FIXTURE_PATH, REPO_ROOT, WEB_URL } from './config.js';

const REQUIRED_ENV_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'N8N_SOCIAL_POST_WEBHOOK_URL',
  'N8N_ARTICLE_POSTER_WEBHOOK_URL',
] as const;

type Check = { name: string; ok: boolean; hard: boolean; note: string };

function parseEnvFile(): Map<string, string> {
  const envPath = path.join(REPO_ROOT, '.env');
  const map = new Map<string, string>();
  if (!fs.existsSync(envPath)) return map;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) map.set(match[1]!, match[2]!.trim());
  }
  return map;
}

async function checkHttp(
  name: string,
  url: string,
  hard: boolean,
): Promise<Check> {
  try {
    const res = await fetch(url);
    return { name, ok: true, hard, note: `HTTP ${res.status}` };
  } catch (e) {
    return {
      name,
      ok: false,
      hard,
      note: e instanceof Error ? e.message : 'unreachable',
    };
  }
}

export async function preflight(): Promise<void> {
  const checks: Check[] = [];
  const env = parseEnvFile();

  for (const key of REQUIRED_ENV_KEYS) {
    const present = (env.get(key) ?? '').length > 0;
    checks.push({
      name: `.env has ${key}`,
      ok: present,
      hard: true,
      note: present ? 'present' : 'MISSING',
    });
  }

  checks.push({
    name: 'note fixture (trial-input.txt)',
    ok: fs.existsSync(NOTE_FIXTURE_PATH),
    hard: true,
    note: NOTE_FIXTURE_PATH,
  });

  checks.push(await checkHttp('API /health', `${API_URL}/health`, true));
  checks.push(await checkHttp('Web app', WEB_URL, true));

  // Webhook hosts: an HTTP GET against the ORIGIN only (never the webhook path —
  // a POST would fire the workflow). Any response, even 404, proves the host is up.
  for (const key of [
    'N8N_SOCIAL_POST_WEBHOOK_URL',
    'N8N_ARTICLE_POSTER_WEBHOOK_URL',
  ] as const) {
    const raw = env.get(key);
    if (!raw) continue;
    try {
      const origin = new URL(raw).origin;
      checks.push(await checkHttp(`n8n host for ${key} (${origin})`, origin, false));
    } catch {
      checks.push({ name: `${key} is a valid URL`, ok: false, hard: false, note: 'unparseable' });
    }
  }

  // At least one enabled reference image per category, or poster runs will fail.
  try {
    const images = (await (await fetch(`${API_URL}/api/references`)).json()) as Array<{
      category: string;
      isActive: boolean;
    }>;
    for (const category of ['article', 'twitter'] as const) {
      const enabled = images.filter((i) => i.category === category && i.isActive).length;
      checks.push({
        name: `enabled reference images (${category})`,
        ok: enabled > 0,
        hard: false,
        note: String(enabled),
      });
    }
  } catch (e) {
    checks.push({
      name: 'reference library reachable',
      ok: false,
      hard: false,
      note: e instanceof Error ? e.message : 'failed',
    });
  }

  // Chromium smoke test (the browsers are installed for poster-renderer already).
  try {
    const browser = await chromium.launch();
    await browser.close();
    checks.push({ name: 'chromium launch', ok: true, hard: true, note: 'ok' });
  } catch (e) {
    checks.push({
      name: 'chromium launch',
      ok: false,
      hard: true,
      note: e instanceof Error ? e.message : 'failed',
    });
  }

  let hardFail = false;
  console.log('\nPreflight:');
  for (const check of checks) {
    const mark = check.ok ? 'OK  ' : check.hard ? 'FAIL' : 'WARN';
    if (!check.ok && check.hard) hardFail = true;
    console.log(`  [${mark}] ${check.name} — ${check.note}`);
  }
  if (hardFail) {
    console.error('\nPreflight failed — fix the FAIL rows before capturing.');
    process.exitCode = 1;
  } else {
    console.log('\nPreflight passed. (WARN rows only block the live-run phases.)');
  }
}
