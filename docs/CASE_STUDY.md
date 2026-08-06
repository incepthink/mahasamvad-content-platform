# Case Study — HashCase

### A Marathi-first content production platform for the Directorate General of Information & Public Relations (DGIPR), Government of Maharashtra

---

## 1. Executive Summary

**HashCase** is a purpose-built, Marathi-first
digital platform that converts the raw material of government communication — meeting
recordings, official notes, Government Resolutions, scanned press notes and departmental
documents — into publication-ready Marathi articles, posters, social media creatives,
thumbnails and explainer videos.

The platform is in active production use by DGIPR officers. It is not a general-purpose
tool adapted to Marathi; every screen, label, hint, error message and output is authored in
Marathi, and the system is engineered around the specific linguistic and editorial
requirements of Government of Maharashtra communication.

**Ten integrated modules** are live in the officer's workspace:

| # | Module (Marathi) | Purpose |
|---|---|---|
| 1 | क्रिएटिव्ह आणि सोशल | Posters, social creatives and YouTube thumbnails |
| 2 | लेख / बातमी | Meeting recordings and documents → publication-ready articles |
| 3 | ध्वनिलेखन | Recordings and YouTube links → verbatim Marathi text |
| 4 | भाषांतर | Marathi → English and Marathi → Hindi translation |
| 5 | मुद्रितशोधन | Grammar, spelling, name and house-style checking |
| 6 | शब्दकोश | Verified name, designation, place and scheme dictionary |
| 7 | मास्टर टेम्पलेट | Poster design template library management |
| 8 | व्हिडिओ | Note → narrated Marathi explainer video |
| 9 | मागील काम | Full history of all work produced |
| 10 | वापर विश्लेषण | Departmental usage analytics |

---

## 2. The Requirement

DGIPR is the communication arm of the Government of Maharashtra. Its District Information
Officers (DLOs) and headquarters staff carry a continuous publishing load: departmental
meetings must become news articles, schemes must become citizen-facing posters, articles
must be released in Marathi, English and Hindi, and the same material must appear across
print, web and social channels — accurately, in the department's established editorial
voice, and to a fixed publication rhythm.

The practical constraints that shaped the platform:

1. **Marathi is the working language, not a translation target.** Content is conceived,
   written, checked and published in Marathi. Routing content through English and back
   degrades it and is expressly disallowed by the platform's design.

2. **Official documents are the factual authority.** Names, dates, amounts, designations,
   scheme names and locations may never be invented or inferred. They come from the
   officer's note and uploaded documents — nothing else.

3. **The department has a house style.** Mahasamvad's published archive represents decades
   of established Marathi government journalism. New articles must read as though they
   belong to it.

4. **The officer must remain in control.** Government communication carries accountability.
   Every stage of the platform is reviewable, editable and approvable by the officer before
   anything is produced or published.

5. **Devanagari must render correctly, everywhere.** Marathi conjuncts, matras and
   Devanagari numerals must be typographically correct in every artefact — on screen, in
   posters, in exported PDFs and in video captions.

---

## 3. What the Platform Does

### 3.1 लेख / बातमी — Meeting Material to Published Article

The department's highest-value workflow. A District Information Officer opens a new piece
of work and supplies whatever they have:

- **Meeting recordings** — MP3, AAC, M4A and similar containers, several files at a time
- **Documents** — PDF (born-digital or scanned), DOCX, TXT
- **YouTube links** — a press conference already published online
- **Typed notes** — free text from the officer

The platform then:

1. **Transcribes** all recordings into Marathi and **extracts text** from every document.
   Scanned PDFs are handled through optical character recognition; born-digital PDFs are
   read from their own text layer, which is exact and immediate.

2. **Presents every source separately for review.** Rather than one merged block of text,
   the officer sees one card per recording and per document, with PDF documents shown page
   by page. Transcription and OCR are machine processes; the officer corrects names,
   amounts and designations here, before anything is written. Page selection lets an officer
   take three relevant pages out of a fifty-page booklet.

3. **Summarises the source into महत्त्वाचे मुद्दे** — an ordered list of the key points the
   material contains, in source order, so the officer can confirm at a glance that nothing
   important has been missed. This is essential when a single upload contains several
   distinct news items.

4. **Confirms names and designations** (व्यक्ती व पदनाम). The platform proposes the correct
   Marathi designation for each person named — drawn from the department's own verified
   dictionary — so that a published article reads *मुख्यमंत्री देवेंद्र फडणवीस* rather than a
   bare name. The officer approves, edits or clears each one, and may record the pairing for
   future use.

