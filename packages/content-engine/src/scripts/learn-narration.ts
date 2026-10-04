// One-off: speaks /learn's autoplay narration through ElevenLabs and commits it as MP3s.
//
// The lesson's spoken lines live in the web app (apps/web/lib/learn/creativeNarration.ts,
// which imports nothing for exactly this reason) and are loaded here at runtime by path, so
// the web app is not pulled into this package's compile. Each line becomes
//   apps/web/public/learn/creative/audio/<key>.<hash>.mp3
// and apps/web/lib/learn/creativeNarration.manifest.json maps key -> { src, seconds, textHash }.
// The hash in the file name means a changed line gets a new URL (no stale cached audio), and
// the manifest's textHash is what lets this script skip unchanged lines and lets the web
// harness (creative.check.ts) fail while any clip is stale.
//
// Speech goes through the same client /video uses (video/elevenlabs-tts.ts): the env voice,
// model and settings, and WAV out; ffmpeg turns that into small mono MP3 for the browser.
//
// PAID (a few cents — ~14 short lines; only CHANGED lines are re-spoken):
//   pnpm --filter @dgipr/content-engine learn:narrate [-- --only=text,send] [--dry-run]
// Needs ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { resolveFfmpeg, wavDurationSeconds } from '@dgipr/poster-renderer';
import { synthesizeElevenLabsNarration } from '../video/elevenlabs-tts.js';

const execFileAsync = promisify(execFile);

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const LESSONS = {
  creative: {
    script: 'apps/web/lib/learn/creativeNarration.ts',
    exportName: 'CREATIVE_NARRATION',
    manifest: 'apps/web/lib/learn/creativeNarration.manifest.json',
    audioDir: 'apps/web/public/learn/creative/audio',
    publicPrefix: '/learn/creative/audio',
  },
} as const;

type ManifestEntry = { src: string; seconds: number; textHash: string };

// Keep in step with creative.check.ts, which recomputes it to catch stale clips.
function textHash(text: string): string {
  return createHash('sha256')
    .update(text.normalize('NFC').trim())
    .digest('hex')
    .slice(0, 10);
}

async function readManifest(path: string): Promise<Record<string, ManifestEntry>> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, ManifestEntry>;
  } catch {
    return {};
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const dryRun = args.includes('--dry-run');
  const lessonName = (arg('lesson') ?? 'creative') as keyof typeof LESSONS;
  const lesson = LESSONS[lessonName];
  if (!lesson) throw new Error(`Unknown lesson "${lessonName}".`);
  const only = arg('only')?.split(',').filter(Boolean) ?? null;

  const module = (await import(
    pathToFileURL(join(REPO, lesson.script)).href
  )) as Record<string, Record<string, string>>;
  const lines = module[lesson.exportName];
  if (!lines) throw new Error(`${lesson.script} has no ${lesson.exportName}.`);

  const manifestPath = join(REPO, lesson.manifest);
  const audioDir = join(REPO, lesson.audioDir);
  const previous = await readManifest(manifestPath);
  const next: Record<string, ManifestEntry> = {};
  await mkdir(audioDir, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), 'learn-narration-'));

  let spoken = 0;
  let chars = 0;
  try {
    for (const [key, text] of Object.entries(lines)) {
      const hash = textHash(text);
      const fileName = `${key}.${hash}.mp3`;
      const old = previous[key];
      if (
        old &&
        old.textHash === hash &&
        !only?.includes(key) &&
        (await exists(join(audioDir, fileName)))
      ) {
        next[key] = old;
        continue;
      }
      if (only && !only.includes(key) && old) {
        // Asked to leave this one alone, stale or not.
        next[key] = old;
        continue;
      }
      chars += text.length;
      if (dryRun) {
        console.log(`would speak ${key} (${text.length} chars)`);
        if (old) next[key] = old;
        continue;
      }
      console.log(`speaking ${key} (${text.length} chars)…`);
      const wav = await synthesizeElevenLabsNarration(text);
      const wavPath = join(work, `${key}.wav`);
      await writeFile(wavPath, wav);
      await execFileAsync(resolveFfmpeg(), [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        wavPath,
        '-ac',
        '1',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '64k',
        join(audioDir, fileName),
      ]);
      const seconds = Math.round(wavDurationSeconds(wav) * 100) / 100;
      next[key] = { src: `${lesson.publicPrefix}/${fileName}`, seconds, textHash: hash };
      spoken += 1;
      console.log(`  ${seconds}s -> ${lesson.audioDir}/${fileName}`);
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  if (dryRun) {
    console.log(`dry run: ${chars} chars would be spoken.`);
    return;
  }

  // Clips no line points at any more.
  const kept = new Set(Object.values(next).map((e) => e.src.split('/').pop()));
  for (const name of await readdir(audioDir)) {
    if (name.endsWith('.mp3') && !kept.has(name)) {
      await rm(join(audioDir, name));
      console.log(`removed stale ${name}`);
    }
  }
  await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`${spoken} clip(s) spoken (${chars} chars); manifest written.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
