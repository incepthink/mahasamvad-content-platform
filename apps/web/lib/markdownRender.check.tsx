// Assertions for MarkdownText + markdownTable. Free — no API, no model, no browser.
//
//   npx tsx --tsconfig apps/web/tsconfig.check.json apps/web/lib/markdownRender.check.tsx
//
// (from a workspace that has tsx — packages/content-engine does. The extra tsconfig is
// there because the app's own sets `jsx: preserve`, which leaves a standalone runner with
// no JSX factory.)
//
// Every case here is a shape a real answer arrived in. The one that prompted the file is the
// storyboard TABLE: /chat printed it as a screenful of literal `|` characters, and "look at
// the page" is exactly the check that does not get run. Rendering to static markup and
// asserting on the tags is the cheapest thing that would have caught it.
//
// In its own file (rather than behind a `--check` flag inside the component) so nothing in
// the Next bundle can ever reach `process` — the referenceSearch.check.ts precedent.

import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownText } from '../components/MarkdownText';
import { readTableRun, splitTableRow } from './markdownTable';

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail?: string): void {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

function render(text: string): string {
  return renderToStaticMarkup(<MarkdownText text={text} />);
}

function has(text: string, needle: string): boolean {
  return render(text).includes(needle);
}

// ---------- the reported bug: a Marathi storyboard table ----------

const STORYBOARD = [
  '## स्टोरीबोर्ड',
  '',
  '| सीन | वेळ | व्हिज्युअल | व्हॉइसओव्हर |',
  '|---|---|---|---|',
  '| 1 | 0–4 सेकंद | एसटी बस स्थानकाचा वाइड शॉट | **एसटी प्रवाशांसाठी महत्त्वाची बातमी!** |',
  '| 2 | 4–9 सेकंद | NCMC स्मार्ट कार्डचा क्लोज-अप | मुदतवाढ देण्यात आली आहे. |',
  '',
  'शेवटी माहिती ग्राफिक.',
].join('\n');

const storyboard = render(STORYBOARD);
check('a pipe table renders a <table>', storyboard.includes('<table'));
check(
  'its divider row is not printed as a cell',
  !storyboard.includes('---'),
  storyboard.slice(0, 200),
);
check(
  'the header row becomes <th>',
  storyboard.includes('<th scope="col">सीन</th>'),
);
check('a body cell becomes <td>', storyboard.includes('<td>0–4 सेकंद</td>'));
check(
  'inline markup inside a cell still renders',
  storyboard.includes('<strong>एसटी प्रवाशांसाठी महत्त्वाची बातमी!</strong>'),
);
check('no literal pipe survives the table', !storyboard.includes('| सीन |'));
check(
  'the heading above it is still a heading',
  storyboard.includes('<h2>स्टोरीबोर्ड</h2>'),
);
check(
  'the paragraph after it is still a paragraph',
  storyboard.includes('<p>शेवटी माहिती ग्राफिक.</p>'),
);
check(
  'the table scrolls inside its own box',
  storyboard.includes('class="markdown-table-wrap"'),
);

// A headerless table — what an OCR read of a printed grid looks like.
check(
  'a divider-less run of rows is still a table',
  has('| अ | ब |\n| क | ड |', '<td>क</td>'),
);
check(
  'a headerless table has no <thead>',
  !has('| अ | ब |\n| क | ड |', '<thead>'),
);
check(
  'a short row is padded, not dropped',
  has('| a | b | c |\n| --- | --- | --- |\n| x |', '<td></td><td></td>'),
);

// One prose line that happens to be wrapped in pipes is prose.
check(
  'a lone pipe-wrapped line stays a paragraph',
  has('| हे टेबल नाही |', '<p>| हे टेबल नाही |</p>'),
);
check(
  'and it does not split the paragraph around it',
  render('आधी\n| मध्ये |\nनंतर').split('<p>').length === 2,
);

// ---------- fenced code ----------

const FENCED = [
  'काही मजकूर',
  '',
  '```json',
  '{ "a": 1 }',
  '# not a heading',
  '```',
  '',
  'नंतर',
].join('\n');
check('a fence renders <pre><code>', has(FENCED, '<pre><code>'));
check('the backticks themselves are gone', !render(FENCED).includes('```'));
check(
  'a # inside a fence is not a heading',
  render(FENCED).includes('# not a heading'),
);
check('text after the fence still renders', has(FENCED, '<p>नंतर</p>'));
check(
  'an unterminated fence (mid-stream) still renders',
  has('```\nहोत आहे', '<pre><code>होत आहे</code></pre>'),
);

// ---------- lists ----------

const NESTED = ['- पहिला', '  - आतील एक', '  - आतील दोन', '- दुसरा'].join('\n');
check('a nested list nests', has(NESTED, '<li>पहिला<ul>'));
check(
  'the nested items are inside it',
  has(NESTED, '<ul><li>आतील एक</li><li>आतील दोन</li></ul>'),
);
check('and the sibling stays at the top level', has(NESTED, '<li>दुसरा</li>'));

const LOOSE = ['1. एक', '', '2. दोन', '', '3. तीन'].join('\n');
check(
  'a loose numbered list is ONE list, not three',
  render(LOOSE).split('<ol').length === 2,
  render(LOOSE),
);
check(
  'so its numbering does not restart',
  render(LOOSE).split('<li>').length === 4,
);

check(
  'a list that does not start at 1 keeps its number',
  has('6. सहावा\n7. सातवा', '<ol start="6">'),
);
check(
  'a list that starts at 1 sends no start attribute',
  !has('1. एक\n2. दोन', 'start='),
);
check(
  'a bullet list under a numbered one is its own list',
  has('1. एक\n- अ', '</ol><ul>'),
);
check(
  'a paragraph after a list ends the list',
  has('- एक\nसाधा मजकूर', '</ul><p>साधा मजकूर</p>'),
);

// ---------- inline ----------

check('__bold__ renders', has('__ठळक__', '<strong>ठळक</strong>'));
check('~~struck~~ renders', has('~~कापलेले~~', '<del>कापलेले</del>'));
check('**bold** still renders', has('**ठळक**', '<strong>ठळक</strong>'));
check('*italic* still renders', has('*तिरपे*', '<em>तिरपे</em>'));
check('`code` still renders', has('`कोड`', '<code>कोड</code>'));
check(
  'an http link still renders',
  has('[दुवा](https://example.com)', 'href="https://example.com"'),
);
check(
  'a javascript: URL is still stripped to its label',
  !has('[x](javascript:alert(1))', 'href='),
);

// ---------- unchanged article behaviour ----------

check('# heading still renders', has('# शीर्षक', '<h1>शीर्षक</h1>'));
check('a closing ### is trimmed', has('## शीर्षक ##', '<h2>शीर्षक</h2>'));
check('a thematic break still renders', has('---', '<hr/>'));
check(
  'a blockquote still renders',
  has('> उद्धृत', '<blockquote><p>उद्धृत</p></blockquote>'),
);
check(
  'a list inside a blockquote renders as a list',
  has('> - एक\n> - दोन', '<blockquote><ul>'),
);
check(
  'a soft line break inside a paragraph is kept',
  has('ओळ एक\nओळ दोन', '<br/>'),
);
check(
  'empty input renders nothing',
  render('') === '<div class="markdown-body"></div>',
);
check(
  'a className is appended, not replaced',
  render('अ').includes('class="markdown-body'),
);

// ---------- the shared parser, directly ----------

check(
  'splitTableRow drops the outer pipes only',
  JSON.stringify(splitTableRow('| a | b|c |')) ===
    JSON.stringify(['a', 'b', 'c']),
);
check('readTableRun refuses a single row', readTableRun(['| a |'], 0) === null);
check(
  'readTableRun reports where the run ended',
  readTableRun(['| a |', '| b |', 'नंतर'], 0)?.next === 2,
);
check(
  'readTableRun counts the widest row',
  readTableRun(['| a | b | c |', '| x |'], 0)?.columns === 3,
);

console.log(`\n${checks - failures}/${checks} passed.`);
process.exitCode = failures > 0 ? 1 : 0;
