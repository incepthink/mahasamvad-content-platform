/**
 * ONE-OFF repair, not product code. Delete after use.
 *
 * Scene 1 of project 2dd065c6 was branded before overlayVideoLogo switched to
 * the card-less lockup, so the OLD white card is baked into its pixels. The
 * stitch then re-stamps the current lockup at the identical rect, printing the
 * white wordmark onto that white card. Re-stamping cannot fix it; the card has
 * to be painted out of the stored clip first.
 *
 * Pass 1 replaces the card rect with a mirrored, softened copy of the footage
 * to its left, feathered so the join lands on real pixels rather than a hard
 * edge. Pass 2 is the pipeline's own overlayVideoLogo, so this clip ends up
 * byte-for-byte the shape a fresh render would produce.
 *
 *   npx tsx --env-file=../../.env tmp-fix-scene0-logo.mts           # preview
 *   npx tsx --env-file=../../.env tmp-fix-scene0-logo.mts --apply   # upload
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  VIDEOS_BUCKET,
  createServiceRoleClient,
  downloadFile,
  getVideoProject,
  updateVideoProject,
  uploadFile,
} from '@dgipr/database';
import { overlayVideoLogo, resolveFfmpeg } from '@dgipr/poster-renderer';

const run = promisify(execFile);

const PROJECT_ID = '2dd065c6-33a2-4b0d-85c8-de7b26ac8756';
const SCENE = 0;
const APPLY = process.argv.includes('--apply');
const WORK = join(
  process.env.LOCALAPPDATA ?? process.env.TMPDIR ?? '.',
  'Temp/claude/vid/fix',
);

// The old card's footprint, measured on the stored clip and confirmed against
// assemble.ts's own geometry (width x 0.15 wide, x 0.008 margin, top-right),
// padded 2px for antialiasing. Recomputed from the real frame width below.
const LOCKUP_WIDTH_RATIO = 0.15;
const LOCKUP_MARGIN_RATIO = 0.008;
const LOCKUP_ASPECT = 154 / 160;
const PAD = 2;
const FEATHER = 28;
const BLUR = 4;

// ffmpeg-static ships no ffprobe, so read the size off ffmpeg's own stream line.
async function frameSize(path: string): Promise<{ w: number; h: number }> {
  const stderr = await run(resolveFfmpeg(), ['-hide_banner', '-i', path]).then(
    (r) => r.stderr,
    (error: { stderr?: string }) => error.stderr ?? '',
  );
  const match = /Video:.*?, (\d+)x(\d+)/.exec(stderr);
  if (!match) throw new Error(`could not read frame size:\n${stderr}`);
  return { w: Number(match[1]), h: Number(match[2]) };
}

async function main() {
  await mkdir(WORK, { recursive: true });
  const client = createServiceRoleClient();
  const row = await getVideoProject(client, PROJECT_ID);
  if (!row) throw new Error('project not found');
  const scene = row.scenes[SCENE];
  if (!scene?.clipPath) throw new Error('scene 1 has no clip');
  console.log(`current clip: ${scene.clipPath} (v${scene.clipVersion})`);

  const original = join(WORK, 'original.mp4');
  await writeFile(
    original,
    await downloadFile(client, VIDEOS_BUCKET, scene.clipPath),
  );
  const frame = await frameSize(original);
  const lockupWidth = Math.round(frame.w * LOCKUP_WIDTH_RATIO);
  const lockupHeight = Math.round(lockupWidth * LOCKUP_ASPECT);
  const margin = Math.max(4, Math.round(frame.w * LOCKUP_MARGIN_RATIO));
  const card = {
    x: frame.w - lockupWidth - margin - PAD,
    y: margin - PAD,
    w: lockupWidth + PAD * 2,
    h: lockupHeight + PAD * 2,
  };
  console.log(`frame ${frame.w}x${frame.h}, old card`, card);

  // Patch region = the card plus a feather ring, clamped to the frame. The top
  // and right sit at the frame edge, so the ramp only ever shows on the left
  // and bottom, which is where the join meets real footage.
  const px = Math.max(0, card.x - FEATHER);
  const py = Math.max(0, card.y - FEATHER);
  const pw = Math.min(frame.w, card.x + card.w + FEATHER) - px;
  const ph = Math.min(frame.h, card.y + card.h + FEATHER) - py;
  // Card bounds in patch-local coordinates, for the alpha ramp.
  const cx0 = card.x - px;
  const cx1 = cx0 + card.w;
  const cy0 = card.y - py;
  const cy1 = cy0 + card.h;
  const outside = `max(max(max(max(0,${cx0}-X),X-${cx1}),${cy0}-Y),Y-${cy1})`;
  const alpha = `255*max(0,1-(${outside})/${FEATHER})`;
  const patched = join(WORK, 'patched.mp4');
  await run(resolveFfmpeg(), [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    original,
    '-filter_complex',
    // Mirror the footage immediately left of the card, soften it, and fade its
    // edges out. Fully opaque over the card itself — the white pixels there are
    // destroyed footage and must be covered outright, not blended with.
    `[0:v]crop=${pw}:${ph}:${Math.max(0, px - pw)}:${py},hflip,` +
      `boxblur=${BLUR}:2,format=rgba,` +
      `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}'[p];` +
      `[0:v][p]overlay=${px}:${py}[o]`,
    '-map',
    '[o]',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '16',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    patched,
  ]);

  // The pipeline's own branding, so this clip matches every other scene exactly.
  const branded = await overlayVideoLogo(await readFile(patched), {
    aspectRatio: row.orientation === 'vertical' ? '9:16' : '16:9',
    expectedDurationSeconds: scene.durationSeconds,
  });
  const out = join(WORK, 'scene-0-fixed.mp4');
  await writeFile(out, branded);
  for (const t of ['0.5', '4', '7.5']) {
    await run(resolveFfmpeg(), [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      t,
      '-i',
      out,
      '-frames:v',
      '1',
      join(WORK, `fixed-t${t}.png`),
    ]);
  }
  console.log(`wrote ${out} (${(branded.length / 1e6).toFixed(2)} MB) + frames`);

  if (!APPLY) {
    console.log('preview only — re-run with --apply to upload');
    return;
  }

  const version = (scene.clipVersion ?? 1) + 1;
  const path = `projects/${PROJECT_ID}/scene-${SCENE}-clip-v${version}.mp4`;
  await uploadFile(client, VIDEOS_BUCKET, path, branded, 'video/mp4');
  const scenes = [...row.scenes];
  scenes[SCENE] = { ...scene, clipPath: path, clipVersion: version };
  await updateVideoProject(client, PROJECT_ID, { scenes });
  console.log(`uploaded ${path} and pointed the row at it`);
}

await main();
