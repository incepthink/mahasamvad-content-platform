// Plain-text uploads. The trivial backend of the three, and deliberately so: a .txt
// already IS its own text layer, so there is nothing to decode, nothing to bill and no
// quality gate to run.
//
// One thing it must NOT do is call unwrapSoftLineBreaks. That exists to undo the hard
// line wrapping a PDF's layout imposes on a sentence ("संवाद\nवारी"); a .txt was typed by
// a person, so its line breaks are the author's and rewrapping them would silently edit
// the document.

export function extractTextFile(name: string, data: Buffer): string {
  const text = data
    .toString('utf8')
    // A BOM survives the decode as U+FEFF and would otherwise sit invisibly at the head
    // of the first word — enough to break a glossary name match on the very first line.
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!text) {
    throw new Error(`${name}: या फाईलमध्ये मजकूर आढळला नाही.`);
  }
  return text;
}
