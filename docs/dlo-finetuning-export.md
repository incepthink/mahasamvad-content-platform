# Export a DLO example for Qwen SFT

From the repository root, with the existing `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in `.env`:

```sh
pnpm finetune:export <generation-uuid>
```

On Windows PowerShell, use `pnpm.cmd` if script execution policy blocks `pnpm`.
This reads the database and writes local files only. It does not call a model,
upload a dataset, modify a database row, or start training.

The default output directory is `packages/content-engine/data/finetune/dlo/`,
which is already gitignored. Each generation produces:

- `<id>.jsonl`: one training example with `system`, `user`, and `assistant` messages.
- `<id>.review.json`: provenance, warnings and article feedback, kept outside training text.

The JSONL uses the conversational `messages` format described in the
[TRL dataset documentation](https://github.com/huggingface/trl/blob/main/docs/source/dataset_formats.md).
Use the deployed Qwen model's tokenizer/chat template in your training pipeline;
the exporter does not insert model-specific tokens or fabricate thinking traces.
The trainer and loss masking configuration are separate from this export.

## What is paired

The input includes all available original source text: `dlo_intakes.notes`, each
file's stored transcript/text and PDF page text. It then separately labels
`generations.note`, the reviewed source saved when this article was requested.
Reviewed corrections take precedence over original transcription errors. The
intake is its current database snapshot; earlier source edits cannot be recovered
when they were not versioned. Raw recordings/images/PDFs are not text datasets.

All saved officer inputs are included: headline/angle, instructions, reviewed
name/designation pairs, pasted style reference, legacy selected facts, statements,
exclusions, and every article-feedback prompt in chronological order. Style
references are explicitly separated from factual sources. Earlier drafts supply
context for relative feedback such as “change the second paragraph”; they appear
inside the user message, not as additional assistant training targets. The final
article itself is not copied into the input as draft context.

The assistant target is exactly `generations.article`, the latest saved Marathi
article, including saved revisions. Translations, posters, fact-check appendices
and older drafts are not targets. The system instruction and main input sections
reuse the current DLO prompt builder. “All prompts” means all saved **officer**
instructions and feedback, not historical internal system/model prompts or
automatically retrieved RAG exemplars, which are not fully stored.

Completed does **not** mean human-approved. Review each source/answer pair before
including it in training. Feedback is also indexed in the review file. If an
earlier draft is missing, the exporter flags that gap because relative editing
instructions may no longer have enough context. It does not invent missing text.

## Native PDFs/images or corrected source text

Some newer DLO runs send original documents directly to OpenAI. Their database
note does not contain those documents. The exporter refuses these incomplete
text pairs unless you supply a UTF-8 file containing **all** source information:
original document contents, typed note, transcripts and reviewed factual corrections.
The file replaces the entire source-information section; it is not appended to it.
Officer instructions, feedback and other saved controls are still taken from the database.

```sh
pnpm finetune:export <generation-uuid> --source-file ./complete-source.txt --out ./packages/content-engine/data/finetune/reviewed
```

Paths are relative to the directory where you invoke the command. Existing files
are never overwritten; use a new output directory for a revised export. Keep
custom export directories and source files out of version control too.

Runs must be completed DLO news/scheme articles with a readable linked intake.
Empty pairs, identical source/answer pairs, and provided-article runs are rejected.
The exporter does not perform automatic factual verification or token truncation.

To build a larger dataset, run the command for each chosen generation and combine
only the reviewed `.jsonl` files. Each UUID has its own file so repeated exports do
not silently append duplicates. Before splitting train/evaluation sets, group
related generations by intake/thread and deduplicate source/answer content; UUIDs
alone do not identify independent examples. Do not put alternate versions of the
same source in both training and evaluation.
