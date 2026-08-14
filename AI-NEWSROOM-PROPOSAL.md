# Proposal for AI NewsRoom

## A Secure On-Premises AI Content Operations Platform for the Directorate General of Information and Public Relations (DGIPR)

> **Government information processed within government-controlled infrastructure.**

## 1\. Purpose of this proposal

The Directorate General of Information and Public Relations (DGIPR) is expected to convert meetings, policy decisions, government resolutions, press briefings, scheme information and field updates into accurate public communication across several formats and languages. This work must often be completed within hours, while preserving factual accuracy, correct Marathi, official designations and government visual identity.

Because this work involves official, sensitive and often unpublished government information, data security cannot be treated as an optional feature. Secure on-premises AI is therefore the foundation of the proposed AI NewsRoom. Approved AI models, the departmental knowledge base, document embeddings, the vector database and core processing services will operate within infrastructure controlled by DGIPR or an approved government data centre.

AI NewsRoom is proposed as a secure, Marathi-first workspace built on this department-controlled AI foundation. It helps authorised officers receive source material, review it, create publication-ready drafts, produce visual and video communication, translate and proofread content, make revisions, reuse approved material and monitor departmental usage.

The purpose of AI NewsRoom is not to replace the judgement or approval authority of DGIPR officers. Its purpose is to remove repetitive production work, make the source of every communication easier to review, and enable the DGIPR team to deliver more consistent output across more channels.

This document presents AI NewsRoom as one unified product. Its capabilities are therefore described together as the intended operational scope, without separating them into current and future feature lists.

## 2\. Executive summary

AI NewsRoom will give DGIPR a dedicated on-premises AI capability for government communication. Unlike a general-purpose public AI application, it will allow the department to control where official information is processed, where institutional knowledge is stored, who can access it and how the underlying AI models are operated and updated. The objective is not merely to provide access to AI tools, but to establish a secure AI environment owned and governed by the department. DGIPR's designated data centre will provide the large-scale GPU and supporting hardware infrastructure required for production deployment. DGIPR will also provide the separate GPUs required by HashCase for local development and pre-production work.

Government information commonly reaches DGIPR in fragmented forms: handwritten or typed notes, long meeting recordings, WhatsApp voice notes, YouTube press conferences, scanned government documents, photographed letters, spreadsheets embedded in PDFs and previously published articles. Officers must manually listen, copy, correct, condense, translate, design and reformat the same material multiple times before it can be used for a news article, social post, poster, thumbnail or video.

This creates avoidable delays and several operational risks:

- facts can change while being copied between people and applications;
- names, designations, dates, amounts and scheme titles may be rendered inconsistently;
- Marathi content may be grammatically correct but may not follow the department's established public-communication style;
- designers may receive incomplete briefs or templates that do not fit the amount of information;
- every new format can become a separate production exercise;
- corrections may be communicated informally, making versions difficult to trace;
- valuable historical content is difficult to search and reuse;
- management has limited visibility into output volume, processing activity and attributable service usage;
- urgent work depends heavily on the availability of specialist writers, translators, transcribers, designers and video editors;
- using uncontrolled public AI tools can expose sensitive or unpublished government material to external systems;
- externally hosted tools can limit departmental control over data residency, retention, access and auditability.

AI NewsRoom addresses these problems through a secure, on-premises and governed source-to-publication workflow. Official documents remain the factual authority. Semantic Search and Retrieval-Augmented Generation (RAG) retrieve relevant authorised material from the department's private knowledge base and provide it to the model as controlled context. Evaluation and source-faithfulness checks help identify unsupported output, while officers retain final review and approval authority. The result is a department-controlled AI capability rather than dependence on a public AI application.

## 3\. Why the department needs AI NewsRoom

### 3.1 Protection of government information and data sovereignty

DGIPR handles meeting records, government resolutions, policy information, official correspondence and material that may not yet be public. Processing such material through uncontrolled consumer AI applications can create risks relating to confidentiality, data retention, jurisdiction and unauthorised reuse.

AI NewsRoom addresses this requirement through secure on-premises AI inference and department-controlled storage. Source documents, recordings, embeddings, generated content and operational records can remain within authorised infrastructure. Role-Based Access Control (RBAC), encryption and audit logging provide administrative safeguards, while external services or integrations are used only where specifically approved by the department.

### 3.2 Faster response to public-information requirements

Announcements, meetings and policy decisions often require simultaneous communication through news articles, social platforms, websites and video. AI NewsRoom reduces the time spent repeatedly converting the same source into each format and allows longer processing tasks to continue in the background while officers handle other work.

### 3.3 Stronger factual control

General-purpose writing tools can produce fluent text without making it easy to determine which source supported a statement. AI NewsRoom is designed around the opposite principle: official inputs provide the facts, and historical articles or design templates provide style and structure only. Review stages, source views and fact-coverage checks keep the officer close to the original material.

### 3.4 Consistent Marathi and official terminology

Government communication requires more than literal translation or ordinary grammar checking. It requires consistent spellings of people, places, departments and schemes; correct current designations; appropriate Devanagari rendering; and a recognisable Mahasamvad-style editorial voice. A shared verified glossary and specialised Marathi workflows make this consistency repeatable across the department.

### 3.5 Reduced dependence on disconnected external tools

Transcription, drafting, translation, proofreading, poster creation, caption writing, video preparation and historical research are often performed in separate applications or by separate vendors. AI NewsRoom brings these activities into one workflow, reducing hand-offs, duplicate data entry and loss of context.

### 3.6 Better use of institutional knowledge

Previously published Mahasamvad material contains valuable knowledge about departmental writing style and the history of schemes, projects and decisions. AI NewsRoom turns that archive into a usable institutional resource rather than leaving it as a collection that must be searched manually.

### 3.7 More transparent operations

Management can see how many outputs are being produced, which functions are being used, how activity changes over time and which user-facing tasks account for processing activity. This supports planning, utilisation review and more informed procurement oversight.

### 3.8 Regular in-office training and continued support from HashCase

Successful adoption requires more than making the software available. DGIPR employees must understand how to prepare source material, review generated content, use the approval controls and incorporate AI NewsRoom into their daily work.

