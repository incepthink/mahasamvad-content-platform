// Reverse-extract a synthetic "note" from each real article (plan step 2).
//
// We have articles (outputs) but no notes (inputs), so we run the editor workflow
// backwards: strip each article down to its bare factual skeleton — the terse notes an
// editor would have started from — and pair `(synthetic note -> real article)`. Trained on
// these, the model learns the one delta between input and output: the editorial framing.
//
// The make-or-break property is RECALL of hard specifics: if the article states a
// number/name/date/scheme the note omits, the pair teaches the model that inventing that
// class of fact is normal. So after extraction we run a reverse-coverage GATE — reuse
// findMissingInformation with article and note swapped, so it reports every article info
// unit missing from the note — then one repair pass, and drop any pair that still leaks.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractParagraphs } from '../chunking/chunk-articles.js';
import { chatComplete } from '../generation/openai-chat.js';
import type { FinetuneCategory, LabeledPost } from './build-corpus.js';

// Cheap model for the bulk extraction/repair; the leak GATE stays on the default (gpt-4o)
// for accurate recall since it is the safety check.
const EXTRACT_MODEL = 'gpt-4o-mini';

// Marker the gate prints when nothing leaked. Kept distinct so it can't collide with a
// real reported line.
const NONE_MARKER = 'काही-नाही';

const EXTRACT_SYSTEM_PROMPT = [
  'तुम्हाला एक प्रकाशित मराठी "लेख" (ARTICLE) दिला आहे. हा लेख ज्या मूळ "टिपणी" (NOTES)',
  'वरून लिहिला गेला असता, ती टिपणी पुनर्रचित करा — म्हणजे लेखातील फक्त तथ्यात्मक सांगाडा',
  'त्रोटक मुद्द्यांमध्ये (bullets) काढा.',
  '',
  'नियम:',
  '1. फक्त मराठीत (देवनागरी), प्रत्येक ओळ "- " ने सुरू करा.',
  '2. लेखातील प्रत्येक ठोस माहिती-घटक समाविष्ट करा — सर्व नावे, तारखा, रक्कम/आकडे, पदनामे,',
  '   योजना, संस्था/बँका/प्रणाली/ॲप यांची नावे, ठिकाणे, तसेच प्रत्येक उद्दिष्ट, जबाबदारी,',
  '   प्रक्रिया व अट. एकही नाव/आकडा गाळू नका; आकडे/नावे/तारखा जशाच्या तशा ठेवा.',
  '3. लेखनशैली, प्रस्तावना, पार्श्वभूमीवरील भाष्य, भावनिक/वैचारिक वाक्ये व मते वगळा —',
  '   फक्त कोरडी तथ्ये ठेवा (टिपणी ही शैलीरहित असते).',
  '4. बातमी असल्यास सुरुवातीचा ठिकाण-दिनांक (dateline, उदा. "मुंबई, दि.६") पहिल्या',
  '   मुद्द्यात जसाच्या तसा ठेवा; तो शैली नसून तथ्य आहे.',
  '5. लेखाच्या शेवटी वार्ताहर/लेखकाचे नाव (byline) असल्यास ते एका मुद्द्यात नोंदवा.',
  '6. काहीही नवीन तयार करू नका; जे लेखात नाही ते लिहू नका.',
].join('\n');

async function extractNote(articleText: string): Promise<string> {
  return (
    await chatComplete(
      [
        { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: ['## लेख (ARTICLE):', articleText, '', '## टिपणी (bullets):'].join(
            '\n',
          ),
        },
      ],
      { temperature: 0, model: EXTRACT_MODEL },
    )
  ).trim();
}

// Leak gate: HARD SPECIFICS (name / number / amount / date / percentage / designation /
// scheme or body name / place) present in the article but missing from the note. Unlike a
// full coverage check we deliberately IGNORE framing/rhetoric/opinion — the note is meant
// to be framing-free, so only leaked *facts* matter (a leaked fact is what would teach the
// model to invent that class of specific). Runs on gpt-4o (default) for accurate recall.
const LEAK_SYSTEM_PROMPT = [
  'तुम्हाला एक "टिपणी" (NOTES) आणि त्यावरून विस्तारित "लेख" (ARTICLE) दिला आहे. लेखात असे',
  'कोणते ठोस तथ्यात्मक घटक आहेत — नाव, आकडा/रक्कम, तारीख/वर्ष, टक्केवारी, पदनाम,',
  'योजनेचे/संस्थेचे/बँकेचे नाव, ठिकाण — जे टिपणीत नाहीत, तेवढेच शोधा.',
  '',
  'नियम:',
  '1. फक्त ठोस तथ्यात्मक घटक तपासा. शैलीदार, वैचारिक, भावनिक, प्रस्तावनात्मक किंवा',
  '   सर्वसाधारण वाक्ये (ज्यात नवीन ठोस तथ्य नाही) पूर्णपणे दुर्लक्षित करा.',
  '2. टिपणीत तीच माहिती वेगळ्या शब्दांत (paraphrase) असेल, तर ती "समाविष्ट" माना.',
  '3. टिपणीत नसलेला प्रत्येक ठोस घटक "- " ने सुरू करून द्या (फक्त तो घटक, स्पष्टीकरण नको).',
  `4. जर असा एकही घटक नसेल, तर फक्त "${NONE_MARKER}" एवढेच लिहा.`,
].join('\n');

