// Free harness for lib/extractedText — the HTML→prose conversion every uploaded document's
// text now passes through on its way to a model.
//
//   npx tsx --tsconfig apps/web/tsconfig.check.json apps/web/lib/extractedText.check.ts
//
// It exists because the failure it guards against is SILENT and expensive: the string this
// produces is what /translate sends to Sarvam and what /proofread sends to OpenAI, and
// markup reaching either one is paid for and comes back in the officer's output. Nothing
// here calls a model or touches the network.
//
// The HTML fixtures below are the shapes Sarvam Document AI's Digitise actually returns
// (`output_format=html`) — a page wrapper, headings, paragraphs, a table, and the entities
// an OCR'd government form is full of.

import { extractedPlainText, isExtractedHtml } from './extractedText';

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error(
      `FAIL ${label}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`,
    );
  }
}

function checkContains(label: string, haystack: string, needle: string): void {
  checks += 1;
  if (!haystack.includes(needle)) {
    failures += 1;
    console.error(
      `FAIL ${label}\n  missing ${JSON.stringify(needle)}\n  in      ${JSON.stringify(haystack)}`,
    );
  }
}

function checkAbsent(label: string, haystack: string, needle: string): void {
  checks += 1;
  if (haystack.includes(needle)) {
    failures += 1;
    console.error(
      `FAIL ${label}\n  found ${JSON.stringify(needle)} in ${JSON.stringify(haystack)}`,
    );
  }
}

// ---------- what counts as HTML ----------

check(
  'plain Marathi is not HTML',
  isExtractedHtml('शासन निर्णय क्रमांक २०२६'),
  false,
);
check(
  'a Markdown table is not HTML',
  isExtractedHtml('| जिल्हा | रक्कम |\n| --- | --- |\n| पुणे | ५०० |'),
  false,
);
check(
  'a Sarvam page wrapper is HTML',
  isExtractedHtml('<div class="page-body-container"><p>अ</p></div>'),
  true,
);

// ---------- prose is never touched ----------

const prose =
  'मुंबई, दि. ५ : राज्य शासनाने ५०० कोटींची तरतूद केली आहे.\n\nदुसरा परिच्छेद.';
check('plain text returns byte-identical', extractedPlainText(prose), prose);
check(
  'a Markdown table survives unchanged',
  extractedPlainText('| जिल्हा | रक्कम |\n| --- | --- |\n| पुणे | ५०० |'),
  '| जिल्हा | रक्कम |\n| --- | --- |\n| पुणे | ५०० |',
);
check('empty in, empty out', extractedPlainText(''), '');

// ---------- a real page ----------

const page = `<div class="page-body-container">
  <h1>शासन निर्णय</h1>
  <p>महाराष्ट्र शासनाने <strong>५०० कोटी</strong> रुपयांची तरतूद केली आहे.</p>
  <p>अर्ज करण्याची अंतिम मुदत ३१ ऑगस्ट २०२६ आहे.</p>
</div>`;
const pageText = extractedPlainText(page);
check(
  'a page becomes its paragraphs',
  pageText,
  'शासन निर्णय\n\nमहाराष्ट्र शासनाने ५०० कोटी रुपयांची तरतूद केली आहे.\n\nअर्ज करण्याची अंतिम मुदत ३१ ऑगस्ट २०२६ आहे.',
);
checkAbsent('no tag survives', pageText, '<');
checkAbsent('no class attribute survives', pageText, 'page-body-container');

// An inline tag must NOT break the sentence it sits inside — a Marathi clause split in two
// is a worse input than the markup was.
check(
  'inline tags do not break a sentence',
  extractedPlainText(
    '<p>मुख्यमंत्री <strong>देवेंद्र फडणवीस</strong> यांनी सांगितले.</p>',
  ),
  'मुख्यमंत्री देवेंद्र फडणवीस यांनी सांगितले.',
);

// ---------- tables ----------

const table = `<table><thead><tr><th>जिल्हा</th><th>रक्कम</th></tr></thead>
<tbody><tr><td>पुणे</td><td>५०० कोटी</td></tr><tr><td>नागपूर</td><td>२५० कोटी</td></tr></tbody></table>`;
check(
  'a table keeps its rows and columns',
  extractedPlainText(table),
  'जिल्हा | रक्कम\nपुणे | ५०० कोटी\nनागपूर | २५० कोटी',
);

// ---------- lists, breaks, rules ----------

check(
  'list items are one per line',
  extractedPlainText('<ul><li>पहिला मुद्दा</li><li>दुसरा मुद्दा</li></ul>'),
  'पहिला मुद्दा\nदुसरा मुद्दा',
);
check(
  'a <br> ends its line',
  extractedPlainText('<p>पत्ता:<br>मंत्रालय, मुंबई</p>'),
  'पत्ता:\nमंत्रालय, मुंबई',
);

// ---------- entities ----------

const entities = extractedPlainText(
  '<p>अ&nbsp;ब &amp; क &#8377;५०० &#x0930; &lt;टीप&gt; &quot;अवतरण&quot;</p>',
);
checkContains('numeric entity decoded', entities, '₹५००');
checkContains('hex entity decoded', entities, 'र');
checkContains('named entity decoded', entities, 'ब & क');
checkContains('angle brackets decoded as text', entities, '<टीप>');
checkAbsent('no raw entity survives', entities, '&nbsp;');

// ---------- what must never leak ----------

check(
  'script bodies are dropped whole',
  extractedPlainText(
    '<div><script>var a = "translate me";</script><p>मजकूर</p></div>',
  ),
  'मजकूर',
);
check(
  'style bodies are dropped whole',
  extractedPlainText(
    '<div><style>.page { color: red; }</style><p>मजकूर</p></div>',
  ),
  'मजकूर',
);
check(
  'a comment is dropped',
  extractedPlainText('<p>अ</p><!-- page 3 of 12 --><p>ब</p>'),
  'अ\n\nब',
);

// ---------- shapes that must not throw ----------

check(
  'an unclosed tag does not swallow the page',
  extractedPlainText('<p>मजकूर</p><div class="x'),
  'मजकूर',
);
check(
  'a bare < is content, not a tag',
  extractedPlainText('<p>५ < १० आहे</p>'),
  '५ < १० आहे',
);
check(
  'blank lines never pile up',
  extractedPlainText(
    '<div><div><div><p>अ</p></div></div></div><div></div><p>ब</p>',
  ),
  'अ\n\nब',
);

console.log(
  failures === 0
    ? `extractedText: ${checks}/${checks} checks passed`
    : `extractedText: ${failures} of ${checks} checks FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