The team behind AI NewsRoom, HashCase, has been visiting the DGIPR office regularly to train employees in the use of the tool and to understand the department's practical working requirements. HashCase will continue these office visits and training sessions in the future, providing hands-on guidance, follow-up assistance and support whenever employees need help adopting the platform.

This continuing relationship gives DGIPR an implementation partner that remains involved after delivery, responds to practical usage challenges and helps employees use the platform effectively. It ensures that AI NewsRoom develops in response to the department's real operational needs and that staff receive continued enablement rather than being left to adopt the tool without assistance.

## 4\. Proposed solution

### 4.1 Secure on-premises AI foundation

The central component of AI NewsRoom will be a private AI environment deployed within DGIPR-controlled infrastructure or an approved government data centre. HashCase will deploy, configure and adapt approved language, vision, speech and document-processing models for DGIPR's Marathi-first communication requirements. Where appropriate and supported by evaluation, selected models can be fine-tuned or adapted using department-approved datasets; government information will not be used to train a public model.

#### 4.1.1 Production deployment infrastructure

Production operation of the complete platform will require substantial GPU capacity and supporting data-centre hardware. DGIPR's designated data centre will provide, host and maintain the production GPUs, compute servers, memory, storage, networking and other infrastructure required for the approved production architecture.

HashCase will assess the selected models, expected concurrency and production workloads and will provide the required technical sizing and configuration to the designated data centre. The final production GPU quantity and specification will therefore be determined during production sizing and validated through deployment benchmarking. The cost of production GPUs and supporting data-centre hardware will not be included in HashCase's local-development GPU estimate because this production infrastructure will be provided directly by DGIPR's designated data centre.

#### 4.1.2 Local development GPU requirement

HashCase will require a separate, smaller GPU setup for local development, model integration, RAG testing, workflow development, controlled fine-tuning and model adaptation, quality evaluation, performance optimisation and pre-production validation. These local-development GPUs will also be provided or funded by DGIPR for the project.

The local-development GPU configuration and its cost will be specified separately. Only the cost of these local-development GPUs will be included in the hardware cost estimate prepared by HashCase. Production GPU and production data-centre hardware costs will remain outside that estimate.

HashCase will deploy, configure, integrate and optimise the AI software stack in the local-development environment and on the production infrastructure supplied by DGIPR's designated data centre.

The AI software architecture deployed across these environments will include:

- locally hosted Large Language Models (LLMs) for drafting, summarisation, question answering and assisted review;
- Marathi-capable speech-to-text, Optical Character Recognition (OCR) and multimodal document understanding;
- a private departmental knowledge base containing authorised government documents and approved Mahasamvad material;
- Semantic Search using embeddings stored in a department-controlled vector database;
- Retrieval-Augmented Generation (RAG) to ground responses in relevant approved sources;
- document-level citations, source provenance and traceability between inputs and generated outputs;
- Role-Based Access Control (RBAC), encryption, audit logging and configurable retention controls;
- model evaluation, monitoring, version control and controlled upgrades;
- backups, disaster recovery and continuing operational support.

The private AI environment will also include an MLOps and AI-orchestration layer for model registry, prompt and workflow versioning, inference monitoring, observability, controlled upgrades and rollback. Where approved datasets and evaluation results support it, selected models may undergo fine-tuning, instruction tuning or other forms of domain adaptation for Mahasamvad editorial style, Marathi government terminology, departmental document formats, media classification and DGIPR-specific quality rules. Departmental information will not be used to train a public model.

The AI model will not be treated as the department's factual database. Official documents remain the source of truth. RAG retrieves relevant authorised material for each task and supplies it to the model as controlled context, allowing departmental knowledge to be updated without repeatedly retraining the complete model.

A formal AI evaluation framework will measure retrieval relevance, source coverage, factual faithfulness, Marathi language quality, terminology consistency and unsupported-claim rates. Representative DGIPR test cases will be used to assess significant model, prompt or retrieval changes before deployment. This technical evaluation complements, but does not replace, human-in-the-loop review and the officer's final publication authority.

### 4.2 Unified source-to-publication workflow

On top of this secure AI foundation, AI NewsRoom will provide a unified digital workspace for DGIPR officers through web and mobile applications. An officer can begin with raw or approved source material and move through the complete communication lifecycle:

1. Receive notes, recordings, links, documents or photographs.
2. Convert speech and documents into reviewable text.
3. Select only the relevant pages and sources.
4. Correct extraction errors, names, designations and key facts.
5. Create an article, news report, caption, poster, thumbnail, translation, transcript or video.
6. Review factual coverage, wording, layout, imagery and branding.
7. Request precise revisions without restarting the entire task.
8. Download or publish the approved output through the appropriate authorised channel.
9. Reuse the same approved material for other formats.
10. Search previous work and review department-level usage.

## 5\. Complete functional scope

### 5.1 Unified intake of government source material

AI NewsRoom accepts the forms in which government information actually arrives, including:

pasted meeting notes, press notes, scheme briefs and approved articles; meeting recordings and common mobile audio formats; WhatsApp voice notes and recordings shared directly from a supported Android phone; links to YouTube press conferences, speeches and briefings; PDF, Word and text documents; scanned government resolutions, circulars, notices and annexures; photographs of letters, notices, tables and other official documents; multiple sources combined into one article assignment.

The platform converts these inputs into a common reviewable form. This prevents officers from having to manually copy information between a recorder, document reader, transcription tool and writing application.

For photographed documents, the original photograph is shown beside the extracted text so the officer can compare names, amounts, dates and tables before using it. Phone orientation is handled automatically where possible, reducing problems caused by sideways photographs.

### 5.2 Controlled reading of long and scanned documents

Officers can select the required PDF pages before scanned-page reading begins. Covers, blank pages, annexures and unrelated sections can be excluded. Page-range selection is particularly important for long documents because it:

reduces waiting time; avoids processing pages that will not contribute to the output; makes review more manageable; reduces unnecessary page-based processing expenditure; preserves the original page identity so officers can trace extracted text back to the document.

Where a document already contains usable digital text, AI NewsRoom reads that text directly. Where the document is scanned or the embedded text is unusable, it switches to visual document reading. Tables and headings are retained in a review-friendly structure as far as the source permits.

Nothing proceeds silently from extraction to publication. Extracted text remains editable, and the officer chooses which sources or pages will form part of the final content.

### 5.3 Audio and YouTube transcription workspace

