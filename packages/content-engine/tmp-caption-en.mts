// TEMPORARY one-off: swap project 2dd065c6's burned-in on-screen key points
// from Marathi to English, so the free re-stitch (POST /video/projects/:id/stitch)
// re-typesets the caption overlays in English over the existing paid clips.
// Delete this file when done. Run from packages/content-engine:
//   npx tsx --env-file=../../.env tmp-caption-en.mts backup
//   npx tsx --env-file=../../.env tmp-caption-en.mts apply
//   npx tsx --env-file=../../.env tmp-caption-en.mts restore
import { readFileSync, writeFileSync } from 'node:fs';
import {
  createServiceRoleClient,
  getVideoProject,
  updateVideoProject,
} from '@dgipr/database';

const ID = '2dd065c6-33a2-4b0d-85c8-de7b26ac8756';
const BACKUP =
  'C:/Users/shaik/AppData/Local/Temp/claude/c--Users-shaik-Desktop-dev-work-mahasamvad-content-platform/16beedb9-65b5-4069-aaa7-2938b3c7dd43/scratchpad/2dd065c6-scenes-backup.json';

// Keyed by the EXACT stored Marathi string, so a scene whose key point has
// changed since this was written is left alone rather than mistranslated.
const EN: Record<string, string> = {
  'गडचिरोली, महाराष्ट्र': 'Gadchiroli, Maharashtra',
  'शांतता • सुरक्षितता • विश्वास': 'Peace • Safety • Trust',
  'विकासाच्या वाटा खुल्या होऊ लागल्या': 'New paths of development opened up',
  पूर्वी: 'Before',
  आज: 'Today',
  // Stored truncated at VIDEO_KEY_POINT_MAX_CHARS (48) mid-word — "प्रयत्नांमुळ".
  // The English completes the thought and still fits the same budget.
  'पोलीस आणि केंद्रीय सुरक्षा दलांच्या प्रयत्नांमुळ':
    'Through the efforts of police and central forces',
};

const mode = process.argv[2] ?? 'backup';
const client = createServiceRoleClient();
const row = await getVideoProject(client, ID);
if (!row) throw new Error('project not found');

if (mode === 'backup') {
  writeFileSync(BACKUP, JSON.stringify(row.scenes, null, 2), 'utf8');
  console.log(`backed up ${row.scenes.length} scenes -> ${BACKUP}`);
  for (const [i, s] of row.scenes.entries()) {
    const k = s.keyPoint?.trim();
    if (!k) continue;
    const en = EN[k];
    console.log(
      `${String(i + 1).padStart(2)}  ${k}\n    -> ${en ?? '*** NO TRANSLATION ***'}  (${en?.length ?? 0} chars)`,
    );
  }
  process.exit(0);
}

if (mode === 'restore') {
  const scenes = JSON.parse(readFileSync(BACKUP, 'utf8'));
  await updateVideoProject(client, ID, { scenes });
  console.log('restored Marathi key points from backup');
  process.exit(0);
}

if (mode !== 'apply') throw new Error(`unknown mode ${mode}`);

let changed = 0;
const scenes = row.scenes.map((scene) => {
  const k = scene.keyPoint?.trim();
  if (!k) return scene;
  const en = EN[k];
  if (!en) {
    console.warn(`scene key point not in the map, left as-is: ${k}`);
    return scene;
  }
  changed += 1;
  return { ...scene, keyPoint: en };
});
if (changed !== Object.keys(EN).length) {
  throw new Error(
    `expected ${Object.keys(EN).length} key points to change, changed ${changed}`,
  );
}
await updateVideoProject(client, ID, { scenes });
console.log(`updated ${changed} key points to English`);