5. **Accepts editorial direction.** Two optional fields let the officer steer a single
   article in their own words: **AI साठी सूचना** (emphasis, ordering, tone, what to keep
   brief) and a **style reference** — a previously published article to model the writing on.

6. **Writes the article in Marathi**, using the reviewed source as its sole factual
   authority and an appropriate Mahasamvad article as its style model.

7. **Delivers the finished article** with a Marathi feedback loop for revisions, on-demand
   English and Hindi translation, and a formatted **A4 PDF export** on the official DGIPR
   letterhead.

Work is saved continuously. An officer can close the browser, change machines, and resume
exactly where they left off, with every correction, page selection and confirmed name
intact. Several officers can work on separate pieces at the same time; each piece of work
has its own address and appears in a shared list.

### 3.2 क्रिएटिव्ह आणि सोशल — Posters, Creatives and Thumbnails

The officer supplies the text they want on the poster — typed, uploaded, or both — and
chooses a format:

- **क्रिएटिव्ह** — a Marathi poster for social media (X, Facebook, Instagram)
- **बॅनर** — a landscape poster to accompany a published article
- **यूट्यूब थंबनेल** — a Marathi thumbnail for a YouTube video
- **व्हिडिओ** — a shortcut into the video module

Design is driven by the department's own **master template library**. Rather than asking an
officer to describe a layout, the platform reads the information they have supplied, counts
its distinct points, and selects a template from the library that can actually hold all of
them — guaranteeing that no point the officer wrote is dropped for want of space on the
design. If the material is larger than any template in the library, the layout is extended
and the officer is told, in Marathi, so they can split the note if they prefer.

Officers may also **pin an exact template** when a specific design is required.

Supporting capabilities:

- **Two-gesture visual feedback on a finished poster.** The officer can place numbered
  markers on the poster to say *change this element*, and lettered boxes to say *free this
  space* — for example to leave room for a district logo or a photograph. Both travel in a
  single revision round, with optional Marathi notes.
- **Automatic official branding.** The Government of Maharashtra emblem and the DGIPR
  footer are composited onto every poster by the platform itself, at fixed, correct
  positions. They are never drawn by a generative process, so branding is identical on every
  artefact the department publishes.
- **Marathi captions**, optional and separately editable, with an AI revision loop
  ("shorten this", "use Marathi numerals") or direct hand editing.
- **Direct publishing** to the department's official X account and Facebook Page, behind a
  two-step confirmation.

### 3.3 ध्वनिलेखन — Transcription

A dedicated, single-purpose page for officers who need only the text of a recording. Upload
recordings or paste a YouTube link; receive Marathi text on the same page, with a history of
past work. The transcript is presented verbatim and read-only — this page's contract is
*what the recording says*, exactly. Editing belongs to the article workflow.

Recordings already transcribed anywhere on the platform are recognised and returned
immediately, so re-submitting the same meeting audio never repeats the work.

### 3.4 भाषांतर — Translation

Marathi → English and Marathi → Hindi, from pasted text or an uploaded document (PDF, DOCX,
TXT), and directly from any finished article.

The distinguishing feature is the **mandatory name check before translation**. The platform
identifies every person, place, organisation and scheme name in the text, shows the officer
the exact English (or Hindi) spelling each will receive, and lets them correct it — before
the translation runs. Confirmed spellings are written to the department's dictionary and
lock into that translation and every future one.

Names are additionally protected after translation by deterministic verification, and any
name the platform cannot fully account for is reported to the officer for review rather than
passed silently.

Finished articles carry a मराठी | English | हिंदी toggle, with each translation stored
independently and exportable as a PDF.

### 3.5 मुद्रितशोधन — Proof Reading

An immediate check of pasted Marathi or English text for grammar, spelling, punctuation,
name accuracy and deviation from Mahasamvad house style.

The platform's contract here is **precision over volume** — it reports only errors it is
confident about, so the officer is not made to review a long list of false alarms. The
corrected text is produced by applying exactly the reported fixes to the officer's own
words; it is never a rewrite, and it cannot restructure or re-word anything that was not
flagged.

Corrections are **highlighted in place** in the corrected text, with the original wording
and the reason available on hover or tap, and a toggle to view the text plain. Nothing typed
on this page is stored.

### 3.6 शब्दकोश — The Name Dictionary

The department's institutional memory for proper nouns. Each entry holds a Marathi name, its
verified English spelling, an optional Hindi spelling, its type (person, place, organisation,
scheme, designation) and — for people — their Marathi designation.

