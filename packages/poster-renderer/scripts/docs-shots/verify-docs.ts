// Structural lint for the GitBook user guide: every SUMMARY.md entry must resolve
// to a chapter file, every image link in every chapter must resolve to an asset,
// and unreferenced assets are reported (as warnings — they may be pending prose).

import fs from 'node:fs';
import path from 'node:path';
import { OUT_DIR, REPO_ROOT } from './config.js';

const DOCS_DIR = path.join(REPO_ROOT, 'docs', 'user-guide');

export function verifyDocs(): void {
  const problems: string[] = [];

  const summaryPath = path.join(DOCS_DIR, 'SUMMARY.md');
  if (!fs.existsSync(summaryPath)) {
    console.error('SUMMARY.md missing — nothing to verify.');
    process.exitCode = 1;
    return;
  }
  const summary = fs.readFileSync(summaryPath, 'utf8');
  const chapterLinks = [...summary.matchAll(/\]\(([^)]+\.md)\)/g)].map(
    (m) => m[1]!,
  );
  for (const link of chapterLinks) {
    if (!fs.existsSync(path.join(DOCS_DIR, link))) {
      problems.push(`SUMMARY.md -> missing chapter: ${link}`);
    }
  }

  const referenced = new Set<string>();
  const mdFiles = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith('.md'));
  for (const md of mdFiles) {
    const text = fs.readFileSync(path.join(DOCS_DIR, md), 'utf8');
    for (const match of text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = decodeURI(match[1]!.trim());
      referenced.add(path.basename(target));
      if (!fs.existsSync(path.join(DOCS_DIR, target))) {
        problems.push(`${md} -> missing image: ${target}`);
      }
    }
  }

  const orphans = fs.existsSync(OUT_DIR)
    ? fs
        .readdirSync(OUT_DIR)
        .filter((f) => f.endsWith('.png') && !referenced.has(f))
    : [];

  console.log(
    `chapters in SUMMARY: ${chapterLinks.length}; markdown files: ${mdFiles.length}; images referenced: ${referenced.size}`,
  );
  if (orphans.length > 0) {
    console.log(`\nUnreferenced assets (${orphans.length}):`);
    for (const orphan of orphans) console.log(`  ? ${orphan}`);
  }
  if (problems.length > 0) {
    console.error(`\nProblems (${problems.length}):`);
    for (const problem of problems) console.error(`  ! ${problem}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll SUMMARY entries and image links resolve.');
  }
}