AI NewsRoom provides a dedicated transcription workspace for meetings, interviews, speeches, press conferences and media clips. Officers can:

transcribe one or more recordings; transcribe multiple YouTube links without first downloading the videos; receive results source by source; see clearly when one source fails while retaining the successful transcripts; copy the text or download it as a text file; send the transcript directly into the article/news workflow; reopen previous transcription work; reuse a recording that has already been transcribed without unnecessarily processing it again.

On supported Android devices, the installed AI NewsRoom application can appear in the phone's Share menu. An officer can share a WhatsApp voice note or recorder file directly to the transcription workspace, avoiding the intermediate process of saving the file, locating it again and uploading it manually.

The transcript represents what was heard and is therefore treated as a reviewable record, not as a verified quotation. Officers are reminded to check sensitive names, amounts, dates, English terms and quotations against the recording.

### 5.4 Meeting-to-article and document-to-article workflow

AI NewsRoom converts mixed source material into either:

a detailed scheme or public-information article; or a concise factual news report.

The officer may provide an exact heading, a plain-language instruction about the required emphasis or length, and an example Mahasamvad article whose writing style should be followed. The instruction can express the actual editorial requirement—for example, to foreground citizen action, focus on a district, use a shorter form or explain an implementation decision clearly.

Before drafting, the platform presents a structured review stage containing:

extracted or transcribed text for every source; inclusion controls for sources and pages; editable corrections; a concise list of approved key points; a five-questions-and-one-answer view covering who, what, when, where, why and how where supported by the source; detected people and their designations; glossary-backed spelling and designation suggestions; the selected article form, heading, instruction and style reference.

This review creates an approved factual foundation for the article. Statements attributed to a minister, official or institution remain tied to the relevant source rather than being converted into unsupported general claims.

### 5.5 Publication-ready Marathi articles and news reports

The writing workflow produces clear Marathi suitable for government communication while preserving the facts in the approved material. It supports:

detailed explanatory scheme articles; short factual news reports; automatic use of the department's standard news dateline; headings based on the source and the officer's instruction; appropriate use of confirmed names and designations; current designation handling through the shared glossary; the structure and tone of relevant Mahasamvad examples; source-faithfulness and important-point coverage checks; controlled article revision after feedback; separate Marathi, English and Hindi versions; copy, text, Markdown and publication-ready PDF downloads.

The result includes a fact-review section showing whether important source points are represented and a source section that lets the officer return to the original note used for the run. These aids make final checking faster and more disciplined, while leaving publication approval with the officer.

Quality will be monitored through an AI evaluation framework covering factual faithfulness, source coverage, retrieval relevance, Marathi language quality, terminology consistency and unsupported-claim detection. Evaluation datasets based on representative DGIPR content can be used to test model or prompt changes before deployment. Human-in-the-loop review remains the final control for official communication.

### 5.6 Historical Mahasamvad style intelligence

AI NewsRoom maintains a searchable body of previous Mahasamvad articles. When an officer requests a new article, the platform can identify past articles that resemble the new assignment in editorial form—for example, a meeting report, a directive, an implementation update or a scheme explanation.

The selected historical material guides writing style, organisation and tone. It is not allowed to introduce facts into the new article. This distinction enables the department to preserve its established communication character without risking the accidental reuse of an old date, amount, name or policy statement.

An officer may also provide a specific published Mahasamvad link when a particular writing style is required.

This capability uses Semantic Search and Retrieval-Augmented Generation (RAG). Documents are converted into embeddings and indexed in a vector database, allowing the platform to retrieve material by meaning and editorial context rather than relying only on exact keyword matches. The retrieved material is supplied to the AI model as controlled context, with source attribution, so outputs remain grounded in authorised departmental information.

### 5.7 Person, designation and terminology review

Names and designations are among the highest-risk elements in government communication. AI NewsRoom detects likely people and posts before drafting and asks the officer to confirm them. Officers can:

accept or reject suggested people; correct a person's designation; add a missing person; decide whether a correction should be remembered for later work; distinguish a full name from an unrelated person with the same surname; review Marathi, English and Hindi spellings of the same proper name.

This reduces repeated spelling corrections and limits the risk of attributing the wrong portfolio to a person.

### 5.8 Shared verified glossary

AI NewsRoom includes a departmental glossary for approved terminology and names. Each entry can contain:

Marathi spelling; English spelling; Hindi spelling; type, such as person, place, organisation, scheme or designation; the designation associated with a person; verification status.

Officers can search, filter, add, edit, verify, unverify or remove entries according to their authority. Only verified entries are treated as approved forms. Unverified suggestions remain visibly pending so guessed spellings do not silently become departmental standards.

The glossary supports article drafting, designation checks, translation and proofreading, providing one common language reference across multiple workflows.

### 5.9 English and Hindi translation

AI NewsRoom translates pasted Marathi text, uploaded documents and completed articles into English or Hindi. The two translations are maintained separately so one does not replace the other.

Before translation, the platform detects names of people, places, organisations and schemes and asks the officer to confirm the required target-language spelling. This is important because proper names should not be translated as ordinary words, and correct Hindi orthography may differ from Marathi even though both use Devanagari.

For Hindi, officers can decide which expressions must remain exactly as approved and which common nouns or designations should be translated naturally. If the platform cannot confidently account for an approved name in the result, it delivers the translation with a visible warning rather than discarding already completed work.

Document translation uses the same page-selection and extracted-text review controls as the article workflow. Ad-hoc translation material is treated as temporary work rather than automatically becoming part of the permanent generation history.

### 5.10 Marathi and English proofreading

The proofreading workspace checks pasted text and uploaded documents for:

spelling; grammar; punctuation; high-confidence language errors; verified-name mismatches; Marathi usage and Mahasamvad-style recommendations.

Confirmed corrections and optional style advice are shown separately. Each issue includes the original excerpt, the suggested change and a short explanation. The corrected version can highlight exactly where changes were applied, and the officer can inspect the original wording behind each highlight.

The platform does not silently correct an uncertain proper name. It also prevents a proposed proofreading change from silently altering a number. Corrected text can be copied or downloaded, while factual verification remains a separate officer responsibility.

### 5.11 Social creatives, article posters and YouTube thumbnails

From an approved Marathi article or note, AI NewsRoom can produce:

