import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ChangeSummary,
  CitedSummary,
  ConflictSummary,
  StoredNewsArticle,
  TimelineEntry,
  WhatChangedResult,
} from './types.js';

type Slide = Readonly<{
  eyebrow: string;
  title: string;
  className: string;
  body: string;
}>;

const digitMap: Record<string, string> = {
  '0': '०',
  '1': '१',
  '2': '२',
  '3': '३',
  '4': '४',
  '5': '५',
  '6': '६',
  '7': '७',
  '8': '८',
  '9': '९',
};

function deva(value: number | string): string {
  return String(value).replace(/[0-9]/g, (digit) => digitMap[digit] ?? digit);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const graphemeSegmenter = new Intl.Segmenter('mr', {
  granularity: 'grapheme',
});

function shorten(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  const graphemes = [...graphemeSegmenter.segment(clean)].map(
    (part) => part.segment,
  );
  if (graphemes.length <= max) return clean;
  return `${graphemes
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`;
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : '#';
  } catch {
    return '#';
  }
}

function formatDate(value: string | null): string {
  if (!value) return 'तारीख उपलब्ध नाही';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'तारीख उपलब्ध नाही';
  return new Intl.DateTimeFormat('mr-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

function citationHtml(
  citations: readonly number[],
  sourceNumbers: ReadonlyMap<number, number>,
): string {
  return [
    ...new Set(
      citations
        .map((id) => sourceNumbers.get(id))
        .filter((number): number is number => number !== undefined),
    ),
  ]
    .sort((a, b) => a - b)
    .map(
      (number) =>
        `<a class="cite" href="#source-${number}" aria-label="स्रोत ${deva(
          number,
        )}">${deva(number)}</a>`,
    )
    .join('');
}

function card(
  title: string,
  detail: string,
  citations: readonly number[],
  sourceNumbers: ReadonlyMap<number, number>,
  className = '',
): string {
  return [
    `<article class="card ${className}">`,
    `<div class="card-rule"></div>`,
    `<h3>${escapeHtml(shorten(title, 90))}</h3>`,
    `<p>${escapeHtml(shorten(detail, 310))}</p>`,
    `<div class="citations">${citationHtml(citations, sourceNumbers)}</div>`,
    '</article>',
  ].join('');
}

function changeCard(
  item: ChangeSummary,
  sourceNumbers: ReadonlyMap<number, number>,
): string {
  return [
    '<article class="card change-card">',
    `<div class="label">${escapeHtml(item.label)}</div>`,
    `<h3>${escapeHtml(shorten(item.title, 78))}</h3>`,
    '<div class="comparison">',
    '<div>',
    '<span>आधी</span>',
    `<p>${escapeHtml(shorten(item.before, 170))}</p>`,
    '</div>',
    '<div class="arrow">→</div>',
    '<div>',
    '<span>आता</span>',
    `<p>${escapeHtml(shorten(item.now, 170))}</p>`,
    '</div>',
    '</div>',
    `<p class="explain">${escapeHtml(shorten(item.explanation, 210))}</p>`,
    `<div class="citations">${citationHtml(item.citations, sourceNumbers)}</div>`,
    '</article>',
  ].join('');
}

function conflictCard(
  item: ConflictSummary,
  sourceNumbers: ReadonlyMap<number, number>,
): string {
  return [
    '<article class="card conflict-card">',
    '<div class="label">नोंदवलेली तफावत</div>',
    `<h3>${escapeHtml(shorten(item.title, 80))}</h3>`,
    '<div class="conflict-pair">',
    `<p><span>आधीची नोंद</span>${escapeHtml(shorten(item.earlier, 180))}</p>`,
    `<p><span>नंतरची नोंद</span>${escapeHtml(shorten(item.later, 180))}</p>`,
    '</div>',
    `<div class="status"><strong>स्थिती:</strong> ${escapeHtml(shorten(item.status, 170))}</div>`,
    `<div class="citations">${citationHtml(item.citations, sourceNumbers)}</div>`,
    '</article>',
  ].join('');
}

function timelineCard(
  item: TimelineEntry,
  article: StoredNewsArticle,
  sourceNumbers: ReadonlyMap<number, number>,
): string {
  return [
    '<article class="timeline-item">',
    '<div class="timeline-dot"></div>',
    '<div class="timeline-copy">',
    `<div class="timeline-meta"><time>${escapeHtml(
      formatDate(article.publishedTime),
    )}</time><span>${escapeHtml(item.label)}</span></div>`,
    `<h3>${escapeHtml(shorten(item.title, 90))}</h3>`,
    `<p>${escapeHtml(shorten(item.summary, 220))}</p>`,
    `<div class="citations">${citationHtml(item.citations, sourceNumbers)}</div>`,
    '</div>',
    '</article>',
  ].join('');
}

function emptyState(message: string): string {
  return [
    '<div class="empty-state">',
    '<div class="empty-mark">—</div>',
    `<p>${escapeHtml(message)}</p>`,
    '</div>',
  ].join('');
}

function buildSlides(result: WhatChangedResult): Slide[] {
  const { articles, analysis, subject } = result;
  const sourceNumbers = new Map(
    articles.map((article, index) => [article.articleId, index + 1]),
  );
  const articleById = new Map(
    articles.map((article) => [article.articleId, article]),
  );
  const first = articles[0]!;
  const latest = articles.at(-1)!;
  const slides: Slide[] = [
    {
      eyebrow: 'महासंवाद संग्रहातून · काय बदलले?',
      title: subject,
      className: 'cover',
      body: [
        '<div class="cover-grid">',
        '<div>',
        `<div class="date-span">${escapeHtml(formatDate(first.publishedTime))}<span>ते</span>${escapeHtml(formatDate(latest.publishedTime))}</div>`,
        `<p class="cover-summary">${escapeHtml(shorten(analysis.summary, 360))}</p>`,
        '</div>',
        '<div class="cover-stat">',
        `<strong>${deva(articles.length)}</strong>`,
        '<span>संबंधित संग्रहित लेख</span>',
        '</div>',
        '</div>',
        `<div class="latest-strip"><span>सर्वात नवी नोंद</span><strong>${escapeHtml(shorten(latest.title, 140))}</strong></div>`,
      ].join(''),
    },
    {
      eyebrow: 'सध्याची स्थिती',
      title: analysis.heading,
      className: 'current',
      body: [
        '<div class="current-panel">',
        '<div class="current-number">आता</div>',
        `<h3>${escapeHtml(shorten(analysis.latest.title, 110))}</h3>`,
        `<p>${escapeHtml(shorten(analysis.latest.detail, 520))}</p>`,
        `<div class="citations">${citationHtml(analysis.latest.citations, sourceNumbers)}</div>`,
        '</div>',
        `<div class="as-of">आधार: ${escapeHtml(formatDate(latest.publishedTime))} पर्यंतची संग्रहित माहिती</div>`,
      ].join(''),
    },
  ];

  for (const [index, entries] of chunksOf(analysis.timeline, 4).entries()) {
    slides.push({
      eyebrow: `प्रगतीरेषा · भाग ${deva(index + 1)}`,
      title: 'विषय पुढे कसा सरकला?',
      className: 'timeline',
      body: `<div class="timeline-list">${entries
        .map((entry) => {
          const article = articleById.get(entry.articleId);
          return article ? timelineCard(entry, article, sourceNumbers) : '';
        })
        .join('')}</div>`,
    });
  }

  const changeGroups = chunksOf(analysis.changes, 2);
  if (changeGroups.length === 0) {
    slides.push({
      eyebrow: 'तुलना',
      title: 'काय बदलले?',
      className: 'changes',
      body: emptyState(
        articles.length < 2
          ? 'या विषयावर तुलनेसाठी एकच थेट संबंधित संग्रहित लेख उपलब्ध आहे.'
          : 'उपलब्ध संग्रहित नोंदींमध्ये स्पष्ट आणि पुराव्याने समर्थित बदल आढळला नाही.',
      ),
    });
  } else {
    for (const [index, items] of changeGroups.entries()) {
      slides.push({
        eyebrow:
          changeGroups.length > 1 ? `तुलना · भाग ${deva(index + 1)}` : 'तुलना',
        title: 'काय बदलले?',
        className: 'changes',
        body: `<div class="card-stack">${items
          .map((item) => changeCard(item, sourceNumbers))
          .join('')}</div>`,
      });
    }
  }

  const unchangedGroups = chunksOf(analysis.unchanged, 3);
  if (unchangedGroups.length === 0) {
    slides.push({
      eyebrow: 'सातत्य',
      title: 'काय तसेच आहे?',
      className: 'unchanged',
      body: emptyState(
        articles.length < 2
          ? 'एकच संबंधित नोंद असल्यामुळे सातत्याची स्वतंत्र पडताळणी करता येत नाही.'
          : 'सर्वात नव्या लेखात आधीची बाब स्पष्टपणे पुन्हा नोंदलेली नसल्यामुळे येथे अंदाज दिलेला नाही.',
      ),
    });
  } else {
    for (const [index, items] of unchangedGroups.entries()) {
      slides.push({
        eyebrow:
          unchangedGroups.length > 1
            ? `सातत्य · भाग ${deva(index + 1)}`
            : 'सातत्य',
        title: 'काय तसेच आहे?',
        className: 'unchanged',
        body: `<div class="card-stack compact">${items
          .map((item) =>
            card(item.title, item.detail, item.citations, sourceNumbers),
          )
          .join('')}</div>`,
      });
    }
  }

  for (const [index, items] of chunksOf(analysis.conflicts, 2).entries()) {
    slides.push({
      eyebrow:
        analysis.conflicts.length > 2
          ? `पडताळणी · भाग ${deva(index + 1)}`
          : 'पडताळणी',
      title: 'नोंदी कुठे जुळत नाहीत?',
      className: 'conflicts',
      body: `<div class="card-stack">${items
        .map((item) => conflictCard(item, sourceNumbers))
        .join('')}</div>`,
    });
  }

  const nextGroups =
    analysis.nextSteps.length > 0
      ? chunksOf(analysis.nextSteps, 3)
      : [[] as CitedSummary[]];
  for (const [index, items] of nextGroups.entries()) {
    slides.push({
      eyebrow:
        nextGroups.length > 1
          ? `अधिकृत पुढील दिशा · भाग ${deva(index + 1)}`
          : 'अधिकृत पुढील दिशा',
      title: 'पुढे काय?',
      className: 'next',
      body:
        items.length === 0
          ? emptyState(
              'पुढील टप्प्याबाबत उपलब्ध लेखांमध्ये अधिकृत माहिती नाही. त्यामुळे येथे अंदाज किंवा भाकीत दिलेले नाही.',
            )
          : `<div class="card-stack compact">${items
              .map((item, itemIndex) =>
                card(
                  `${deva(itemIndex + 1)}. ${item.title}`,
                  item.detail,
                  item.citations,
                  sourceNumbers,
                  'next-card',
                ),
              )
              .join('')}</div>`,
    });
  }

  for (const [index, sources] of chunksOf(articles, 5).entries()) {
    slides.push({
      eyebrow:
        articles.length > 5 ? `पुरावे · भाग ${deva(index + 1)}` : 'पुरावे',
      title: 'वापरलेले संग्रहित लेख',
      className: 'sources',
      body: [
        '<div class="source-list">',
        ...sources.map((article) => {
          const number = sourceNumbers.get(article.articleId)!;
          return [
            `<article class="source" id="source-${number}">`,
            `<div class="source-number">${deva(number)}</div>`,
            '<div>',
            `<time>${escapeHtml(formatDate(article.publishedTime))}</time>`,
            `<h3>${escapeHtml(shorten(article.title, 120))}</h3>`,
            `<a href="${escapeHtml(safeUrl(article.url))}" target="_blank" rel="noreferrer">मूळ लेख उघडा ↗</a>`,
            '</div>',
            '</article>',
          ].join('');
        }),
        '</div>',
        `<div class="method-note"><strong>पद्धत:</strong> ${deva(
          result.scannedArticleCount,
        )} संग्रहित वृत्तलेख तपासले; ${deva(
          result.candidateCount,
        )} संभाव्य जुळण्या पडताळल्या; ${deva(
          articles.length,
        )} थेट संबंधित लेख या विश्लेषणात वापरले.</div>`,
      ].join(''),
    });
  }

  return slides;
}

// The scroll view is SCREEN-ONLY on purpose. The base rules below keep the fixed
// 1080x1350 poster geometry, which is what `slides/NN.html` and the print output
// still are — so this block must never leak into `@media print`.
const SCROLL_CSS = `
@media screen{
  .scroll .toolbar{flex-direction:column;gap:0;padding:0;justify-content:flex-start}
  .toolbar-inner{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;max-width:1000px;padding:11px 16px}
  .toolbar-title{overflow:hidden;font-size:16px;text-overflow:ellipsis;white-space:nowrap}
  .toolbar-actions{display:flex;flex:none;align-items:center;gap:10px}
  .scroll .toolbar button{padding:7px 14px;font-size:14px}
  .toc-wrap{position:relative}
  .toc-wrap>summary{list-style:none;border:1px solid rgba(255,255,255,.28);border-radius:999px;padding:7px 14px;font:600 14px "Nirmala UI","Mangal",sans-serif;cursor:pointer}
  .toc-wrap>summary::-webkit-details-marker{display:none}
  .toc-wrap[open]>summary,.toc-wrap>summary:hover{background:white;color:var(--navy)}
  .toc{position:absolute;right:0;top:calc(100% + 10px);z-index:60;display:grid;gap:2px;width:max-content;max-width:min(78vw,420px);max-height:min(60vh,460px);overflow:auto;padding:8px;background:var(--white);border-radius:10px;box-shadow:0 16px 40px rgba(8,36,61,.32)}
  .toc a{display:block;padding:9px 12px;border-radius:6px;color:var(--ink);font-size:15px;font-weight:600;text-decoration:none}
  .toc a:hover{background:rgba(8,36,61,.08);color:var(--navy)}
  .progress{width:100%;height:3px;background:rgba(255,255,255,.16)}
  .progress span{display:block;width:0;height:100%;background:var(--gold)}
  .scroll .deck{display:block;padding:clamp(16px,3vw,30px) clamp(12px,3vw,26px) 90px}
  .scroll .slide{display:block;width:100%;max-width:960px;height:auto;margin:0 auto;padding:clamp(26px,4.4vw,62px) clamp(20px,4vw,58px) clamp(24px,3.4vw,44px);box-shadow:0 10px 34px rgba(8,36,61,.14);scroll-margin-top:76px}
  .scroll .slide+.slide{margin-top:clamp(18px,2.6vw,32px)}
  .scroll .slide::after{display:none}
  .scroll .eyebrow{min-height:0;margin-bottom:clamp(14px,1.8vw,22px);font-size:clamp(13px,1.6vw,17px)}
  .scroll .slide>h2{max-width:none;margin-bottom:clamp(20px,2.6vw,32px);font-size:clamp(26px,4.4vw,46px);letter-spacing:-.5px}
  .scroll .slide-footer{position:static;margin-top:clamp(22px,3vw,36px);font-size:14px}
  .scroll .cover .eyebrow{margin-top:0}
  .scroll .cover>h2{max-width:none;margin-top:0;font-size:clamp(34px,7vw,72px)}
  .scroll .cover-grid{gap:clamp(20px,3vw,40px);margin-top:clamp(24px,3vw,44px)}
  .scroll .date-span{font-size:clamp(14px,1.7vw,18px)}
  .scroll .cover-summary{max-width:none;font-size:clamp(17px,2.4vw,26px)}
  .scroll .cover-stat{padding-left:clamp(20px,2.6vw,36px)}
  .scroll .cover-stat strong{font-size:clamp(42px,6.4vw,72px)}
  .scroll .cover-stat span{font-size:clamp(13px,1.6vw,17px)}
  .scroll .latest-strip{position:static;margin-top:clamp(24px,3vw,38px)}
  .scroll .latest-strip strong{font-size:clamp(16px,2vw,21px)}
  .scroll .current-panel{margin-top:clamp(42px,4.4vw,60px);padding:clamp(34px,4vw,56px) clamp(24px,3.4vw,52px)}
  .scroll .current-panel h3{max-width:none;margin-bottom:clamp(16px,2vw,24px);font-size:clamp(21px,3.2vw,36px)}
  .scroll .current-panel p{font-size:clamp(16px,2.2vw,25px)}
  .scroll .as-of{margin-top:clamp(24px,3vw,40px);padding:clamp(14px,1.8vw,22px) 0 0;font-size:clamp(13px,1.6vw,17px)}
  .scroll .card-stack,.scroll .card-stack.compact{gap:clamp(16px,2vw,26px)}
  .scroll .card{padding:clamp(20px,2.6vw,32px) clamp(22px,2.8vw,36px)}
  .scroll .card h3{margin-bottom:clamp(10px,1.2vw,14px);font-size:clamp(18px,2.4vw,28px)}
  .scroll .card p{font-size:clamp(15px,1.9vw,21px)}
  .scroll .label{font-size:clamp(12px,1.4vw,15px)}
  .scroll .comparison{margin-top:clamp(16px,2vw,22px);padding:clamp(14px,1.8vw,20px)}
  .scroll .comparison span,.scroll .conflict-pair span{font-size:clamp(12px,1.4vw,15px)}
  .scroll .comparison p,.scroll .conflict-pair p{font-size:clamp(14px,1.8vw,19px)}
  .scroll .comparison .arrow{font-size:clamp(20px,2.4vw,28px)}
  .scroll .change-card .explain{margin-top:clamp(14px,1.8vw,20px);font-size:clamp(14px,1.8vw,19px)}
  .scroll .citations{margin-top:clamp(14px,1.6vw,18px)}
  .scroll .cite{width:27px;height:27px;font-size:14px}
  .scroll .timeline-list{gap:clamp(14px,1.8vw,20px)}
  .scroll .timeline-copy{padding:clamp(16px,2vw,22px) clamp(18px,2.2vw,26px)}
  .scroll .timeline-meta{font-size:clamp(12px,1.4vw,16px)}
  .scroll .timeline-copy h3{font-size:clamp(17px,2.1vw,24px)}
  .scroll .timeline-copy p{font-size:clamp(14px,1.8vw,19px)}
  .scroll .status{font-size:clamp(14px,1.8vw,19px)}
  .scroll .empty-state{min-height:0;padding:clamp(34px,5vw,70px) clamp(22px,3vw,50px)}
  .scroll .empty-mark{font-size:clamp(52px,8vw,96px)}
  .scroll .empty-state p{max-width:none;font-size:clamp(16px,2.2vw,26px)}
  .scroll .source{padding:clamp(16px,2vw,22px) clamp(18px,2.2vw,26px);gap:clamp(14px,2vw,22px);grid-template-columns:clamp(40px,5vw,58px) 1fr}
  .scroll .source-number{width:100%;max-width:52px;aspect-ratio:1;height:auto;font-size:clamp(16px,2vw,22px)}
  .scroll .source time{font-size:clamp(12px,1.4vw,16px)}
  .scroll .source h3{font-size:clamp(16px,2vw,22px)}
  .scroll .source a{font-size:clamp(13px,1.5vw,16px)}
  .scroll .method-note{font-size:clamp(13px,1.5vw,17px)}
  @media(max-width:760px){
    .scroll .cover-grid{grid-template-columns:1fr}
    .scroll .cover-stat{border-left:0;border-top:1px solid rgba(255,255,255,.25);padding:20px 0 0}
    .scroll .latest-strip,.scroll .comparison,.scroll .conflict-pair{grid-template-columns:1fr}
    .scroll .comparison .arrow{text-align:left}
    .scroll .current-number{right:auto;left:0;top:-30px}
    .scroll .slide-footer{flex-direction:column;align-items:flex-start;gap:6px}
    .toolbar-title{font-size:14px}
  }
}
`;

const CSS = `
:root{--navy:#08243d;--ink:#122334;--paper:#f5f1e8;--white:#fffefa;--gold:#d99b22;--teal:#16766f;--red:#a94135;--muted:#64717c}
*{box-sizing:border-box}
html{background:#d9dde0;scroll-behavior:smooth}
body{margin:0;color:var(--ink);font-family:"Nirmala UI","Mangal",sans-serif}
.toolbar{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:center;gap:14px;padding:12px;background:rgba(8,36,61,.95);color:white;box-shadow:0 6px 24px rgba(0,0,0,.2)}
.toolbar button,.toolbar a{border:1px solid rgba(255,255,255,.28);border-radius:999px;background:transparent;color:white;padding:8px 18px;font:600 15px "Nirmala UI","Mangal",sans-serif;text-decoration:none;cursor:pointer}
.toolbar button:hover,.toolbar a:hover{background:white;color:var(--navy)}
.deck{display:grid;place-items:center;padding:28px}
.slide{position:relative;display:none;width:1080px;height:1350px;overflow:hidden;background:var(--paper);padding:86px 82px 72px;box-shadow:0 18px 55px rgba(8,36,61,.2);isolation:isolate}
.single .slide{display:block}
.slide::before{content:"";position:absolute;z-index:-1;inset:0;background:linear-gradient(115deg,transparent 0 68%,rgba(217,155,34,.08) 68% 70%,transparent 70%)}
.slide::after{content:"";position:absolute;z-index:-1;width:440px;height:440px;border:1px solid rgba(8,36,61,.08);border-radius:50%;right:-240px;top:-190px;box-shadow:0 0 0 46px rgba(8,36,61,.025),0 0 0 92px rgba(8,36,61,.02)}
.eyebrow{display:inline-flex;align-items:center;min-height:40px;margin-bottom:28px;padding:5px 16px;border-left:6px solid var(--gold);background:rgba(8,36,61,.07);font-size:23px;font-weight:700;letter-spacing:.2px;color:var(--navy)}
.slide>h2{max-width:900px;margin:0 0 42px;font-size:61px;line-height:1.13;letter-spacing:-1.1px;color:var(--navy)}
.slide-footer{position:absolute;left:82px;right:82px;bottom:34px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(8,36,61,.15);padding-top:14px;font-size:17px;font-weight:700;color:var(--muted)}
.slide-footer b{color:var(--navy)}
.cover{background:var(--navy);color:white}
.cover::before{background:linear-gradient(145deg,transparent 0 57%,rgba(217,155,34,.13) 57% 58%,transparent 58%),radial-gradient(circle at 88% 15%,rgba(22,118,111,.7),transparent 33%)}
.cover::after{border-color:rgba(255,255,255,.15);box-shadow:0 0 0 46px rgba(255,255,255,.025),0 0 0 92px rgba(255,255,255,.02)}
.cover .eyebrow{margin-top:48px;background:rgba(255,255,255,.1);color:white}
.cover>h2{max-width:880px;margin-top:32px;font-size:112px;line-height:1.03;color:white}
.cover-grid{display:grid;grid-template-columns:1fr 240px;gap:54px;align-items:end;margin-top:70px}
.date-span{display:flex;gap:17px;align-items:center;color:#f0c870;font-size:22px;font-weight:700}
.date-span span{color:rgba(255,255,255,.6)}
.cover-summary{max-width:650px;margin:22px 0 0;font-size:34px;line-height:1.46}
.cover-stat{border-left:1px solid rgba(255,255,255,.25);padding-left:44px}
.cover-stat strong{display:block;font-size:88px;color:#f0c870}
.cover-stat span{font-size:22px;line-height:1.3}
.latest-strip{position:absolute;left:82px;right:82px;bottom:120px;display:grid;grid-template-columns:190px 1fr;gap:28px;border-top:1px solid rgba(255,255,255,.25);padding-top:22px}
.latest-strip span{color:#f0c870;font-weight:700}
.latest-strip strong{font-size:24px;line-height:1.4}
.cover .slide-footer{color:rgba(255,255,255,.65);border-color:rgba(255,255,255,.2)}
.cover .slide-footer b{color:white}
.current-panel{position:relative;margin-top:70px;padding:70px 66px 62px;background:var(--navy);color:white;border-radius:4px;box-shadow:16px 16px 0 var(--gold)}
.current-number{position:absolute;right:36px;top:-38px;width:105px;height:76px;display:grid;place-items:center;background:var(--gold);color:var(--navy);font-size:28px;font-weight:800}
.current-panel h3{margin:0 0 30px;max-width:780px;font-size:45px;line-height:1.22}
.current-panel p{margin:0;font-size:30px;line-height:1.55}
.as-of{margin-top:55px;padding:24px;border-top:1px solid rgba(8,36,61,.18);font-size:22px;font-weight:700;color:var(--muted)}
.card-stack{display:grid;gap:30px}.card-stack.compact{gap:24px}
.card{position:relative;padding:34px 38px 32px;background:var(--white);border:1px solid rgba(8,36,61,.13);box-shadow:0 10px 30px rgba(8,36,61,.07)}
.card-rule{position:absolute;left:0;top:0;bottom:0;width:8px;background:var(--teal)}
.card h3{margin:0 0 16px;font-size:33px;line-height:1.23;color:var(--navy)}
.card p{margin:0;font-size:24px;line-height:1.5}
.label{display:inline-block;margin:0 0 16px;padding:6px 13px;background:var(--gold);color:var(--navy);font-size:18px;font-weight:800}
.comparison{display:grid;grid-template-columns:1fr 45px 1fr;gap:12px;align-items:center;margin-top:25px;padding:22px;background:#eef1ee}
.comparison span,.conflict-pair span{display:block;margin-bottom:8px;color:var(--teal);font-size:18px;font-weight:800}
.comparison p{font-size:21px}.comparison .arrow{font-size:32px;font-weight:800;color:var(--gold);text-align:center}
.change-card .explain{margin-top:22px;font-size:21px;color:#445463}
.citations{display:flex;gap:8px;margin-top:22px}
.cite{display:inline-grid;place-items:center;width:31px;height:31px;border-radius:50%;background:var(--navy);color:white!important;font-size:16px;font-weight:800;text-decoration:none}
.timeline-list{position:relative;display:grid;gap:22px;margin-left:18px}
.timeline-list::before{content:"";position:absolute;left:13px;top:24px;bottom:24px;width:3px;background:linear-gradient(var(--gold),var(--teal))}
.timeline-item{position:relative;display:grid;grid-template-columns:30px 1fr;gap:24px}
.timeline-dot{z-index:1;width:29px;height:29px;margin-top:9px;border:7px solid var(--paper);border-radius:50%;background:var(--gold);box-shadow:0 0 0 2px var(--navy)}
.timeline-copy{padding:22px 28px;background:var(--white);border-bottom:2px solid rgba(8,36,61,.12)}
.timeline-meta{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:9px;color:var(--muted);font-size:18px;font-weight:700}
.timeline-meta span{padding:4px 10px;background:#e8eee9;color:var(--teal)}
.timeline-copy h3{margin:0 0 8px;font-size:27px;line-height:1.25;color:var(--navy)}
.timeline-copy p{margin:0;font-size:20px;line-height:1.42}
.timeline-copy .citations{margin-top:12px}
.conflict-card{border-color:rgba(169,65,53,.4)}.conflict-card .label{background:var(--red);color:white}
.conflict-pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}.conflict-pair p{padding:18px;background:#f7ece8;font-size:21px}
.conflict-pair span{color:var(--red)}.status{margin-top:18px;font-size:21px;line-height:1.45}
.next-card{border-top:7px solid var(--teal)}
.empty-state{display:grid;place-items:center;min-height:650px;padding:80px;text-align:center;background:rgba(255,255,255,.55);border:2px dashed rgba(8,36,61,.22)}
.empty-mark{font-size:120px;line-height:1;color:var(--gold)}.empty-state p{max-width:700px;font-size:31px;line-height:1.55;color:#435363}
.source-list{display:grid;gap:18px}
.source{display:grid;grid-template-columns:72px 1fr;gap:24px;padding:23px 26px;background:var(--white);border-left:5px solid var(--teal)}
.source-number{display:grid;place-items:center;width:58px;height:58px;border-radius:50%;background:var(--navy);color:white;font-size:25px;font-weight:800}
.source time{font-size:17px;font-weight:700;color:var(--muted)}
.source h3{margin:4px 0 6px;font-size:24px;line-height:1.27;color:var(--navy)}
.source a{color:var(--teal);font-size:17px;font-weight:800;text-decoration:none}
.method-note{margin-top:24px;padding:18px 22px;border-top:2px solid var(--gold);font-size:18px;line-height:1.45;color:#4c5b66}
.single .toolbar{position:fixed;left:50%;top:18px;transform:translateX(-50%);border-radius:999px}.single .deck{padding-top:88px}
@media(max-width:1120px){.single .deck{display:block;overflow:auto}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
${SCROLL_CSS}
@media print{
  @page{size:1080px 1350px;margin:0}
  html,body{background:white}
  .toolbar{display:none!important}
  .deck{display:block;padding:0}
  .slide{display:block!important;break-after:page;box-shadow:none}
}
`;

function slideMarkup(
  slide: Slide,
  index: number,
  total: number,
  subject: string,
): string {
  return [
    `<section class="slide ${slide.className}" id="slide-${index + 1}" data-slide="${index + 1}">`,
    `<div class="eyebrow">${escapeHtml(slide.eyebrow)}</div>`,
    `<h2>${escapeHtml(shorten(slide.title, 130))}</h2>`,
    slide.body,
    '<footer class="slide-footer">',
    `<b>${escapeHtml(subject)}</b>`,
    `<span>${deva(index + 1)} / ${deva(total)}</span>`,
    '</footer>',
    '</section>',
  ].join('');
}

function documentHtml(
  subject: string,
  slides: readonly Slide[],
  onlyIndex?: number,
): string {
  const visibleSlides = onlyIndex === undefined ? slides : [slides[onlyIndex]!];
  const toolbar =
    onlyIndex === undefined
      ? [
          '<nav class="toolbar" aria-label="पृष्ठ नियंत्रणे">',
          '<div class="toolbar-inner">',
          `<b class="toolbar-title">${escapeHtml(subject)} — काय बदलले?</b>`,
          '<div class="toolbar-actions">',
          '<details class="toc-wrap">',
          '<summary>अनुक्रमणिका</summary>',
          '<div class="toc">',
          ...slides.map(
            (slide, index) =>
              `<a href="#slide-${index + 1}">${deva(index + 1)}. ${escapeHtml(
                slide.eyebrow,
              )}</a>`,
          ),
          '</div>',
          '</details>',
          '<button type="button" onclick="window.print()">प्रिंट करा</button>',
          '</div>',
          '</div>',
          '<div class="progress"><span id="progress"></span></div>',
          '</nav>',
        ].join('')
      : [
          '<nav class="toolbar">',
          '<a href="../index.html">सर्व स्लाइड्स</a>',
          onlyIndex > 0
            ? `<a href="${String(onlyIndex).padStart(2, '0')}.html">← मागे</a>`
            : '',
          onlyIndex < slides.length - 1
            ? `<a href="${String(onlyIndex + 2).padStart(2, '0')}.html">पुढे →</a>`
            : '',
          '</nav>',
        ].join('');
  let markup = visibleSlides
    .map((slide, localIndex) =>
      slideMarkup(slide, onlyIndex ?? localIndex, slides.length, subject),
    )
    .join('');
  if (onlyIndex !== undefined) {
    markup = markup.replaceAll('href="#source-', 'href="../index.html#source-');
  }
  // Reading progress only — every section is already in the document, so there is
  // nothing to show or hide and no keyboard paging to intercept.
  const script =
    onlyIndex === undefined
      ? `
<script>
const bar=document.getElementById('progress'),toc=document.querySelector('.toc-wrap'),root=document.documentElement;
function paint(){const max=root.scrollHeight-root.clientHeight;bar.style.width=(max>0?Math.min(1,root.scrollTop/max)*100:100)+'%';}
addEventListener('scroll',paint,{passive:true});addEventListener('resize',paint);paint();
toc.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>{toc.open=false;}));
document.addEventListener('click',event=>{if(toc.open&&!toc.contains(event.target))toc.open=false;});
</script>`
      : '';
  return `<!doctype html>
<html lang="mr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)} — काय बदलले?</title>
<style>${CSS}</style>
</head>
<body class="${onlyIndex === undefined ? 'scroll' : 'single'}">
${toolbar}
<main class="deck">${markup}</main>
${script}
</body>
</html>`;
}

export async function writeWhatChangedCarousel(
  result: WhatChangedResult,
  outputDir: string,
): Promise<{ indexPath: string; slidePaths: string[]; slideCount: number }> {
  const slides = buildSlides(result);
  const slidesDir = join(outputDir, 'slides');
  await mkdir(slidesDir, { recursive: true });
  const indexPath = join(outputDir, 'index.html');
  await writeFile(indexPath, documentHtml(result.subject, slides), 'utf8');

  const slidePaths: string[] = [];
  for (const index of slides.keys()) {
    const path = join(slidesDir, `${String(index + 1).padStart(2, '0')}.html`);
    await writeFile(path, documentHtml(result.subject, slides, index), 'utf8');
    slidePaths.push(path);
  }
  return { indexPath, slidePaths, slideCount: slides.length };
}