The dictionary is what makes the platform's output consistent across officers and across
time: *कोल्हापूर* is spelled the same way in every English release the department issues,
and *मुख्यमंत्री* is rendered as *Chief Minister* every time. New names encountered during
translation surface here automatically for verification.

### 3.7 मास्टर टेम्पलेट — Template Library Management

Departmental staff manage the poster design library directly: upload new master designs,
enable or disable them, and organise them by **capacity band** — how much information a
design can hold (a single message, a few points, a medium list, a long list). Capacity is the
axis that matters, because it is what determines whether an officer's content fits.

Separate libraries are maintained for social creatives, article banners and YouTube
thumbnails.

### 3.8 व्हिडिओ — Marathi Explainer Videos (Beta)

A note or a ready Marathi script becomes a narrated Marathi explainer video, through a
**staged approval workflow**:

1. **Script review** — the platform proposes a Marathi narration and a scene-by-scene visual
   plan. Both are fully editable, including the overall visual style. Where an officer
   supplies a finished script, it is used word for word and never rewritten.
2. **Storyboard review** — each scene's opening and closing frame is generated and shown,
   along with the synthesised Marathi voiceover for that scene, which the officer can listen
   to. Any frame can be redrawn individually.
3. **Final production** — only on the officer's explicit confirmation is the video rendered:
   animated scenes, continuous Marathi voiceover, on-screen Marathi key points and a
   subtitle file.

Every video is branded with the government lockup and closes on the official DGIPR contact
slate. Individual scenes can be re-rendered without disturbing the rest of the video.

The on-screen Marathi text is typeset by the platform and composited onto the finished
footage — it is never drawn by a generative model — which is what keeps Devanagari
typographically correct in the final file.

### 3.9 मागील काम — History

Every piece of work the department has produced, searchable and paginated, with its poster,
article, captions, translations, version history and lineage. Work produced from the same
source note is linked together, so an officer can see the article, its banner, its social
creative and its re-runs as one thread.

### 3.10 वापर विश्लेषण — Usage Analytics

A departmental view of platform usage: outputs produced, daily activity trends, and a
breakdown per module, over selectable 7-day, 30-day, 90-day and all-time windows. Each
module card opens its own detailed page.

Figures are **department-wide**. The platform does not track, score or report individual
officers.

---

## 4. Product and Experience Design

### 4.1 Marathi-First, Not Marathi-Translated

Every interface string is authored in Marathi in a single reviewed catalogue. Buttons, hints,
progress messages, validation errors and confirmation dialogues are Marathi. Where an English
term is genuinely the working vocabulary of the department, it is used as such rather than
force-translated.

Devanagari numerals are accepted wherever numbers are typed — an officer entering page range
`२-४, ९` is understood exactly as one entering `2-4, 9`.

### 4.2 Designed for Non-Technical Government Staff

The interface follows a deliberate accessibility standard maintained across the product:

- A large 18px base text size and 56px primary action buttons
- Status conveyed as **text and colour together**, never colour alone
- A consistent page structure across all ten modules, so a skill learned on one page
  transfers to the next
- Full responsive behaviour, verified at both desktop and mobile widths
- Uploading a file looks and behaves identically on every screen that accepts one

The interface uses no third-party component library. It is a hand-built design system,
which is what allows the Marathi typography, the large-target standard and the government
visual identity to be applied consistently rather than fought against.

### 4.3 Officer-in-the-Loop at Every Stage

The platform never produces a final artefact from unreviewed input. The consistent pattern:

| Stage | What the officer reviews |
|---|---|
| Source intake | Which pages of a scanned document are relevant |
| After extraction | Every transcript and page of text, correctable in place |
| Before writing | Key points, names, designations, editorial direction |
| Before translating | The exact spelling every name will receive |
| After production | Article text, poster design, caption, video — each with its own revision loop |
| Before publishing | A two-step confirmation on any outward-facing action |

Nothing is produced from a scanned document until the officer has said which pages matter.
Nothing is published until the officer has confirmed twice.

### 4.4 Editorial Philosophy

The platform is built on an explicit editorial contract, not on maximal restatement:

- **Facts are tiered by who they serve.** Citizen-facing information — benefits, eligibility,
  deadlines, what a citizen must do — outranks implementation machinery. Foreground and
  supporting facts are preserved; incidental detail may be compressed; procedural noise may be
  omitted. This is what an editor does, and it is what makes the output read as journalism
  rather than as reformatted minutes.
- **Never invent** names, dates, amounts, designations, scheme names or locations. This rule is
  absolute, is stated in every generation instruction, and is additionally enforced by
  automated verification.