DGIPR-branded creatives for major social channels; a social caption without a poster; a poster with an accompanying caption; a landscape poster to accompany a full article; a Marathi YouTube thumbnail; specialised formats for Cabinet decision communication.

The officer can paste approved text or upload a PDF, Word or text file. For an article poster, the officer may provide an exact heading; otherwise, the platform identifies the main named subject, such as a scheme, campaign, service, portal, mission, fund or project.

The platform supports both established-template and fresh visual directions. It chooses a layout based on the amount and shape of information rather than merely matching the topic. This prevents a seven-point note, for example, from being forced into a layout with room for only three points. When content exceeds available layout capacity, the officer is warned rather than having information silently removed.

### 5.12 Controlled visual reference library

AI NewsRoom includes an administrative library of master designs for social creatives, article posters and YouTube thumbnails. Administrators can:

upload approved reference designs; categorise them by output type and dimensions; identify whether they are photo-led or text-led; analyse text regions, image zones and approximate content capacity; search and filter the library; enable or disable a design for automatic use; correct its description or capacity information; remove duplicates or unsuitable references.

A master design supplies visual structure—not facts. Its visible wording, dates, contact information, logos, colours, QR codes and claims are treated as unrelated placeholders. This safeguards against accidental copying from an old campaign into a new government message.

Officers can allow AI NewsRoom to choose a suitable master automatically, select a design type, or pin a particular approved reference when required.

### 5.13 Government branding and channel-ready output

Government identity is applied consistently to creatives, article posters, thumbnails and videos. The official emblem, wordmark, footer and contact treatment are added as controlled brand elements rather than being redrawn as part of the artwork. This provides:

consistent use of the official identity; clearer protection against distorted or invented emblems; predictable placement across outputs; the ability to revise artwork without losing the official brand layer; channel-appropriate proportions for social, article, thumbnail and video formats.

Specialised Cabinet decision creatives can use a dedicated approved design treatment and controlled portrait placement. Different colour and layout treatments can be generated while the official identity remains stable.

### 5.14 Caption creation and social publishing support

AI NewsRoom can create a Marathi caption from the approved source, either by itself or together with a poster. Officers can edit the caption directly, write it manually, copy it for another system or request a targeted rewrite without affecting the visual.

Poster feedback and caption feedback remain separate so an instruction to change wording does not unintentionally redesign the poster. The platform can support direct publication to connected and authorised official channels, with an explicit confirmation before any immediate external publication. Where direct publishing is not enabled, the officer can download the visual and copy the caption for the department's authorised manual process.

### 5.15 Precise poster feedback and version control

Instead of asking an officer to describe a visual problem only in words, AI NewsRoom allows the officer to point directly to it. The officer can:

click or draw a small numbered marker over an element; write a separate instruction for each marked element; combine local corrections with one overall instruction; request a different layout or colour direction; compare the new result with earlier versions; restore any previous successful version.

A second visual gesture allows the officer to mark an area that should be cleared for a department-specific logo, partner mark or photograph. Existing content can be moved elsewhere or removed, while the selected area is returned as a natural continuation of the background rather than an obvious blank box.

Every successful visual revision is kept as an immutable version. This makes iterative creative work safer because a poor revision does not destroy an earlier approved option.

### 5.16 Branded explainer-video production

AI NewsRoom can turn government information into a short Marathi explainer video for web, YouTube, reels, shorts and status formats. An officer may begin with:

a factual note from which the platform prepares a narration script; or an already approved Marathi script whose words must remain unchanged; an approved narration recording where the existing voice is to be used.

The officer chooses landscape or vertical output and an appropriate target duration. Video production is divided into clear approval stages:

Script review: The officer checks the full narration, scene division, visual description and key message. Storyboard review: The officer reviews still frames before animation and can redraw only an unsuitable frame. Animation approval: Only approved scenes proceed to the resource-intensive animation stage. Final review: The officer checks the complete video, narration, captions, transitions, branding and ending slate.

The storyboard favours plausible Maharashtra and Indian settings, avoids unsupported visual claims and uses visuals that carry information rather than functioning as generic decoration. The narration is planned as one continuous track so scene changes do not create repetitive or broken speech.

Completed video functions include:

branded scene clips and final video; landscape and vertical formats; Marathi narration; timed subtitles; downloadable subtitle file; a standard DGIPR contact slate at the end; replacement of narration without regenerating every scene; reassembly of stored clips without paying to recreate them; correction and regeneration of only one scene while the previous complete video remains available.

These approval gates reduce the risk of discovering an avoidable script or storyboard problem only after the most expensive production step.

### 5.17 Motion creatives from approved posters

AI NewsRoom can convert an approved static poster into a short motion creative suitable for social feeds and digital displays. Motion can be applied to appropriate subjects, environmental elements or background activity while preserving the poster's factual and official components.

The motion workflow is designed to keep typography, numbers, information panels, icons, emblem, footer and other approved elements fixed and legible. It avoids camera movement or animation that would crop, blur, distort or retype official content. The result can be supplied as a short video and a lightweight animated format.

This extends the useful life of an already approved creative without requiring DGIPR to commission a full video from the beginning.

### 5.18 General-purpose government work assistant

Not every office task belongs in a fixed article, poster or translation workflow. AI NewsRoom therefore includes a flexible conversational workspace for tasks such as:

drafting a covering letter; explaining a government resolution in simpler terms; summarising a forwarded document; reading a photographed page; asking questions about an attached file; preparing a preliminary note or response; continuing a multi-turn working conversation.

The assistant can work with text, documents, images, audio and YouTube material. Conversations are saved in a thread list and responses appear progressively, allowing the officer to stop an answer when sufficient information has been received.

This flexible area is intentionally distinguished from governed publication workflows. Content intended for official publication should move through the article, translation or proofreading controls so it benefits from the relevant source, glossary and approval safeguards.

### 5.19 Background tasks, resilience and efficient retry

Long-running transcription, document reading, image creation and video work continue in the background. Officers can leave the page, open another task and return later through the ongoing-work panel.

AI NewsRoom preserves completed parts of a task when another part fails. For example, a finished article remains available if its poster fails, and successful transcripts remain available if one source cannot be processed. Retry actions target the missing operation rather than restarting the complete workflow.