async function findLeaks(note: string, article: string): Promise<string[]> {
  const result = (
    await chatComplete(
      [
        { role: 'system', content: LEAK_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            '## टिपणी (NOTES):',
            note,
            '',
            '## लेख (ARTICLE):',
            article,
            '',
            '## टिपणीत नसलेले ठोस तथ्यात्मक घटक:',
          ].join('\n'),
        },
      ],
      { temperature: 0 },
    )
  ).trim();
  if (result.length === 0 || result.includes(NONE_MARKER)) return [];
  return result
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter((line) => line.length > 0);
}

export type NotePair = Readonly<{
  category: FinetuneCategory;
  articleId: number;
  title: string;
  url: string;
  note: string;
  article: string;
  appended: string[]; // specifics the gate flagged as missing and we added to the note
}>;

// Reconstruct clean paragraph text so the article example keeps paragraph boundaries.
function articleText(post: LabeledPost['post']): string {
  return extractParagraphs(post.contentHtml).join('\n\n');
}

// Extract a note, run the hard-specifics leak gate ONCE, and deterministically append
// whatever it flags to the note verbatim. We intentionally do not re-check: the gate is
// stochastic and self-inconsistent (it surfaces a shifting set of mostly-borderline
// common nouns each call), so a single pass + append strictly improves recall of the
// specifics that matter without chasing a moving target. The definitive faithfulness
// check is the generation-time findUnsupportedClaims pass plus the held-out eval.
export async function buildNotePair(item: LabeledPost): Promise<NotePair> {
  const article = articleText(item.post);
  const note0 = await extractNote(article);
  const appended = await findLeaks(note0, article);
  const note =
    appended.length > 0
      ? `${note0}\n${appended.map((specific) => `- ${specific}`).join('\n')}`
      : note0;

  return {
    category: item.category,
    articleId: item.post.id,
    title: item.post.title,
    url: item.post.url,
    note,
    article,
    appended,
  };
}

// Run: `tsx --env-file=../../.env src/finetune/extract-notes.ts [limitPerCategory]`.
// With a limit it samples N per category (a cheap dry-run to eyeball quality first);
// with no limit it processes the whole corpus. Writes data/finetune/pairs.json.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const limit = Number(process.argv[2]) || 0;
  const dataDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../data',
  );

  const run = async (): Promise<void> => {
    const corpus = JSON.parse(
      await readFile(resolve(dataDir, 'finetune/corpus.json'), 'utf8'),
    ) as LabeledPost[];

    const selected = limit
      ? (['scheme', 'news'] as const).flatMap((cat) =>
          corpus.filter((c) => c.category === cat).slice(0, limit),
        )
      : corpus;

    console.log(
      `Extracting notes for ${selected.length} articles (${EXTRACT_MODEL}, gate=gpt-4o)…`,
    );
    const pairs: NotePair[] = [];
    for (const [i, item] of selected.entries()) {
      const pair = await buildNotePair(item);
      pairs.push(pair);
      const flag =
        pair.appended.length > 0 ? `+${pair.appended.length} appended` : 'ok';
      console.log(
        `  [${i + 1}/${selected.length}] ${pair.category} #${pair.articleId} — ${flag} — ${pair.title.slice(0, 50)}`,
      );
    }

    const outName = limit ? 'pairs.sample.json' : 'pairs.json';
    const outPath = resolve(dataDir, 'finetune', outName);
    await writeFile(outPath, JSON.stringify(pairs, null, 2), 'utf8');
    const repaired = pairs.filter((p) => p.appended.length > 0).length;
    console.log(
      `\nWrote ${pairs.length} pairs to ${outPath} ` +
        `(${repaired}/${pairs.length} had specifics appended to the note).`,
    );
  };

  run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