- **The archive teaches style, not facts.** Mahasamvad's published articles are used to model
  structure, register and paragraph rhythm. They never contribute information.

---

## 5. Technical Architecture

### 5.1 Structure

A TypeScript monorepo of two applications and five shared packages, under pnpm workspaces:

| Workspace | Responsibility |
|---|---|
| `apps/web` | Next.js (App Router) Marathi-first officer interface |
| `apps/api` | Fastify API — thin routes and job orchestration |
| `packages/content-engine` | Intake, transcription, extraction, retrieval, generation, revision |
| `packages/poster-renderer` | Poster, PDF, video-caption and video-assembly rendering |
| `packages/database` | Data access, queries, storage helpers, typed rows |
| `packages/social-publisher` | Publishing to official X and Facebook accounts |
| `packages/schemas` | Shared validation schemas and types across API and web |

A strict boundary is maintained and enforced: **API routes stay thin.** They validate,
sequence and persist. All content logic lives in the engine packages, where it is
version-controlled, individually testable and independently runnable.

### 5.2 Data Layer

PostgreSQL (Supabase) with **43 versioned, sequentially applied SQL migrations**. Structured
storage covers generation runs, article intakes, transcriptions, video projects, the name
dictionary, the template library, revision history and usage events. Vector search over the
indexed Mahasamvad article archive supports style retrieval.

Every migration is written to be **additively safe**: a migration that has not yet been
applied disables the specific capability it introduces rather than affecting any existing
workflow. This is a deliberate operational property that allows staged deployment without
service interruption.

Media is stored in separated buckets by sensitivity — published artefacts (posters, videos)
in public storage, source material (uploaded recordings and documents) in private storage.

### 5.3 Processing and Job Orchestration

Long-running work — transcription, document OCR, article generation, poster rendering, video
production — runs as tracked background jobs. Job state is held in the database record
itself, not in server memory, which means:

- An officer can refresh, navigate away, or return on another machine and the work is still
  there, at the correct stage
- Progress is reported to the interface as named Marathi stages, not an indeterminate spinner
- Interrupted work resumes without repeating completed stages

### 5.4 Model Provider Architecture

The platform integrates multiple specialised AI services, each behind a **provider seam** —
an internal interface that isolates the rest of the system from any one vendor:

| Capability | Seam |
|---|---|
| Marathi speech-to-text | Configurable transcription provider |
| Text generation and verification | Tiered model configuration |
| Image generation | Configurable image provider |
| Video clip generation | Configurable clip provider |
| Marathi text-to-speech | Configurable voice provider |
| Marathi → English / Hindi translation | Specialised translation services per target |

Provider selection is configuration, not code. This is a procurement-relevant property: the
department is not locked to a single vendor, and a provider can be substituted through
configuration without re-engineering the platform.

Text generation is organised in **tiers** — judgement-heavy work such as article authoring
and key-point extraction is configured separately from mechanical work — so quality and
throughput can be tuned per task rather than globally.

### 5.5 Deployment

- **Web application**: Vercel
- **API**: containerised, on department-controlled infrastructure
- **Database and storage**: Supabase
- **Rendering**: the API container ships its own headless browser for poster, PDF and caption
  typesetting; video assembly runs locally through bundled `ffmpeg`

All configuration is environment-driven. No credentials are held in the repository, and the
repository is scanned to keep it that way.

---

## 6. Accuracy and Quality Engineering

Accuracy in government communication is not a best-effort property. The platform enforces it
structurally, in three layers.

### 6.1 Instruction

Every generation prompt states the factual authority rules explicitly, names the officer's
approved inputs, and is **versioned** — the exact editorial specification used to produce any
given article is recorded with that article.

### 6.2 Deterministic Guarantee

Where correctness can be checked by code, it is — and the code, not the model, has the final
word:

- **Scheme and organisation names** are verified against the source and against the verified
  dictionary; a shortened name is deterministically restored to its full official form. This
  process can only ever lengthen a name toward its source form — it cannot introduce one.
- **Designations** are placed by a deterministic pass that inserts only officer-approved text,
  handles Marathi honorifics correctly, and never alters a digit.
- **Numerals** may be re-scripted between Devanagari and Latin, but a numeric *value* can never
  be changed.
- **Proof-reading corrections** are applied as an exact patch of the officer's own text, with a
  guard that refuses to deliver a correction that would have altered a number.
- **Translation name preservation** is verified word by word after translation, with any
  unaccounted name reported to the officer.
- **On-screen video text** is checked against the source note before it is used.

### 6.3 Typography