Article intakes can be reopened at the exact review stage, including source corrections, page choices, confirmed names and key points. Multiple assignments can progress independently, which is important when several announcements are being prepared at the same time.

### 5.20 Searchable history, related-work threads and reuse

Completed articles, posters, social posts and thumbnails are stored in a searchable history. Officers can search by heading or source text, reopen previous results and access older work through pagination.

Related outputs are connected as a work thread. An approved article can become a social creative, Facebook post, caption or other follow-up without re-entering the source. A transcript can become a news intake without being transcribed again. A completed article intake can be reused to create a different article from the same approved sources and revised instructions.

This provides practical lineage between a source and its outputs, reduces duplicate effort and makes a coordinated multi-format campaign easier to manage.

### 5.21 Downloads and hand-off formats

AI NewsRoom supports practical hand-off to existing departmental processes. Depending on the output, officers can copy or download:

article text; Markdown and plain-text files; publication-ready article PDFs; English and Hindi translations; transcript text files; poster, creative and thumbnail images; social captions; final video files; timed subtitle files; individual historical-carousel slides.

This allows the platform to add value even where an existing website, records process, print workflow or social approval process remains in place.

### 5.22 Department-level usage analytics

AI NewsRoom provides management with a department-wide view of platform utilisation rather than an individual surveillance view. Officials can choose a reporting period and review:

total outputs; output counts by feature; daily activity trends; the department's mix of article, transcription, translation, proofreading, visual and video work; the user-facing task that caused each processing activity; calls or operations performed; natural units such as audio minutes, document pages, images or video clips; attributable estimated service cost where applicable.

This makes it easier to answer procurement and management questions such as which functions are delivering value, where demand is increasing and which activities account for operational consumption. Analytics records are operational estimates and are clearly distinguished from supplier invoices.

### 5.23 Marathi-first, cross-device user experience

The working interface is designed around Marathi labels and the practical needs of non-technical DGIPR staff. It supports access through desktop systems and mobile applications, giving officers a consistent experience across devices. It includes:

a consistent navigation system across all workspaces; responsive desktop and mobile layouts; an installable mobile-web experience; direct Android sharing for supported recordings; live progress indicators; an ongoing-tasks panel; clear warnings before high-impact actions; editable review cards rather than hidden automatic processing; user documentation with screenshots and step-by-step journeys.

The objective is to make advanced content-production support usable by officers without requiring them to understand the underlying services or write specialised instructions.

### 5.24 International multilingual translation

In addition to the platform's Marathi, Hindi and English workflows, AI NewsRoom will support translation into the Indian and international languages required for approved DGIPR communication. This will allow government news, press releases, scheme information, captions, campaign material, summaries and public-information content to reach national and international audiences.

International translation will include:

- translation into department-approved Indian and foreign languages supported by the approved model environment;
- preservation of official names, designations, scheme titles, dates, amounts and identifiers;
- glossary-backed translation and transliteration of repeated official terminology;
- language-specific review of people, places, organisations and schemes;
- preparation of multilingual articles, captions, summaries and campaign assets; and
- delivery of clean, publication-ready translated text for departmental review.

Translation and proofreading will remain separate functions. Translation creates a target-language version of the source, while proofreading checks and corrects a text already written in a particular language. High-importance international communication will remain subject to appropriate linguistic and departmental review before publication.

### 5.25 Studio interview and anchor-video production

DGIPR's studio produces **Dilkhulaas** and **Jai Maharashtra** interviews with ministers, officials and other guests for Doordarshan, the department's website and social-media channels. AI NewsRoom will include a complete studio-production tool that can be used directly by the studio team, as well as with assistance from HashCase's on-site personnel.

Before an interview, the system can use authorised source material and Semantic Search to prepare a guest brief, verify the guest's name and designation, suggest interview themes and questions, create an episode rundown and prepare teleprompter-ready introductions, transitions and closing copy.

For interview post-production, the tool will support:

- import and organisation of camera, microphone and studio recordings;
- audio-video synchronisation and assisted multi-camera alignment;
- combination of multiple recordings and clips into one complete programme;
- assisted identification and removal of long gaps, repeated takes and unusable portions;
- audio cleanup, noise reduction and volume balancing;
- programme intro, outro, transitions, header, footer, watermark and DGIPR branding;
- verified lower-third graphics containing each speaker's name and designation;
- automatic Marathi subtitles and time-coded caption files;
- review and correction of the complete interview before export; and
- delivery in the approved television, web and social-media formats.

The same approved interview can automatically produce a full transcript, time-coded transcript, blog article, interview summary, important quotations, episode title, description, social caption, thumbnail, promotional poster, teaser, highlights and vertical clips for Instagram Reels or YouTube Shorts. Important or newsworthy moments can be identified automatically for human review, while the full archive remains searchable by guest, subject, date and transcript content.

For news-anchor videos, the studio team can upload one or more raw camera recordings and use the tool to join clips, remove mistakes and repeated takes, shorten unnecessary pauses, clean the voice, add headlines and information callouts, apply approved headers and footers, generate subtitles and create both vertical and landscape outputs. It can also prepare the caption, thumbnail and promotional copy and derive multiple short clips from one longer recording.

### 5.26 Newspaper monitoring and media intelligence

AI NewsRoom will read approved print newspapers, e-papers and digital news sources and convert their coverage into structured, searchable media intelligence. OCR, layout understanding, Natural Language Processing (NLP), Named Entity Recognition (NER) and AI classification will be used to extract articles and identify relevant people, departments, schemes, locations, issues and sentiment.

The newspaper-monitoring workspace will support:

- extraction of articles and clippings from newspaper pages and e-papers;
- positive, negative and neutral news classification;
- separate identification of Chief Minister-related news;
- minister-, department-, scheme-, district-, publication- and topic-wise segregation;
- detection of urgent, sensitive or reputationally significant coverage;
- identification and removal of duplicate or syndicated reports;
- concise media summaries and detailed analysis reports;
- category-wise clipping books and PDF exports;
- comparison of coverage across publications, subjects and periods; and
- a searchable historical media archive.

AI will accelerate reading and classification, while ambiguous sentiment and high-impact reports can be sent for human review before they are included in an official brief or analysis.

### 5.27 Social-media campaign impact analysis

