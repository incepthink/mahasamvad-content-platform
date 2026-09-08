// Read-only DB export. No model calls, synthetic notes, uploads, or training jobs.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  createServiceRoleClient,
  getDloIntake,
  getGeneration,
  listRevisions,
  type DloIntakeRow,
  type GenerationRow,
  type RevisionRow,
} from '@dgipr/database';
import { NameDesignationsSchema } from '@dgipr/schemas';
import { buildDloArticleMessages } from '../generation/dlo-article-prompt.js';

const DEFAULT_OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../data/finetune/dlo',
);

export function buildDloTrainingExample(
  row: GenerationRow,
  intake: DloIntakeRow | null,
  revisions: readonly RevisionRow[],
  sourceOverride?: string,
) {
  if (!row.dloIntakeId)
    throw new Error('This generation is not linked to a DLO intake.');
  if (!intake || intake.id !== row.dloIntakeId) {
    throw new Error(
      'DLO intake is missing; cannot verify the source documents.',
    );
  }
  if (row.status !== 'completed')
    throw new Error('Generation must be completed before export.');
  if (
    !['news', 'scheme'].includes(row.category) ||
    row.outputType === 'poster'
  ) {
    throw new Error('Only DLO news/scheme articles can be exported.');
  }
  if (row.articleProvided)
    throw new Error(
      'Provided-article runs are not source-to-article examples.',
    );
  if (!row.article?.trim())
    throw new Error('Generation has no saved Marathi article.');

  const nativeFiles = intake.files.filter(
    (file) => file.openaiFileId && file.status === 'done',
  );
  if (nativeFiles.length > 0 && sourceOverride === undefined) {
    throw new Error(
      'This run used native document/image inputs that are not fully stored in generations.note. ' +
        'Supply --source-file with the complete reviewed source text (including the note and document contents).',
    );
  }
  const source = sourceOverride ?? row.note;
  if (!source.trim()) throw new Error('Source text is empty.');
  if (source.trim() === row.article.trim())
    throw new Error(
      'Source and article are identical; refusing a copy-only example.',
    );

  const originalSources = [
    ...(intake.notes?.trim()
      ? [{ name: 'Original officer note', text: intake.notes }]
      : []),
    ...intake.files.flatMap((file) => [
      ...(file.text?.trim() ? [{ name: file.name, text: file.text }] : []),
      ...(file.pages ?? [])
        .filter((page) => page.text.trim())
        .map((page) => ({
          name: `${file.name} — page ${page.page}`,
          text: page.text,
        })),
    ]),
  ];
  const sourceInformation =
    sourceOverride !== undefined
      ? sourceOverride
      : [
          'Original source text is followed by the saved reviewed source. Where the officer corrected a transcription or spelling, use the reviewed source.',
          ...originalSources.map((item) => `#### ${item.name}\n\n${item.text}`),
          `#### SAVED REVIEWED SOURCE\n\n${row.note}`,
        ].join('\n\n');

  // A current task instruction plus all stored officer inputs, not historical model prompts.
  const messages = buildDloArticleMessages({
    sourceInformation,
    heading: row.heading,
    officerInstructions: row.instructions,
    designations: NameDesignationsSchema.parse(row.nameDesignations ?? []),
  });
  let userContent = messages[1]!.content;
  if (row.styleReference?.trim()) {
    userContent +=
      '\n\n### OFFICER-SUPPLIED STYLE REFERENCE\n\n' +
      'Use only for writing style and structure, never as a factual source.\n\n' +
      row.styleReference;
  }
  // Older DLO generations could be controlled by these fields. Do not silently lose them.
  const legacy = {
    selectedFacts: row.selectedFacts,
    statements: row.statements,
    excludedFacts: row.excludedFacts,
  };
  const controls = Object.entries(legacy).filter(([, value]) =>
    Array.isArray(value) ? value.length > 0 : value != null,
  );
  if (controls.length > 0) {
    userContent +=
      '\n\n### REVIEWED EDITORIAL CONTROLS\n\n' +
      JSON.stringify(Object.fromEntries(controls), null, 2);
  }
  const articleRevisions = revisions
    .filter((revision) => revision.target === 'article')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let previousArticle: string | null = null;
  let missingFeedbackContext = false;
  const feedbackContexts: string[] = [];
  for (const revision of articleRevisions) {
    if (revision.feedback?.trim()) {
      if (!previousArticle) missingFeedbackContext = true;
      feedbackContexts.push(
        `#### OFFICER FEEDBACK ${feedbackContexts.length + 1}\n\n` +
          (previousArticle && previousArticle !== row.article
            ? `Earlier draft this feedback refers to (context only, not a factual source):\n\n${previousArticle}\n\n`
            : '') +
          `Officer request:\n\n${revision.feedback}`,
      );
    }
    previousArticle = revision.article ?? previousArticle;
  }
  if (feedbackContexts.length > 0) {
    userContent +=
      '\n\n### OFFICER ARTICLE FEEDBACK, IN CHRONOLOGICAL ORDER\n\n' +
      'Write the final article incorporating these requests. Later officer corrections take precedence over earlier inputs. Earlier drafts are context for edits, not independent factual sources.\n\n' +
      feedbackContexts.join('\n\n');
  }
  messages[1] = { role: 'user', content: userContent };
  messages.push({ role: 'assistant', content: row.article });

  const warnings = [
    'The latest saved article is not an approval signal. Review source fidelity and Marathi quality before training.',
    'Includes stored officer inputs, not historical internal model requests or automatically retrieved style exemplars.',
    'Original intake text is the currently stored snapshot; the database does not version every source edit or retain raw audio/PDF contents as text.',
  ];
  if (missingFeedbackContext) {
    warnings.push(
      'An earlier draft is missing for some feedback. Review relative editing instructions before training.',
    );
  }
  if (sourceOverride !== undefined)
    warnings.push(
      'Source was replaced by the supplied text file; verify that it contains all factual inputs.',
    );
  return {
    example: { messages },
    review: {
      formatVersion: 'dlo-sft-v1',
      generationId: row.id,
      dloIntakeId: row.dloIntakeId,
      threadRootId: row.threadRootId,
      sourceGenerationId: row.sourceGenerationId,
      category: row.category,
      generationUpdatedAt: row.updatedAt,
      sourceField:
        sourceOverride === undefined
          ? 'dlo_intakes.notes + files.text/pages + generations.note'
          : 'source-file',
      targetField: 'generations.article',
      historicalStyleReferenceMeta: row.styleReferenceMeta,
      sourceCharacters: sourceInformation.length,
      originalSourceCount: originalSources.length,
      originalSourceSnapshotUpdatedAt: intake.updatedAt,
      officerFeedbackCount: feedbackContexts.length,
      articleCharacters: row.article.length,
      nativeSourceFileCount: nativeFiles.length,
      approvalStatus: 'needs-review',
      warnings,
      articleFeedback: articleRevisions
        .filter((revision) => revision.feedback?.trim())
        .map((revision) => ({
          revisionId: revision.id,
          createdAt: revision.createdAt,
          feedback: revision.feedback,
        })),
    },
  };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      'source-file': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: pnpm finetune:export <generation-uuid> [--out <directory>] [--source-file <complete-source.txt>]',
    );
    console.log(
      'Writes <id>.jsonl and <id>.review.json. Existing exports are never overwritten.',
    );
    return;
  }
  const [id] = positionals;
  if (
    positionals.length !== 1 ||
    !id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new Error(
      'Provide exactly one valid generation UUID. Use --help for usage.',
    );
  }
  // pnpm --filter changes cwd; resolve user paths relative to the invoking workspace.
  const invocationDir = process.env.INIT_CWD ?? process.cwd();
  const out = values.out ? resolve(invocationDir, values.out) : DEFAULT_OUT;
  const sourceOverride = values['source-file']
    ? (
        await readFile(resolve(invocationDir, values['source-file']), 'utf8')
      ).replace(/^\uFEFF/, '')
    : undefined;
  const client = createServiceRoleClient();
  const row = await getGeneration(client, id);
  if (!row) throw new Error(`Generation ${id} was not found.`);
  const [intake, revisions] = await Promise.all([
    row.dloIntakeId
      ? getDloIntake(client, row.dloIntakeId)
      : Promise.resolve(null),
    listRevisions(client, id),
  ]);
  const result = buildDloTrainingExample(
    row,
    intake,
    revisions,
    sourceOverride,
  );
  // Detect ordinary edits during export rather than pairing a stale row with newer feedback.
  const current = await getGeneration(client, id);
  if (
    !current ||
    current.updatedAt !== row.updatedAt ||
    current.status !== 'completed'
  ) {
    throw new Error(
      'Generation changed during export; retry once editing has finished.',
    );
  }
  await mkdir(out, { recursive: true });
  const stem = resolve(out, id.toLowerCase());
  await writeFile(
    `${stem}.review.json`,
    JSON.stringify(result.review, null, 2) + '\n',
    { encoding: 'utf8', flag: 'wx' },
  );
  await writeFile(`${stem}.jsonl`, JSON.stringify(result.example) + '\n', {
    encoding: 'utf8',
    flag: 'wx',
  });
  console.log(`Exported one example: ${stem}.jsonl`);
  console.log(`Review record: ${stem}.review.json`);
  for (const warning of result.review.warnings)
    console.log(`Review: ${warning}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Export failed.');
    process.exitCode = 1;
  });
}