Marathi conjuncts (`क्ती`, `ऱ्या`, `विद्यार्थ्यांच्या`) require a proper Indic text shaper. The
platform therefore typesets **all** Devanagari — posters, PDFs, video captions and the
government wordmark — through a real browser rendering engine with a Devanagari typeface
selected specifically for correct Marathi conjunct formation. No generative image process is
ever responsible for rendering the department's Marathi text.

The same discipline governs the official branding: the emblem and footer are composited by the
platform at exact coordinates on every artefact.

### 6.4 Verification Discipline

The codebase carries **free-to-run verification harnesses** for its critical logic — name
locking, designation placement, page-range parsing, prompt assembly, caption placement, source
assembly, translation term handling and more. These run without contacting any external
service, and are executed before any change to the corresponding logic is deployed. Type
checking and linting run across all seven workspaces as a release gate.

---

## 7. Security and Data Handling

- **No credentials in source control.** All secrets are environment-supplied.
- **Separated storage by sensitivity.** Source recordings and uploaded documents are held in
  private storage; only published artefacts are publicly addressable.
- **Ad-hoc work is not retained.** Text checked on the proof-reading page and text translated
  ad hoc are processed and discarded — this is a stated contract of those pages.
- **Analytics stores no content.** The usage analytics data model has no free-text field at
  all; it records which capability was used and when, never what was written.
- **Analytics does not profile individuals.** All reporting is department-wide.
- **Outward-facing actions are gated.** Publishing to official accounts requires explicit
  two-step confirmation, and platform-level credentials for those accounts are held in
  configuration, never in the application.
- **Business logic is in version control**, not in a workflow tool — auditable, reviewable and
  reproducible.

---

## 8. Scale and Current Status

**In production use.** DGIPR officers use the platform for live departmental work.

Representative volume over a recent thirty-day operating window:

| Measure | Volume |
|---|---|
| Content outputs produced | 421 |
| Posters and creatives | 226 |
| Articles produced | 67 |

Platform footprint:

| Measure | Figure |
|---|---|
| Live modules in the officer workspace | 10 |
| Workspace projects (applications + shared packages) | 7 |
| Applied database migrations | 43 |
| Output languages | 3 (Marathi, English, Hindi) |
| Publishing destinations | X, Facebook Page, PDF, video, direct download |
| Supported source types | Audio recordings, YouTube links, PDF (digital and scanned), DOCX, TXT, typed notes |

Documentation delivered alongside the platform includes a **bilingual, journey-wise end-user
manual** with real interface screenshots, published through GitBook and maintained in the
repository.

---

## 9. Why This Platform Is Different

| | Generic AI content tools | HashCase |
|---|---|---|
| **Language** | English-first, Marathi as output | Marathi-first end to end — interface, processing and output |
| **Facts** | Model knowledge may enter the output | Officer's note and documents are the only factual authority |
| **Names** | Transliterated afresh each time | Department-verified dictionary, locked across every output and every officer |
| **Designations** | Not modelled | Verified designation attached to each person, applied automatically |
| **Style** | Generic register | Modelled on DGIPR's own published Mahasamvad archive |
| **Devanagari rendering** | Frequently malformed in generated images | Typeset by a real shaping engine on every artefact |
| **Branding** | Drawn approximately | Composited by the platform at exact, identical coordinates |
| **Control** | Single-shot output | Review and approval at every stage, with revision loops |
| **Vendor exposure** | Hard-coded to one provider | Provider seams; substitution is configuration |
| **Auditability** | Opaque | Versioned specifications, revision history, work lineage |

---

## 10. Roadmap

Capabilities identified and designed for, ready to be scheduled:

- **Authentication and role-based access**, enabling per-officer attribution and
  district-level workspaces
- **An approval and publication state model**, capturing the officer-final version of each
  article as departmental record
- **A learning loop** from approved articles, so the platform's style modelling improves from
  the department's own accepted output — the architectural seam for this is already in place
- **Canva integration** for downstream design workflows
- **Horizontal API scaling** for higher concurrent officer load

---

## 11. Summary

HashCase demonstrates delivery of a complete, production-grade, Marathi-first
government content platform: ten integrated modules covering the department's full
publication workflow from meeting recording to published post; an editorial engine built
around verified factual authority and the department's own established style; correct
Devanagari typography across every artefact the department issues; officer control and
reviewability at every stage; and an architecture that is modular, version-controlled,
vendor-substitutable and documented.

The system is live, in daily departmental use, and built to extend.

---

*Directorate General of Information & Public Relations, Government of Maharashtra —
माहिती व जनसंपर्क महासंचालनालय, महाराष्ट्र शासन*