The platform will track and analyse the impact of DGIPR's approved social-media campaigns using the authorised performance data available from connected accounts and platforms. This is separate from the existing platform-usage analytics: usage analytics measure the work performed inside AI NewsRoom, while campaign analytics measure how published communication performs with the public.

Campaign analysis will include:

- reach, impressions, reactions, comments, shares, saves and link activity;
- video views, watch time and completion behaviour;
- follower and audience growth;
- performance by campaign, platform, topic, language and content format;
- comparison of organic and paid performance where authorised data is available;
- sentiment analysis and recurring themes in public responses;
- identification of high-performing and underperforming content;
- publishing-time, creative-format and subject-performance patterns;
- campaign-level trends and outcome summaries; and
- evidence-based recommendations for future public communication.

Results can be presented through dashboards, detailed analytical reports, management summaries, charts and presentation-ready exports.

### 5.28 Historical comparison and fact-checking using Mahasamvad and official sources

AI NewsRoom will provide an evidence-based fact-checking workspace grounded in Mahasamvad data, government resolutions, circulars, departmental records and other authorised primary government sources.

The workflow will identify factual claims in submitted content and use Semantic Search and Retrieval-Augmented Generation (RAG) to locate the most relevant supporting material. It will then:

- compare names, dates, amounts, designations, quotations and scheme information;
- distinguish current information from superseded historical information;
- search relevant Mahasamvad articles and exclude passing or unrelated mentions;
- identify the earliest relevant record and the latest confirmed position;
- explain what changed and what remained unchanged across the published record;
- identify changes in figures, deadlines, implementation stages and official decisions;
- build a chronological, source-linked timeline where historical comparison is required;
- identify unsupported or contradictory claims;
- attach source references and provenance to each important finding;
- classify a claim as verified, inconsistent, unsupported or requiring departmental confirmation; and
- generate a reviewable fact-check report containing the finding and its supporting evidence.

Where authorised sources conflict or do not provide sufficient information, the platform will show the uncertainty rather than inventing a conclusion. The verified evidence and historical comparison can also be converted into an anniversary post, progress explainer, background note, scheme update or source-linked Marathi carousel. Final factual acceptance will remain with DGIPR.

### 5.29 AI-assisted PowerPoint presentation production

AI NewsRoom will create presentation material from notes, documents, reports, campaign data and other information supplied by DGIPR. The presentation workflow will provide:

- structured presentation outlines and slide narratives;
- Marathi, English and multilingual slide content;
- DGIPR-branded layouts and reusable presentation templates;
- executive summaries, key-message slides and talking points;
- charts, timelines, process diagrams and programme summaries;
- relevant visual suggestions and supporting imagery;
- speaker notes;
- revisions based on departmental feedback; and
- editable PPTX and PDF deliverables.

This will allow long documents, meeting material, scheme information and analytical reports to be converted into concise, presentation-ready communication without recreating the content manually slide by slide.

### 5.30 AI-assisted RFP drafting

AI NewsRoom will assist DGIPR in preparing draft Requests for Proposals from the requirements provided for a new assignment. Previous DGIPR RFPs and other authorised procurement documents can be indexed in the private knowledge base and retrieved through Semantic Search. RAG will use the relevant approved sections as controlled structural references without silently carrying old project facts into the new document.

The RFP workflow can prepare:

- project background and statement of requirement;
- objectives and detailed scope of work;
- functional and technical specifications;
- deliverables and acceptance criteria;
- bidder eligibility requirements;
- evaluation criteria and scoring structures;
- compliance and response tables;
- documentation and reporting requirements; and
- editable Word and PDF drafts.

The system will produce a structured draft based on DGIPR's supplied requirements and authorised references. Procurement, financial, administrative and legal review and approval will remain with the department.

### 5.31 On-site operational personnel and output-quality support

One or two trained HashCase professionals will work on-site at a DGIPR-designated office location. This operational team will complement the self-service platform rather than replace it: DGIPR employees can continue to use AI NewsRoom directly, while the on-site personnel can operate it for assigned work and provide completed, review-ready outputs.

Their responsibilities will include:

- receiving and organising source material and content assignments;
- operating the article, transcription, translation, creative, video and intelligence workflows;
- preparing finished outputs for DGIPR review;
- conducting first-level source, language, terminology, layout and technical checks;
- incorporating corrections communicated by DGIPR;
- supporting the news, social-media, translation and studio teams;
- training and assisting other DGIPR employees in using the platform;
- identifying recurring work that can be simplified through additional AI workflows;
- communicating practical requirements to the technical team; and
- helping maintain consistent end-product quality.

DGIPR will provide the official source material and retain final factual, administrative and publication approval. The on-site arrangement ensures that the department receives continuing operational assistance and review-ready output in addition to access to the software itself.

## 6\. Expected organisational benefits

### 6.1 Government data sovereignty and infrastructure control

DGIPR will retain control over sensitive source material, AI inference, departmental knowledge indexes, generated outputs and operational records. Production models and data will operate on the substantial GPU and supporting hardware environment provided through DGIPR's designated data centre. This allows the department to determine where information is stored, who may access it, which models are approved and how data and model updates are governed.

### 6.2 A private AI capability adapted to DGIPR

The on-premises architecture will reduce dependence on uncontrolled public AI platforms and create a governed path for security review, model upgrades and capacity expansion. Local-development GPUs provided or funded by DGIPR will allow HashCase to develop, integrate, test and validate improvements before they are moved to the production data-centre environment. Fine-tuning, instruction tuning, RAG and glossary intelligence will adapt the capability to Marathi government communication and DGIPR's institutional requirements.

### 6.3 DGIPR can focus on review and approval

The combination of the AI platform and one or two on-site HashCase professionals changes the engagement from simple tool access to operational output support. HashCase can operate the workflows, conduct first-level quality checks and submit review-ready deliverables, allowing DGIPR officers to concentrate on factual judgement, official corrections and final approval.

### 6.4 Faster end-to-end public communication

One approved source can be converted into a news report, article, translation, poster, caption, thumbnail, presentation, fact-check or video without recreating the brief for every specialist. Background processing, targeted retries and reuse of completed stages reduce the time between receiving official information and obtaining a finished output.

### 6.5 Greater production capacity across formats

Transcription, document extraction, drafting, translation, proofreading, creative adaptation, subtitle preparation, clip assembly and report generation contain substantial repeatable work. AI automation supported by the on-site team will allow DGIPR to produce more communication across print, web, social media, television and international channels while retaining human supervision.

### 6.6 Stronger factual, linguistic and terminology control

Source review, name detection, designation confirmation, glossary controls, numeric safeguards, coverage checks and human-in-the-loop review create multiple opportunities to detect problems before publication. Translation and proofreading remain separate controlled functions, supporting clearer language without silently changing an official fact.

### 6.7 Evidence-backed fact verification

RAG-based fact-checking against Mahasamvad, government resolutions, departmental records and authorised primary sources will make the supporting evidence visible. Outdated, contradictory and unsupported claims can be identified and referred for departmental confirmation instead of being presented as established facts.

### 6.8 Consistent government identity

Central brand controls, verified lower thirds, standard video treatments and a governed template library will reduce inconsistent logos, incorrect designations, misplaced footers and unsuitable visual variations. The same controlled identity can be maintained across posters, thumbnails, anchor videos, studio interviews and explainer videos.

### 6.9 Wider national and international reach

Approved content can be delivered in Marathi, Hindi, English and additional Indian or international languages while protecting names, official terminology, dates, amounts and source meaning. This will allow DGIPR communication to reach audiences beyond its current language boundaries without rebuilding the source material for each language.

### 6.10 Higher value from studio production

One approved Dilkhulaas or Jai Maharashtra interview can produce a broadcast programme, transcript, blog article, summary, subtitles, quotations, thumbnail, promotional poster, teaser, highlights and vertical social videos. Anchor recordings can similarly become cleaned, branded and captioned outputs in multiple formats, increasing the value of every studio session.

### 6.11 Faster media awareness and reputational response

Newspaper extraction, sentiment classification and coverage segregation will give DGIPR a structured view of positive, negative, neutral, Chief Minister-related, department-related and issue-based news. Urgent or sensitive coverage can be identified more quickly, while searchable archives and PDF clipping books support briefings and historical comparison.

### 6.12 Measurable social-media campaign impact

Campaign analytics will connect published communication with reach, impressions, engagement, watch time, audience growth and public response. Comparisons across platforms, formats, topics and campaigns will help DGIPR identify what is working, understand underperforming communication and improve future campaign decisions using evidence rather than assumptions.

### 6.13 Better reuse and stronger institutional memory

Searchable history, related-work threads, Semantic Search and the Mahasamvad knowledge base will allow approved material to be reused rather than recreated. Historical reporting can support style retrieval, source-grounded fact verification, timelines and research even when staff responsibilities change.

### 6.14 Broader departmental productivity

AI-assisted PowerPoint production, RFP drafting and the multimodal government work assistant will extend the private AI environment beyond newsroom outputs. Long documents, meeting notes, requirements and analytical data can be converted into structured presentations, procurement drafts, summaries, background notes and other review-ready office material.

### 6.15 Reduced duplication and avoidable processing cost

Selecting pages before OCR, reusing transcripts, translating an approved source once, regenerating only one video scene, reassembling stored clips and retrying only failed stages will reduce repeated processing. Separating local-development GPUs from production infrastructure will also make later cost estimates clearer: HashCase's hardware estimate will include only the local-development GPUs, while DGIPR's data centre will provide the production hardware environment.

### 6.16 Better management visibility and continuous improvement

Department-level dashboards will connect completed outputs, activity, service consumption and attributable processing estimates to understandable tasks. Campaign reports and media-intelligence analysis will add visibility into external impact, while MLOps monitoring and evaluation will support controlled improvement of the underlying AI capability.

### 6.17 Continuing training and output-quality support

The on-site HashCase team will operate the system for assigned work, train and assist DGIPR employees, prepare review-ready deliverables and identify additional workflows that can be automated. This continuing operational presence will connect practical departmental needs with platform improvements while DGIPR retains final factual and publication authority.

## 7\. Indicative commercial estimate for the one-year engagement

The proposed commercial value for the complete AI NewsRoom solution is **₹5.00 crore (Rupees Five Crore only)** for a period of 12 months.

This estimate covers the design, development, configuration, integration and operation of all capabilities described in this proposal; HashCase's local development GPU systems; approved AI services; on-site personnel; central engineering support; preparation of review-ready outputs; maintenance; training; and delivery contingency.

### 7.1 Feature development and implementation

The following allocation covers the complete functional scope described in Sections 4 and 5. Related features are grouped together so that one shared platform capability is not charged repeatedly under multiple headings.

| Feature group                                          | Scope covered                                                                                                                                                       | One-year estimate |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------: |
| Core platform, security and unified workflow           | Private AI software stack, user access, workflow orchestration, Marathi-first interface and cross-device experience                                                 |          ₹22 lakh |
| Source intake and document intelligence                | Unified intake, long-document handling, scanned-document reading, OCR controls, audio and YouTube transcription                                                     |          ₹15 lakh |
| News, article and source-verification workflows        | Meeting-to-article, document-to-article, publication-ready Marathi content, Mahasamvad style intelligence, designation review, RAG grounding, historical comparison, source-linked timelines and fact-checking |          ₹31 lakh |
| Glossary, translation and proofreading                 | Shared verified glossary, Marathi/Hindi/English workflows, international multilingual translation and language correction                                           |          ₹16 lakh |
| Creatives, posters, thumbnails and publishing support  | Social creatives, article posters, YouTube thumbnails, reference library, controlled branding, captions, publishing assistance, visual feedback and version control |          ₹22 lakh |
| Explainer videos and motion creatives                  | Script, storyboard, scene generation, narration, subtitles, branding, scene-level revision, assembly and poster-to-motion workflows                                 |          ₹25 lakh |
| Studio interview and anchor-video production           | Interview preparation, multi-camera and audio assistance, programme finishing, subtitles, derivatives, anchor videos and channel-ready exports                      |          ₹28 lakh |
| Newspaper monitoring and media intelligence            | Newspaper ingestion, OCR, classification, sentiment review, clipping, reporting, trends and searchable archive                                                      |          ₹16 lakh |
| Social-media campaign impact analysis                  | Connected campaign data, performance metrics, sentiment, comparative analysis, dashboards and management reporting                                                  |          ₹10 lakh |
| General work assistant, presentations and RFP drafting | Governed office assistant, editable PowerPoint production and source-grounded RFP documentation                                                                     |          ₹10 lakh |
| History, reuse, downloads and department analytics     | Related-work threads, searchable history, reusable source lineage, hand-off formats, usage analytics and attributable service reporting                             |          ₹10 lakh |
| Integrations, administration, testing and acceptance   | Approved service integrations, platform administration, notifications, end-to-end testing, performance validation and acceptance support                            |          ₹10 lakh |
| **Subtotal: feature development and implementation**   |                                                                                                                                                                     |   **₹2.15 crore** |

### 7.2 Infrastructure, personnel, services and continuing delivery

| Cost component                                                 | Coverage                                                                                                                                                                                                                                                           | One-year estimate |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------: |
| HashCase local development GPU systems                         | GPU-equipped systems used by HashCase for model evaluation, RAG testing, integration, controlled fine-tuning, optimisation and pre-production validation                                                                                                           |          ₹50 lakh |
| Production deployment and systems integration                  | Technical sizing, installation, configuration and integration of the AI software stack on infrastructure supplied by DGIPR's designated data centre; production GPU hardware is not included                                                                       |          ₹17 lakh |
| Security hardening and validation                              | Access controls, encryption configuration, audit logging, security review support and deployment validation                                                                                                                                                        |          ₹13 lakh |
| Initial knowledge-base preparation                             | Approved-data ingestion, indexing, embeddings, glossary preparation and initial Mahasamvad knowledge-base setup                                                                                                                                                    |          ₹10 lakh |
| Development software and technical tooling                     | Development, testing, monitoring and collaboration tools required by the HashCase delivery team                                                                                                                                                                    |           ₹5 lakh |
| Two on-site HashCase professionals                             | Two personnel at ₹75,000 per person per month for 12 months to operate workflows, coordinate assignments, assist users and prepare outputs                                                                                                                         |          ₹18 lakh |
| Central engineering and MLOps team                             | Six personnel at ₹1 lakh per person per month for 12 months: two AI and backend engineers, one application and frontend engineer, one data and integration engineer, one MLOps and infrastructure engineer, and one quality-assurance and test-automation engineer |          ₹72 lakh |
| Project management, training and coordination                  | Delivery management, periodic reporting, departmental training, documentation, implementation coordination and necessary project travel                                                                                                                            |          ₹10 lakh |
| AI APIs and metered technology services                        | Consolidated usage provision for approved text, image, audio, video, transcription, translation and document-processing services                                                                                                                                   |          ₹60 lakh |
| Maintenance and controlled upgrades                            | Defect correction, compatibility updates, routine maintenance and approved incremental improvements during the engagement                                                                                                                                          |          ₹10 lakh |
| Delivery contingency reserve                                   | Provision for usage variation, technical changes, replacement requirements and unforeseen delivery needs                                                                                                                                                           |          ₹20 lakh |
| **Subtotal: infrastructure, personnel, services and delivery** |                                                                                                                                                                                                                                                                    |   **₹2.85 crore** |
| **Total proposed value for 12 months**                         |                                                                                                                                                                                                                                                                    |   **₹5.00 crore** |

### 7.3 Commercial clarifications

- The estimate includes implementation and operation of all features described in this proposal for the 12-month engagement.
- The local-development GPU allocation covers only the GPU systems used by HashCase for development, integration, testing and pre-production validation.
- Production GPUs, production compute servers, storage, networking, power, cooling, racks and other data-centre hardware will be provided and maintained by DGIPR's designated data centre and are not included in the ₹5.00 crore estimate.
- HashCase will perform production architecture sizing, deployment, configuration and optimisation within the stated production-deployment allocation.
- The AI API provision is consolidated because approved providers and models may change according to output quality, security, availability and cost considerations. It does not commit DGIPR or HashCase to any named external provider.
- API consumption and infrastructure utilisation will be monitored. Expected service volumes and any approval process for usage materially above those volumes will be finalised during contracting.
- The estimate provides for an eight-person HashCase team: two professionals working on-site and six members of the central engineering and MLOps team. DGIPR will continue to retain final factual, administrative and publication approval.
- The final technical bill of materials, service volumes, deployment schedule, acceptance criteria and payment milestones will be agreed during contracting.

## 8\. Conclusion

AI NewsRoom is proposed as a complete, secure and operational AI capability for DGIPR—not merely as access to another software tool. It combines a Marathi-first content platform, a private departmental knowledge environment, specialised public-relations workflows and continuing HashCase support so that official source material can be converted into finished, review-ready communication through one governed system.

The on-premises foundation will keep DGIPR in control of its sensitive information, approved models, embeddings, vector database, institutional knowledge and generated outputs. DGIPR's designated data centre will provide and maintain the substantial GPU and supporting hardware required for production deployment. A separate, smaller GPU environment provided or funded by DGIPR will support HashCase's local development, integration, testing, model adaptation and pre-production validation. Only this local-development GPU requirement is included in HashCase's hardware estimate. HashCase will perform technical sizing and deploy, configure, integrate, evaluate and optimise the AI software stack across both environments.

Semantic Search, Retrieval-Augmented Generation, model fine-tuning, MLOps, source provenance and human-in-the-loop review will provide the technical foundation for reliable government communication. Official documents and authorised departmental records will remain the factual source of truth. The platform will use this controlled foundation to support source intake, transcription, Marathi news and article production, national and international translation, proofreading, creatives, captions, posters, thumbnails, explainer videos, studio interviews, anchor videos, newspaper intelligence, campaign-impact analysis, historical comparison and fact-checking, presentations, RFP drafts and other departmental work.

The combination of the platform and on-site HashCase personnel will reduce the operational burden on DGIPR employees. HashCase will operate assigned workflows, prepare outputs, perform first-level quality checks, incorporate corrections, train users and identify additional opportunities for automation. DGIPR officers will remain responsible for official interpretation, factual confirmation, final approval and publication.

This proposal therefore establishes a long-term AI Newsroom capability that brings together data sovereignty, institutional memory, faster multi-format production, evidence-backed verification, multilingual reach, media intelligence and measurable communication impact. Its central outcome is clear: DGIPR receives secure technology, continuing operational support and finished communication outputs, while retaining complete authority over government information and public publication.
