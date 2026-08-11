// Every Marathi UI string in one place (no i18n library — the UI is Marathi-first
// with small English hints). Keep wording plain and free of technical jargon:
// the users are non-technical government communication staff.

import type {
  Category,
  DloIntakeStep,
  GenerationStep,
  GenerationStatus,
  ProofreadIssueType,
  ReferenceCategory,
  TermType,
} from '@dgipr/schemas';

export const STR = {
  appName: 'महासंवाद मजकूर मंच',
  appSubtitle: 'माहिती व जनसंपर्क महासंचालनालय, महाराष्ट्र शासन',
  navNew: 'क्रिएटिव्ह आणि सोशल',
  navHistory: 'मागील काम',
  navTranslate: 'भाषांतर',
  navProofread: 'मुद्रितशोधन',
  navGlossary: 'शब्दकोश',
  navReferences: 'मास्टर टेम्पलेट',
  navDlo: 'लेख / बातमी',
  navTranscribe: 'ध्वनिलेखन',
  navMenu: 'मेनू',
  navCollapse: 'मेनू लहान करा',
  navExpand: 'मेनू मोठा करा',
  poweredBy: 'Powered by',
  installAppTitle: 'मोबाईलवर Newsroom जोडा',
  installAppHint:
    'एकदा जोडल्यानंतर WhatsApp किंवा Recorder मधून ध्वनिफीत थेट येथे पाठवता येईल.',
  installAppAction: 'मोबाईलवर जोडा',
  installAppDismiss: 'आत्ता नको',

  // New-generation form
  newTitle: 'नवीन बातमी / पोस्टर तयार करा',
  noteLabel: 'टिपणी येथे लिहा किंवा चिकटवा',
  noteHint: 'Paste your official note (टिपणी) here',

  // Media-room home page: paste a FINISHED article, then make a poster / social post
  // from it (no article is written here — the pasted text is used as-is).
  mediaRoomTitle: 'पोस्टर व सोशल पोस्ट तयार करा',
  mediaRoomIntro:
    'तयार झालेला लेख चिकटवा किंवा फाईलमधून घ्या — त्यावरून पोस्टर, ट्विटर व फेसबुक पोस्ट किंवा फक्त कॅप्शन तयार होईल.',
  // The one text box on this page is now the POSTER'S OWN TEXT, not a finished article:
  // क्रिएटिव्ह and यूट्यूब थंबनेल print everything typed here. बॅनर is the one exception —
  // there the text is kept as the article and only the main name / heading is picked out of
  // it — so the label stays single and the HINT carries that difference, rather than a
  // label that changes below the fold (the format cards sit under this card, not above it).
  articlePasteLabel: 'पोस्टरवर जो मजकूर हवा आहे तो येथे लिहा',
  articlePasteHint:
    'क्रिएटिव्ह व यूट्यूब थंबनेलसाठी येथे लिहिलेला सर्व मजकूर पोस्टरवर छापला जातो — म्हणून फक्त जेवढे पोस्टरवर हवे तेवढेच लिहा. बॅनरसाठी मात्र या मजकुरातील मुख्य नाव / शीर्षक शोधून तेच बॅनरवर येते. खालून फाईलमधूनही मजकूर घेता येईल — दोन्ही एकत्रही करता येईल.',
  articlePastePlaceholder:
    'उदा. पोस्टरवर हवे असलेले मुद्दे, नावे, तारखा व आकडे येथे लिहा…',
  // Where the poster's WORDS come from — independent of who DESIGNS it (the template picker).
  // This was a pair of tabs above the text box ("लेखातून मजकूर तयार करा" / "जसाच्या तसा मजकूर")
  // asking a question with a strong default: almost every run wants the copy written out of the
  // box, so one OPT-IN checkbox under the box says the same thing in a quarter of the height.
  // Unticked (the default) → generatePosterCopy writes the poster's words out of the box
  // ('fresh' with no template, 'adaptive' with one); ticked → the box is printed unchanged
  // ('fresh_verbatim' with no template, 'onbrand' with one). It may not name the template:
  // both answers are available with or without one. बॅनर and यूट्यूब ignore designMode
  // entirely, so it never appears there.
  posterSourceVerbatim: 'जसाच्या तसा मजकूर',
  posterSourceVerbatimDesc:
    'वर लिहिलेला मजकूर जसाच्या तसा पोस्टरवर छापला जातो — एकही शब्द बदलला जात नाही. निवडले नाही तर त्यातून पोस्टरचा मजकूर AI तयार करते.',
  // The text box's own label/hint follow that checkbox: unticked, the box holds a
  // finished article, not the poster's words, so promising "सर्व मजकूर पोस्टरवर छापला जातो"
  // there would be false.
  articleSourceLabel: 'तयार लेख येथे चिकटवा',
  articleSourceHint:
    'संपूर्ण लेख येथे चिकटवा — त्यातील मुख्य मुद्दे, नावे, तारखा व आकडे निवडून पोस्टरचा मजकूर तयार केला जातो. खालून फाईलमधूनही मजकूर घेता येईल — दोन्ही एकत्रही करता येईल.',
  articleSourcePlaceholder: 'उदा. तयार झालेला मराठी लेख येथे चिकटवा…',
  // ONE flat row of formats — यूट्यूब थंबनेल / ट्विटर / फेसबुक / लेख पोस्टर / व्हिडिओ.
  // Deliberately NOT the categoryTwitter/categoryFacebook pair, whose descriptions promise
  // "पोस्टर + कॅप्शन": the caption is now an opt-in checkbox under those two cards.
  mediaOutputLabel: 'काय तयार करायचे?',
  mediaFormatYoutube: 'यूट्यूब थंबनेल',
  mediaFormatYoutubeDesc: 'यूट्यूब व्हिडिओसाठी मराठी थंबनेल',
  // One card for both social platforms: X and फेसबुक run the identical poster flow
  // (same ठरलेले टेम्पलेट path, same master library), so asking which one was a question
  // with no consequence at this step.
  mediaFormatCreative: 'क्रिएटिव्ह',
  mediaFormatCreativeDesc: 'सोशल मीडियासाठी मराठी पोस्टर',
  mediaFormatArticlePoster: 'लेख पोस्टर',
  mediaFormatArticlePosterDesc: 'लेखासोबत प्रसिद्ध करण्यासाठीचे पोस्टर',
  mediaOutputVideo: 'व्हिडिओ',
  mediaOutputVideoDesc: 'टिपणीवरून मराठी व्हिडिओ',
  notePlaceholder:
    'उदा. शासन निर्णय, बैठकीची टिपणी, योजनेची माहिती… ही टिपणीच लेखाचा एकमेव आधार असेल.',
  headingLabel: 'शीर्षक किंवा बातमीचा रोख (ऐच्छिक)',
  headingHint:
    'शीर्षक द्या, किंवा बातमीचा रोख थोडक्यात सांगा — रिकामे ठेवल्यास मंच स्वतः रोख ठरवेल.',
  headingPlaceholder: 'उदा. कर्जमुक्तीमुळे ग्रामीण अर्थव्यवस्थेला नवी ऊर्जा',
  // The officer-supplied STYLE reference (tier 1). The hint has one job: make it unmistakable
  // that this sample is copied for its SHAPE and never for its facts — an officer who pastes
  // a related news item expecting its details to be reused would be misreading the field.
  styleRefLabel: 'नमुना बातमी — शैलीसाठी (ऐच्छिक)',
  styleRefHint:
    'आधी प्रसिद्ध झालेली एखादी बातमी इथे चिकटवा; तिची मांडणी, शीर्षक-रचना व भाषाशैली नमुना म्हणून वापरली जाईल. यातील कोणतीही माहिती, नावे किंवा आकडे नव्या बातमीत घेतले जाणार नाहीत — त्यासाठी टिपणीच एकमेव आधार आहे. रिकामे ठेवल्यास मंच जुळणारी महासंवाद बातमी स्वतः निवडेल.',
  styleRefPlaceholder:
    'उदा. महासंवादवर आधी प्रसिद्ध झालेल्या बातमीचा संपूर्ण मजकूर…',
  // The officer's trusted request for ONE news item: both writing direction and factual input.
  aiInstructionsLabel: 'तुमची विनंती (ऐच्छिक)',
  aiInstructionsHint:
    'बातमी कशी हवी, कशावर भर द्यायचा, काय वगळायचे किंवा कोणती माहिती दुरुस्त करायची ते लिहा. येथे दिलेली माहिती अधिकृत मानली जाईल.',
  aiInstructionsPlaceholder:
    'उदा. ५० कोटींच्या निधीवर भर द्या; समिती सदस्यांची यादी टाळा; भाषा सोपी ठेवा.',
  aiInstructionsTooLong: 'सूचना खूप मोठ्या आहेत — कृपया थोडक्यात लिहा.',

  // Deliberately neutral: the two options are बातमी and योजना-लेख, so naming either one
  // in the question would misdescribe the other.
  categoryLabel: 'कोणता प्रकार?',
  categoryScheme: 'योजना-लेख',
  categorySchemeDesc: 'सविस्तर, चिंतनशील महासंवाद फीचर-लेख',
  categoryNews: 'बातमी',
  categoryNewsDesc: 'नेमकी, वस्तुनिष्ठ बातमी (dateline शैली)',
  categoryTwitter: 'ट्विटर पोस्ट',
  categoryTwitterDesc: 'X (ट्विटर) साठी मराठी पोस्टर + कॅप्शन',
  categoryFacebook: 'फेसबुक पोस्ट',
  categoryFacebookDesc: 'फेसबुकसाठी मराठी पोस्टर + कॅप्शन',

  // Design-mode selector (shown only for the समाजमाध्यम — ट्विटर/फेसबुक — flows)
  designModeLabel: 'पोस्टरची रचना-शैली?',
  designFresh: 'AI रचना',
  designFreshDesc:
    'प्रत्येक वेळी पूर्णपणे नवे, वेगळे पोस्टर — रंग व रचना AI ठरवते',
  designOnbrand: 'ठरलेले टेम्पलेट',
  designOnbrandDesc: 'निवडलेल्या टेम्पलेटनुसार तसेच पोस्टर',

  // विभाग (template brand) selector — shown only for the social flows. Picks which
  // department's template family the poster follows. CMO just follows its template,
  // so choosing it hides the रचना-शैली options above.
  brandLabel: 'विभाग?',
  brandDgipr: 'DGIPR',
  brandDgiprDesc: 'माहिती व जनसंपर्क महासंचालनालयाचे टेम्पलेट',
  brandCmo: 'मुख्यमंत्री कार्यालय (CMO)',
  brandCmoDesc: 'मंत्रिमंडळ निर्णय शैलीतील ठरलेले टेम्पलेट',

  // Shown on the ट्विटर/फेसबुक cards while one such task is already running. Both
  // lanes share one n8n workflow, so either post blocks the other.
  socialBusyInfo:
    'एक समाजमाध्यम पोस्ट सध्या तयार होत आहे. ती पूर्ण झाल्यावर नवीन सुरू करता येईल.',

  // Shown on the योजना/बातमी cards while a news/scheme run is already in flight
  articleBusyInfo:
    'एक बातमी सध्या तयार होत आहे. ती पूर्ण झाल्यावर नवीन सुरू करता येईल.',

  outputTypeLabel: 'काय तयार करायचे?',
  outputArticle: 'लेख',
  outputArticleDesc: 'महासंवाद शैलीतील सविस्तर मराठी लेख',
  outputPoster: 'पोस्टर',
  outputPosterDesc: 'समाजमाध्यमांसाठी तयार मराठी पोस्टर',
  outputBoth: 'दोन्ही',
  outputBothDesc: 'लेख आणि त्यावर आधारित पोस्टर',
  submit: 'तयार करा →',
  submitting: 'पाठवत आहोत…',
  docReadingForSubmit: 'फाईल वाचत आहे…',
  noteTooShort: 'कृपया किमान २० अक्षरांची टिपणी लिहा.',
  // The media room's own version. It is a SEPARATE string rather than a reworded
  // noteTooShort because that one is still shown by the detail page's edit-note rerun,
  // which keeps the 20-character article minimum — poster text can legitimately be a
  // handful of characters ('भारत टॅक्सी' is 11).
  posterTextTooShort: 'कृपया पोस्टरवर छापायचा मजकूर लिहा.',

  // DLO (Digital Liaison Officer) interface — meeting notes + recordings +
  // documents → transcription/extraction → editable review → article.
  //
  // The officer-facing word for the output is बातमी, not लेख, throughout this block and
  // in ArticleView/STEP_LABELS below: ~95% of DLO runs are news. योजना-लेख survives as the
  // name of the OTHER category card, which is the one place the distinction is the point.
  dloTitle: 'DLO — बैठकीतून बातमी',
  /* The page header's one-liner, and now /dlo's ONLY blurb: the notes card used
     to repeat the same sentence under a "नवीन काम" title of its own, which put
     three lines of prose between the officer and the first box they type in. */
  dloPageIntro:
    'बैठकीचे ध्वनिमुद्रण, कागदपत्रे आणि टिपणी एकत्र करून त्यांतून प्रसिद्धीयोग्य मराठी बातमी तयार करा.',
  /* UNUSED — was the notes card's hint before the line above absorbed it. Kept
     like dloNewWork/dloNewWorkTitle below, so restoring that card is one edit. */
  dloIntro:
    'बैठकीतील टिपणी, ध्वनिमुद्रण (MP3, WAV, M4A आदी) आणि कागदपत्रे (PDF/DOCX/TXT) येथे द्या — या सर्व माहितीतून बातमी तयार होईल.',
  dloStepInput: 'माहिती द्या',
  dloStepProcessing: 'प्रक्रिया',
  // The middle rail step now covers processing + the Pointers selection + the source review,
  // so its label names the two things the officer does there.
  dloStepReview: 'मुद्दे व तपासणी',
  dloStepOutput: 'तयार बातमी',
  dloNotesLabel: 'बैठकीतील टिपणी येथे लिहा',
  dloNotesHint:
    'बैठकीत जे ऐकले, ठरले किंवा आठवते ते सर्व येथे लिहा — मुद्दे, निर्णय, घोषणा, आकडेवारी.',
  dloNotesPlaceholder:
    'उदा. आजच्या बैठकीत मा. मंत्री महोदयांनी… असे जाहीर केले; योजनेसाठी … कोटी रुपयांची तरतूद…',
  // All three file sources are attached from ONE card (components/DloSourcesCard) — the
  // question "what do you want to add?" is the same for each, and three cards asking it made
  // the officer scroll past two they were not using. The hint carries the difference that is
  // real: a recording and a photograph are read during प्रक्रिया, while a document is read
  // here and now, page by page, with a scan stopping to ask which pages are worth OCR'ing
  // before a single credit is spent.
  dloAttachTitle: 'स्रोत जोडा',
  dloAttachHint:
    'बैठकीचे ध्वनिमुद्रण, कागदपत्रांचे फोटो आणि PDF / DOCX / TXT फाईल — एकावेळी अनेक जोडता येतील (प्रत्येकी कमाल ५० MB). ध्वनिमुद्रण व प्रतिमांमधील मजकूर प्रक्रियेदरम्यान वाचला जाईल; स्कॅन केलेल्या PDF मधून कोणती पृष्ठे वाचायची ते तुम्ही येथेच निवडाल.',

  // UNUSED since the three cards became one: /dlo's recording control no longer titles
  // itself, and /transcribe passes its own copy (transcribeNewTitle / transcribeHint).
  // Kept so restoring a standalone recording card is one edit.
  dloAudioTitle: 'ध्वनिमुद्रण',
  dloAudioHint:
    'बैठकीचे ध्वनिमुद्रण — एकावेळी अनेक फाईल जोडता येतील (प्रत्येकी कमाल ५० MB). मोबाईलवरील नेहमीचे ध्वनिफीत प्रकार चालतात.',
  dloAudioUpload: 'ध्वनिफीत जोडा',
  dloAudioFilesTitle: 'जोडलेली ध्वनिमुद्रणे',

  // Photographs of documents. UNUSED title/hint, for the same reason as the recording pair
  // above; what the photographs are for is now said once in dloSourcesHint.
  dloImagesTitle: 'प्रतिमा / छायाचित्रे',
  dloImagesHint:
    'शासन निर्णय, टिपणी, तक्ता किंवा नोटिशीचा फोटो अथवा स्क्रीनशॉट (JPG, PNG, WEBP — प्रत्येकी कमाल ५० MB). प्रतिमेतील मजकूर, तक्त्यांसह, प्रक्रियेदरम्यान वाचला जाईल आणि तपासणी टप्प्यावर दिसेल.',
  dloImagesUpload: 'प्रतिमा जोडा',
  dloImagesFilesTitle: 'जोडलेल्या प्रतिमा',
  dloImageTypeError: 'कृपया प्रतिमा फाईल निवडा (JPG, PNG किंवा WEBP).',
  dloDocsTitle: 'कागदपत्रे (PDF / DOCX / TXT)',
  dloDocsHint:
    'शासन निर्णय, टिपणी किंवा इतर कागदपत्रे. प्रत्येक फाईल येथेच वाचली जाते — स्कॅन केलेल्या PDF मधून कोणती पृष्ठे वाचायची ते तुम्ही निवडाल.',
  // One document block's own heading, inside the sources card.
  dloDocsCardTitle: 'कागदपत्र',
  dloDocsIntakeHint:
    'PDF, DOCX किंवा TXT फाईल निवडा (कमाल ५० MB). स्कॅन केलेली PDF देखील चालते. फाईल या बैठकीसोबत जतन केली जाईल.',
  // Two different controls. The first is the worded button in the attach row, shown only
  // while there is no document block yet; the second is the + under the blocks, where it is
  // the icon's title + aria-label rather than visible text.
  dloDocsUpload: 'कागदपत्र जोडा',
  dloDocsAdd: 'आणखी कागदपत्र जोडा',
  dloRemoveFile: 'फाईल काढा',

  // YouTube links as a source, shared by /dlo and /transcribe (components/YouTubeLinkInput).
  // The hint says plainly that nothing is downloaded and nothing is stored — an officer
  // pasting a public link deserves to know the video itself is not being copied anywhere.
  ytTitle: 'यूट्युब व्हिडिओ',
  ytHint:
    'पत्रकार परिषद किंवा कार्यक्रमाची यूट्युब लिंक द्या — त्यातील बोलणे मराठीत उतरवले जाईल. लिंक चिकटवताच ती आपोआप तपासली जाते. व्हिडिओ डाउनलोड किंवा जतन केला जात नाही; फक्त लिंक साठवली जाते.',
  ytPlaceholder: 'लिंक इथे चिकटवा — https://www.youtube.com/watch?v=…',
  ytAdding: 'तपासत आहोत…',
  ytRemove: 'लिंक काढा',
  ytClear: 'लिंक पुसा',
  ytListTitle: 'जोडलेले व्हिडिओ',
  ytInvalid:
    'ही यूट्युब व्हिडिओची लिंक वाटत नाही. उदा. https://www.youtube.com/watch?v=… किंवा https://youtu.be/…',
  ytDuplicate: 'ही लिंक आधीच जोडली आहे.',
  ytAtLimit: 'एकावेळी कमाल १० लिंक जोडता येतील.',
  // Shown in place of the channel when the probe could not describe the video — a private,
  // unlisted or region-blocked one. The source still works; only its name is unknown.
  ytUnknown: 'व्हिडिओची माहिती मिळाली नाही — लिंक तपासून पाहा.',
  ytSourceLabel: 'यूट्युब व्हिडिओ',
  ytOpen: 'यूट्युबवर पाहा',
  dloFileTypeError:
    'कृपया ध्वनिमुद्रण फाईल निवडा (MP3, M4A, AAC, AIFF, OGG, OPUS, WAV, FLAC किंवा WEBM).',
  dloNeedInput: 'कृपया टिपणी लिहा, किमान एक फाईल जोडा किंवा यूट्युब लिंक द्या.',
  dloSubmit: 'पुढे जा →',
  dloProcessingTitle: 'माहितीवर प्रक्रिया सुरू आहे…',
  dloProcessingHint:
    'यास काही मिनिटे लागू शकतात. हे पान उघडे ठेवा किंवा नंतर परत या.',
  dloProcessingNotes: 'टिपणी दिली आहे',
  dloProcessingFilesSuffix: 'फाईल जोडल्या आहेत',
  dloSourcesTitle: 'स्रोतांची स्थिती',
  dloFileStatusPending: 'प्रक्रियेत…',
  dloFileStatusDone: 'पूर्ण ✓',
  dloFileStatusFailed: 'अयशस्वी',
  dloCharsSuffix: 'अक्षरे',
  dloReviewTitle: 'मजकूर तपासा व दुरुस्त करा',
  dloReviewHint:
    'खालील मजकूर टिपणी, ध्वनिमुद्रण व कागदपत्रांतून तयार झाला आहे. नावे, आकडे, पदनामे व योजनांची नावे तपासून हवे ते बदल करा — हाच मजकूर बातमीचा एकमेव आधार असेल.',
  dloReviewFailedWarning:
    'काही फाईल्समधून मजकूर मिळाला नाही — त्यांशिवाय पुढे जाता येईल:',
  dloReviewTooShort: 'कृपया किमान २० अक्षरांचा मजकूर ठेवा.',
  // Review step: one card per source (notes / each recording / each document),
  // PDFs with page-wise selection.
  dloReviewNotesTitle: 'बैठकीतील टिपणी',
  dloReviewInclude: 'बातमीत समाविष्ट करा',
  dloReviewExcluded: 'वगळले आहे',
  dloReviewKindAudio: 'ध्वनिमुद्रण',
  dloReviewKindImage: 'प्रतिमा',
  dloReviewKindPdf: 'PDF कागदपत्र',
  dloReviewKindDocx: 'DOCX कागदपत्र',
  dloReviewKindTxt: 'TXT फाईल',
  // The photograph beside its transcript, so a misread name can be checked against the
  // original without leaving the page. The link opens it full size — a phone photo of a
  // dense GR is unreadable at thumbnail width.
  dloReviewImageOpen: 'मूळ प्रतिमा मोठी करून पाहा',
  dloReviewImageAlt: 'जोडलेली प्रतिमा',
  dloReviewImageEmpty:
    'या प्रतिमेत वाचता येईल असा मजकूर आढळला नाही. मूळ प्रतिमा तपासा — गरज असल्यास मजकूर येथे स्वतः लिहू शकता.',
  dloReviewPagesSuffix: 'पृष्ठे',
  dloReviewPagesSelected: 'पृष्ठे निवडली',
  dloReviewNoPages: 'या PDF मधून एकही पान निवडलेले नाही.',
  dloReviewSourceFailed: 'या फाईलमधून मजकूर मिळाला नाही.',
  // A scanned PDF waiting for its page selection. Its text does not exist yet — producing
  // it is the OCR being authorised — so the officer chooses by page number alone.
  dloReviewNeedsSelection:
    'ही स्कॅन केलेली PDF आहे, त्यामुळे प्रत्येक पृष्ठ OCR ने वाचावे लागेल. फक्त निवडलेलीच पृष्ठे वाचली जातील, म्हणून नको असलेली पृष्ठे आताच वगळा.',
  dloReviewNeedsSelectionChip: 'वाचायचे बाकी',
  dloReviewReadSelected: 'निवडलेली पृष्ठे वाचा',
  dloReviewReadSelectedHint:
    'निवडलेली पृष्ठे OCR ने वाचली जातील. यास काही मिनिटे लागू शकतात.',
  dloReviewReading: 'निवडलेली पृष्ठे वाचत आहोत…',
  dloReviewSelectionPending:
    'बातमी तयार करण्यापूर्वी वरील स्कॅन केलेल्या PDF ची पृष्ठे वाचून घ्या.',
  dloReviewNoPagesPicked: 'किमान एक पृष्ठ निवडा.',
  dloReviewTotal: 'बातमीसाठी वापरला जाणारा मजकूर:',
  dloReviewPreviewShow: 'पूर्ण मजकूर पाहा',
  dloReviewPreviewHide: 'पूर्ण मजकूर लपवा',
  dloReviewEmpty: 'कोणताही मजकूर निवडलेला नाही — किमान एक स्रोत निवडा.',
  dloReviewRereading: 'OCR ने पुन्हा वाचत आहे…',
  // व्यक्ती व पदनाम: the designation the article will print before each person's name. A blank
  // field means the name prints bare — a designation is never guessed from the note.
  designationsTitle: 'व्यक्ती व पदनाम तपासा',
  designationsHint:
    'बातमीत या व्यक्तींचा पहिला उल्लेख "पदनाम + नाव" असा होईल (उदा. मुख्यमंत्री देवेंद्र फडणवीस). पदनाम रिकामे ठेवल्यास फक्त नाव येईल. इंग्रजी व हिंदी भाषांतरातही हेच पदनाम वापरले जाईल.',
  designationsLoading: 'व्यक्तींची नावे तपासत आहोत…',
  designationsEmpty:
    'या मजकुरात कोणत्याही व्यक्तीचे नाव आढळले नाही. पुढे जा — पदनामाची गरज नाही.',
  designationsError:
    'नावे तपासताना अडचण आली. पुन्हा प्रयत्न करा किंवा पदनामाशिवाय पुढे जा.',
  designationsRegenerate: 'नावे पुन्हा तपासा',
  designationsName: 'नाव',
  designationsDesignation: 'पदनाम',
  designationsPlaceholder: 'उदा. मुख्यमंत्री (ऐच्छिक)',
  designationsRemember: 'यापुढेही हेच वापरा',
  designationsRememberHint:
    'खूण केल्यास हे पदनाम नाव-शब्दकोशात जतन होईल आणि पुढच्या बातमीत आपोआप भरले जाईल.',
  designationsAddName: '+ आणखी व्यक्ती जोडा',
  designationsNamePlaceholder: 'उदा. देवेंद्र फडणवीस',
  designationsKnown: 'शब्दकोशातील पदनाम',
  designationsNew: 'नवीन नाव',
  // A person the note does NOT name: the note mentions an office (मुख्यमंत्री) and the
  // नाव-शब्दकोश knows exactly one verified holder of it. Pre-ticked so it is not dropped by
  // inaction, but shown by name before generating so the officer can untick it — an
  // office-holder can change, and only the officer knows whose meeting this was.
  designationsSuggested: 'शब्दकोशातून सुचवलेले',
  designationsSuggestHint:
    'टिपणीत पदनाम आहे पण नाव नाही. नाव-शब्दकोशानुसार हे पदनाम खालील व्यक्तीचे आहे आणि ते बातमीत वापरले जाईल. चुकीचे असल्यास खूण काढून टाका.',
  // The पदनाम was read off the officer's own note, where the title stands immediately before
  // the name ("उपमुख्यमंत्री एकनाथ शिंदे"). Labelled so it is clear this came from the text and
  // not from the शब्दकोश — the officer can clear it like any other.
  designationsFromText: 'टिपणीतून',
  designationsFromTextHint:
    'काही पदनामे टिपणीत नावाच्या आधी लिहिली आहेत, ती इथे आपोआप भरली आहेत. चुकीची असल्यास बदला किंवा रिकामी करा.',
  // Per-row "mark this name checked": writes the नाव-शब्दकोश row's verified flag, so the
  // spelling locks into future translations without a trip to /glossary.
  designationsVerify: 'तपासले म्हणून खूण करा',
  designationsVerifying: 'खूण करत आहोत…',
  designationsVerifyError: 'खूण करता आली नाही. पुन्हा प्रयत्न करा.',
  designationsSkip: 'पदनामाशिवाय पुढे जा',
  designationsConfirm: 'पदनामे निश्चित करा व तयार करा →',
  designationsChecking: 'नावे तपासत आहोत…',
  // Read-only summary on a generation detail page. This deliberately avoids "तपासा":
  // unlike the DLO authoring card it does not gate or mutate the generation.
  usedNamesTitle: 'व्यक्ती व पदनाम',
  usedNamesHint:
    'तयार झालेल्या मजकुरात व्यक्तींची नावे व पदनामे जशी वापरली आहेत तशी येथे दिसतील.',
  usedNamesLoading: 'वापरलेली नावे ओळखत आहोत…',
  usedNamesEmpty: 'या मजकुरात कोणत्याही व्यक्तीचे नाव आढळले नाही.',
  usedNamesUnavailable:
    'वापरलेल्या नावांची यादी सध्या तयार करता आली नाही. निर्मितीवर याचा परिणाम झालेला नाही.',
  usedNamesNoDesignation: 'पदनाम नमूद नाही',
  // Shown on the finished article when an approved designation could not be applied.
  designationWarnTitle: 'पदनामाबाबत लक्ष द्या',
  designationWarnNotFound:
    'यांचे पूर्ण नाव बातमीत आढळले नाही, त्यामुळे पदनाम जोडता आले नाही:',
  designationWarnCorrected: 'बातमीतील चुकीचे पदनाम बदलले:',
  // Shown when the officer asked for a length in तुमची विनंती (or in the feedback box) and the
  // article did not reach it. Deliberately says WHY: the platform does not invent material to
  // fill a length, so the honest fix is more source material — or accepting the shorter piece.
  lengthWarnTitle: 'मागितलेली लांबी गाठता आली नाही',
  lengthWarnShort: (requested: string, actual: string) =>
    `तुम्ही सुमारे ${requested} मागितले होते; बातमी ${actual} झाली आहे. दिलेल्या माहितीत एवढाच आशय असल्याने लांबी वाढवण्यासाठी नवीन मजकूर तयार केलेला नाही. अधिक लांब बातमीसाठी टिपणीत आणखी माहिती द्या.`,
  lengthWarnLong: (requested: string, actual: string) =>
    `तुम्ही सुमारे ${requested} मागितले होते; बातमी ${actual} झाली आहे. आणखी कमी केल्यास महत्त्वाची माहिती वगळावी लागली असती.`,
  lengthUnitChars: (count: number) =>
    `${count.toLocaleString('mr-IN')} अक्षरे`,
  lengthUnitWords: (count: number) => `${count.toLocaleString('mr-IN')} शब्द`,
  // Shown on a social poster whose information held more items than any master template lays
  // out. The poster DOES carry every item — the design was stretched to fit — so this is a
  // "check it reads well, or split the note" prompt, not an error.
  posterCapacityWarnTitle: 'मुद्दे टेम्पलेटच्या क्षमतेपेक्षा जास्त आहेत',
  posterCapacityWarnBody: (needed: number, available: number) =>
    `तुम्ही दिलेल्या माहितीत ${needed} मुद्दे आहेत, पण उपलब्ध टेम्पलेटमध्ये साधारण ${available} मुद्दे मावतात. सर्व मुद्दे पोस्टरवर दाखवले आहेत, मात्र मजकूर दाटीवाटीने आला असू शकतो. पोस्टर तपासून पाहा — गरज वाटल्यास माहिती दोन पोस्टरमध्ये विभागून पुन्हा तयार करा.`,
  dloGenerate: 'बातमी तयार करा →',
  dloOutputTitle: 'तयार झालेली बातमी',
  dloViewDetail: 'सविस्तर पाहा (अभिप्राय, भाषांतर, पोस्टर)',
  dloStartOver: 'पुन्हा सुरुवात करा',
  dloNewArticle: 'नवीन DLO बातमी तयार करा',
  dloRegenerateArticle: 'याच स्रोतातून पुन्हा बातमी तयार करा',

  // Several officers work at once, so /dlo is a list of work and each intake lives at its
  // own address. 'काम' throughout rather than the more technical 'सत्र', matching dloStartOver.
  dloNewWork: '+ नवीन काम सुरू करा',
  // UNUSED, like dloIntro above — the notes card no longer titles itself.
  dloNewWorkTitle: 'नवीन काम',
  dloResumeTitle: 'सुरू असलेले काम',
  dloResumeAction: 'पुढे चला →',
  dloRecent: 'मागील कामे',
  // The list is folded shut by default, so the row has to state the answer it is hiding —
  // how many pieces of work there are. Folding may hide the CONTROL, never the ANSWER
  // (components/Disclosure).
  dloWorkCountSuffix: 'कामे',
  dloWorkCountNone: 'एकही नाही',
  dloMyWork: 'तुमचे काम',
  dloOtherWork: 'इतर कामे',
  dloListEmpty: 'अद्याप कोणतेही काम नाही. वरील फॉर्ममधून सुरुवात करा.',
  dloListLoading: 'यादी लोड होत आहे…',
  dloListLoadError: 'मागील कामांची यादी मिळाली नाही.',
  dloSourceCountSuffix: 'स्रोत',
  dloArticleReady: 'बातमी तयार',
  dloArticleCount: 'बातमी',
  dloOpenWork: 'उघडा',
  dloLoadingWork: 'काम उघडत आहे…',
  dloNotFound: 'हे काम सापडले नाही. ते हटवले गेले असावे.',

  // The review autosave. Saving is silent when it works; only trouble is announced.
  dloReviewSaving: 'बदल जतन होत आहेत…',
  dloReviewSaved: 'बदल जतन झाले',
  dloReviewSaveFailed: 'बदल जतन झाले नाहीत. पुन्हा प्रयत्न करा.',
  dloReviewTooLargeToSave:
    'तपासणीतील बदल जतन करण्यासाठी खूप मोठे आहेत. काही पृष्ठे वगळा.',
  // Two officers can open the same intake — the list is shared and there is no login. We
  // warn and offer the server's copy; we never overwrite what is on screen.
  dloReviewConflict:
    'हे काम दुसऱ्या कोणीतरी उघडले आहे. दोघांचे बदल एकमेकांवर लिहिले जाऊ शकतात.',
  dloReviewConflictReload: 'सर्व्हरवरील आवृत्ती लोड करा',

  // A picked recording is a live browser handle and cannot survive a page reload, unlike the
  // typed text beside it. Name the files rather than pretending nothing was lost.
  dloDraftAudioLost: 'ही ध्वनिमुद्रणे पुन्हा जोडा —',
  dloDraftImagesLost: 'या प्रतिमा पुन्हा जोडा —',

  // Standalone translation (mr→en, mr→hi, en→mr, hi→mr)
  translatePageTitle: 'भाषांतर (Translation)',
  translatePageIntro:
    'मराठी मजकुराचे इंग्रजी किंवा हिंदी भाषांतर, आणि इंग्रजी किंवा हिंदी मजकुराचे मराठी भाषांतर. नावे व पदनाम शब्दकोशाप्रमाणे जशीच्या तशी राहतात.',
  translateInputLabel: 'मजकूर येथे लिहा किंवा चिकटवा',
  // The label above adapts to the direction; these three name the source language in it.
  translateInputLabelMarathi: 'मराठी मजकूर येथे लिहा किंवा चिकटवा',
  translateInputLabelEnglish: 'इंग्रजी मजकूर येथे लिहा किंवा चिकटवा',
  translateInputLabelHindi: 'हिंदी मजकूर येथे लिहा किंवा चिकटवा',
  translateInputHint:
    'या मजकुराचे थेट भाषांतर केले जाईल. हा मजकूर जतन केला जाणार नाही.',
  translateInputPlaceholder: 'भाषांतरासाठी मजकूर येथे लिहा…',
  translateAction: 'भाषांतर करा',
  translateMayTakeTime: 'मोठ्या मजकुराला एक-दोन मिनिटे लागू शकतात.',
  translateOverLimit: 'मजकूर १०,००० अक्षरांपेक्षा जास्त आहे.',
  translateOutputTitle: 'इंग्रजी भाषांतर',
  translateOutputTitleHindi: 'हिंदी भाषांतर',
  translateOutputTitleMarathi: 'मराठी भाषांतर',
  translateLockedTerms: 'शब्दकोश संज्ञा वापरल्या',

  // Direction choice (standalone /translate page). A DIRECTION rather than a target on its
  // own: only four pairs are supported, and a source + target picker would offer मराठी →
  // मराठी and इंग्रजी → हिंदी, neither of which exists.
  translateDirectionLabel: 'कोणते भाषांतर हवे?',
  translateDirectionMrEn: 'मराठी → इंग्रजी',
  translateDirectionMrHi: 'मराठी → हिंदी',
  translateDirectionEnMr: 'इंग्रजी → मराठी',
  translateDirectionHiMr: 'हिंदी → मराठी',
  // Shown in place of the name-review step on an X→मराठी run: there is nothing to confirm,
  // because the dictionary's Marathi column IS the spelling the output is held to.
  translateIntoMarathiNames:
    'नावे शब्दकोशातील मराठी स्पेलिंगप्रमाणे ठेवली जातील — त्यासाठी वेगळी तपासणी लागत नाही. एखादे नाव चुकीचे वाटल्यास नाव-शब्दकोशात दुरुस्त करा.',


  // Pre-translation name check (shown before every translation; the confirmed
  // spellings are locked into the English output and saved to the नाव-शब्दकोश.
  // For Hindi the same list freezes the नावे as-is — see namesHindiHint)
  namesChecking: 'मजकुरातील नावे शोधत आहोत…',
  namesReviewTitle: 'नावांची इंग्रजी स्पेलिंग तपासा',
  // Hindi run: the editable column is the Hindi spelling, not English.
  namesReviewTitleHindi: 'नावांचे हिंदी स्पेलिंग तपासा',
  namesReviewHint:
    'खालील नावे इंग्रजी भाषांतरात अगदी अशीच वापरली जातील. चुकीची स्पेलिंग दुरुस्त करा; एखादे नाव राहिले असेल तर ते खाली जोडा.',
  namesReviewHintHindi:
    'खालील नावे हिंदी भाषांतरात अगदी अशीच वापरली जातील. गरज असल्यास हिंदी स्पेलिंग दुरुस्त करा (उदा. कोल्हापूर → कोल्हापुर); एखादे नाव राहिले असेल तर ते खाली जोडा.',
  namesHindiHint:
    'हिंदीत स्पेलिंग वेगळे हवे असल्यास (उदा. कोल्हापूर → कोल्हापुर) खालील हिंदी रकान्यात दुरुस्त करा; अन्यथा मराठीप्रमाणेच जशीच्या तशी राहील. स्पेलिंग बदलले तरी नावाचा अर्थ बदलणार नाही.',
  // The per-row "keep this name verbatim in Hindi" toggle. On for real proper nouns; the
  // officer unticks a common noun (विधानसभा, सहकारी संस्था) so it is translated normally
  // instead of frozen, which is what unblocks a document the extractor over-locked.
  namesLockHindi: 'हिंदीत जसेच्या तसे ठेवा',
  namesLockHindiHint:
    'व्यक्ती/ठिकाण/संस्था/योजनेची नावे हिंदीत जशीच्या तशी ठेवा. विधानसभा, सहकारी संस्था यांसारखे सर्वसामान्य शब्द असतील तर खूण काढा — ते हिंदीत भाषांतरित होतील.',
  // Warning shown above a translation whose output could not carry some locked names — the
  // translation is delivered, but these need a human's eye. Deliberately does NOT name the
  // language: the same line is shown for a Hindi translation, a Marathi one, and a
  // generation's warnings on ArticleView.
  translateUnpreservedTitle: 'ही नावे तपासा',
  translateUnpreservedHint:
    'खालील नावे भाषांतरात जशीच्या तशी दिसत नाहीत — ती बदललेली असू शकतात. कृपया भाषांतरात तपासा:',
  namesReviewEmpty:
    'या मजकुरात एकही नाव सापडले नाही. आवश्यक असल्यास खाली नाव जोडा.',
  namesAddName: '+ आणखी नाव जोडा',
  namesAddMarathiPlaceholder: 'उदा. संवाद वारी',
  namesAddEnglishPlaceholder: 'उदा. Samvad Wari',
  namesAddHindiPlaceholder: 'उदा. संवाद वारी',
  namesConfirmTranslate: 'भाषांतर सुरू करा',
  namesCancel: 'रद्द करा',
  namesPrepareError: 'नावे शोधता आली नाहीत. कृपया पुन्हा प्रयत्न करा.',
  namesStartCheck: 'नावे तपासा',
  namesShowVerified: 'आधीच तपासलेली नावे दाखवा',
  namesHideVerified: 'तपासलेली नावे लपवा',
  retranslateFold: 'नावे सुधारून पुन्हा इंग्रजी भाषांतर करा',
  retranslateFoldHindi: 'नावे सुधारून पुन्हा हिंदी भाषांतर करा',

  // ---------- shared document upload (<DocumentIntake> / <DocumentPages>) ----------
  //
  // Used by every surface that takes a PDF/DOCX/TXT. Wording is deliberately
  // format-neutral ("फाईल", not "PDF"): the same card serves a scanned booklet and a
  // one-line .txt, and the steps it shows follow the file rather than the page it is on.
  // The card sits inline on every surface — it used to hide behind a "show upload" fold,
  // which made the same capability look different on each page.
  docUploadTitle: 'फाईलमधून मजकूर घ्या',
  docUploadHint:
    'PDF, DOCX किंवा TXT फाईल निवडा (कमाल ५० MB). स्कॅन केलेली PDF देखील चालते. फाईल जतन केली जाणार नाही.',
  docUpload: 'फाईल निवडा',
  docUploadOther: 'दुसरी फाईल निवडा',
  // Only on a surface that shows several upload cards at once (/dlo), where one document
  // has to be droppable without touching the rest. Carried by a bin icon as its title +
  // aria-label, not printed — see the button in DocumentIntake.
  docRemove: 'हे कागदपत्र काढा',
  docUnsupported: 'फक्त PDF, DOCX आणि TXT फाईल्स चालतात.',
  docGone: 'ही फाईल आता उपलब्ध नाही. कृपया पुन्हा अपलोड करा.',
  // The pre-OCR selection step. EVERY PDF reaches it now (PDF_EXTRACTION_MODE=ocr): PDFs are
  // read by OCR whether or not they are scanned, because that is the only backend that keeps
  // a table's columns. So the hint no longer claims the file is scanned — that was true when
  // only scans came here and is now wrong on most uploads. The text does not exist yet —
  // showing it would mean running the very OCR being approved — so the choice is by page
  // number alone.
  docSelectTitle: 'कोणती पृष्ठे वाचायची?',
  docSelectHint:
    'PDF मधील प्रत्येक पृष्ठ OCR ने वाचले जाते — त्यामुळे तक्ते जसेच्या तसे राहतात. फक्त निवडलेलीच पृष्ठे वाचली जातील, म्हणून नको असलेली पृष्ठे आताच वगळा.',
  docSelectTotal: 'एकूण पृष्ठे',
  docSelectCount: 'पृष्ठे निवडली',
  docReadSelected: 'निवडलेली पृष्ठे वाचा',
  // /dlo only: its intake job reads the current selection later by default. Every other
  // surface needs the text in the browser now and never shows this.
  docPagesReadLaterHint:
    'ही पृष्ठे प्रक्रियेच्या टप्प्यात OCR ने वाचली जातील — थेट “पुढे जा” दाबा. आताच मजकूर पाहायचा असेल तर “निवडलेली पृष्ठे वाचा” दाबा. तपासणीच्या टप्प्यावर मजकूर दुरुस्त करता येईल.',
  docChangeSelection: 'पृष्ठ निवड बदला',
  docChangeSelectionHint:
    'वेगळी पृष्ठे निवडल्यास ती पुन्हा वाचावी लागतील आणि सध्याचा मजकूर पुन्हा तयार होईल.',
  docExtracting: 'फाईलमधील मजकूर वाचत आहोत…',
  docExtractingHint:
    'फाईलमध्येच मजकूर असेल तर हे काही सेकंदांत होते; स्कॅन केलेली PDF OCR ने वाचावी लागते आणि त्यास काही मिनिटे लागतात. हे पान उघडे ठेवा.',
  docExtractProgress: 'OCR: पृष्ठ',
  docReviewTitle: 'वाचलेला मजकूर तपासा',
  docReviewHint:
    'नको असलेली पृष्ठे वगळा आणि चूक असल्यास पृष्ठ उघडून दुरुस्त करा. निवडलेल्या पृष्ठांचा मजकूरच पुढे वापरला जाईल.',
  docUseText: 'हा मजकूर वापरा',
  docUsed: 'मजकूर घेतला',
  // Live mode (the media room): the file's text is already counted alongside the box above,
  // so there is no button to press and the card says as much.
  docAutoUsed:
    'निवडलेल्या पृष्ठांचा हा मजकूर वरील मजकुरासोबत आपोआप वापरला जाईल — वेगळे बटण दाबण्याची गरज नाही.',
  docEmptySelection: 'निवडलेल्या पृष्ठांमध्ये मजकूर नाही.',
  docNoPagesSelected: 'या फाईलमधून एकही पृष्ठ निवडलेले नाही.',
  // Which backend read the file. The text layer is exact; OCR guesses from pixels and can
  // misread names and आकडे, so the review matters more there.
  docSourceTextLayer: 'मजकूर थेट फाईलमधून घेतला',
  docSourceOcr: 'मजकूर OCR ने वाचला',
  docSourceTextLayerHint:
    'नावे आणि आकडे जसेच्या तसे आले आहेत. तरीही एकदा नजर टाका.',
  docSourceOcrHint:
    'OCR मध्ये नावे आणि आकडे चुकू शकतात — पुढे जाण्यापूर्वी तपासा.',
  docReextract: 'मजकूर चुकीचा दिसतोय? OCR ने पुन्हा वाचा',
  docReextractHint:
    'काही PDF मध्ये अक्षरे चुकीच्या क्रमाने साठवलेली असतात. OCR पानाचे चित्र वाचते, त्यामुळे असा मजकूर बरोबर येतो. यास काही मिनिटे लागतील आणि सध्याचा मजकूर पुन्हा तयार होईल.',
  docReextractYes: 'होय, OCR ने वाचा',
  docReextractCancel: 'रद्द करा',
  docPage: 'पृष्ठ',
  docChars: 'अक्षरे',
  docSelectAll: 'सर्व निवडा',
  docClearAll: 'निवड काढा',
  docEdit: 'मजकूर पाहा / दुरुस्त करा',
  docEditClose: 'बंद करा',
  // A page holding a table opens as a rendered table, not as raw Markdown pipes: that is
  // the only form in which an officer can check one figure against its heading. These two
  // switch between that view and the editor, which stays the only thing that changes text.
  docHasTable: 'तक्ता',
  docEditText: 'मजकूर दुरुस्त करा',
  docShowTable: 'तक्ता म्हणून पाहा',
  docEdited: 'दुरुस्त केले',
  docLangMr: 'मराठी',
  docLangEn: 'English',
  // The range-input page selector (PageRangeSelector), shared by every page picker. A
  // range field scales to a 50-page scan where a checkbox-per-row list does not; the grid
  // is there for the occasional page you would rather tap than type.
  docRangeLabel: 'पृष्ठे लिहा',
  docRangeHint: 'उदा. १-५, ८, १०-१२ — किंवा खाली पृष्ठे टॅप करा.',
  docRangePlaceholder: 'उदा. १-५, ८, १०-१२',
  docRangeApply: 'लागू करा',
  docRangeExpand: 'पृष्ठे निवडा',
  docRangeCollapse: 'पृष्ठे लपवा',
  docRangeSelected: 'निवडलेली पृष्ठे',

  // Proof read (ad-hoc grammar/name/style check of pasted text; nothing stored)
  proofreadPageTitle: 'मुद्रितशोधन (Proof Read)',
  proofreadPageIntro:
    'मजकुरातील व्याकरण, शुद्धलेखन, विरामचिन्हे, नावे आणि महासंवाद-शैली तपासा. फक्त खात्रीशीर चुका दाखवल्या जातात.',
  proofreadInputLabel: 'मराठी किंवा इंग्रजी मजकूर येथे चिकटवा',
  proofreadInputHint:
    'व्याकरण, शुद्धलेखन, विरामचिन्हे, नावांची पडताळणी आणि महासंवाद-शैली तपासली जाईल. फक्त खात्रीशीर चुका दाखवल्या जातात. हा मजकूर जतन केला जाणार नाही.',
  proofreadInputPlaceholder: 'तपासणीसाठी मजकूर येथे चिकटवा…',
  proofreadAction: 'तपासणी करा',
  proofreadChecking: 'तपासणी सुरू आहे… यास एक-दोन मिनिटे लागू शकतात.',
  proofreadOverLimit: 'मजकूर १०,००० अक्षरांपेक्षा जास्त आहे.',
  proofreadError: 'तपासणी अयशस्वी झाली. कृपया पुन्हा प्रयत्न करा.',
  proofreadIssuesTitle: 'आढळलेल्या चुका',
  proofreadNoIssues: 'कोणतीही चूक आढळली नाही — मजकूर स्वच्छ आहे ✓',
  proofreadSuggestionArrow: 'सुचवलेली दुरुस्ती:',
  proofreadStyleAdvisoryTitle: 'शैली-सूचना (ऐच्छिक)',
  proofreadStyleAdvisoryHint:
    'या फक्त सूचना आहेत; दुरुस्त मजकुरात त्या लागू केलेल्या नाहीत.',
  proofreadUnverifiedTitle: 'अपडताळलेली नावे',
  proofreadUnverifiedHint:
    'ही नावे नाव-शब्दकोशात नाहीत, म्हणून ती बदललेली नाहीत — कृपया स्वतः खात्री करा. शब्दकोश पानावर नाव जोडल्यास पुढील तपासणीत ते आपोआप पडताळले जाईल.',
  proofreadCorrectedTitle: 'दुरुस्त मजकूर',
  proofreadCorrectedUnchanged:
    'कोणतीही दुरुस्ती आवश्यक नव्हती — मूळ मजकूर जसाच्या तसा आहे.',
  proofreadCorrectedUnavailable:
    'सुरक्षा-तपासणीमुळे दुरुस्त मजकूर देता आला नाही; वरील चुका पाहून स्वतः दुरुस्ती करा.',
  proofreadEnglishStyleNote:
    'महासंवाद-शैली तपासणी फक्त मराठी मजकुरासाठी उपलब्ध आहे; या इंग्रजी मजकुराची व्याकरण व नाव-पडताळणी केली आहे.',
  proofreadStyleRefNote: 'शैली-संदर्भ:',

  // Highlighting the changed spans inside the corrected text
  proofreadHighlightShow: 'दुरुस्त्या हायलाइट करा',
  proofreadHighlightHide: 'हायलाइट बंद करा',
  proofreadHighlightHint:
    'हायलाइट केलेल्या मजकुरावर बोट ठेवा किंवा क्लिक करा — मूळ शब्द दिसेल.',
  proofreadHighlightLegendFix: 'दुरुस्त केलेला मजकूर',
  proofreadHighlightLegendStyle: 'शैली सूचना — मजकूर बदललेला नाही',
  proofreadHighlightOriginal: 'मूळ:',
  proofreadHighlightClose: 'बंद करा',

  // The draft arriving live (useArticleStream). Deliberately phrased as still in progress —
  // it is not the finished बातमी until the run completes, and the officer must not copy
  // from it. Compare articleTitle below, which names the finished thing.
  articleStreamingTitle: 'बातमी लिहिली जात आहे',
  articleStreamingBadge: 'लिहीत आहे…',

  // Progress
  progressTitle: 'तयार होत आहे…',
  progressHint:
    'यास काही मिनिटे लागू शकतात. हे पान उघडे ठेवा किंवा नंतर परत या.',
  stepDone: 'पूर्ण',
  failedTitle: 'काम अपूर्ण राहिले',
  failedHint: 'क्षमस्व, काहीतरी चुकले. पुन्हा प्रयत्न करून पहा.',
  retry: 'पुन्हा प्रयत्न करा',
  // Shown when an EDIT failed but everything produced earlier is still here — a different
  // situation from a run that produced nothing, and it must not read like one.
  editFailedTitle: 'शेवटची सुधारणा अयशस्वी झाली',
  editFailedHint:
    'आधीचे पोस्टर आणि त्याच्या सर्व आवृत्त्या जशाच्या तशा आहेत — फक्त ही एक सुधारणा लागू झाली नाही.',
  editRetry: 'तीच सुधारणा पुन्हा करा',
  editRecover: 'काम पुन्हा वापरात आणा',
  dismiss: 'बंद करा',
  // On a run that produced nothing there is nothing to recover, so the way forward is a
  // fresh run — which is the पुढील पाऊल fold right below this card.
  editFailedNewRunHint:
    'या कामातून काहीच तयार झाले नाही. खाली “पुढील पाऊल” मध्ये याच टिपणीवरून नवीन काम सुरू करा.',

  // Results
  articleTitle: 'तयार झालेली बातमी',
  givenArticle: 'दिलेली बातमी',
  factCheckTitle: 'तथ्य-तपासणी (माहिती कुठून आली?)',
  noteTitle: 'मूळ टिपणी',

  // 5W1H at-a-glance card (कोण/काय/केव्हा/कुठे/का/कसे — extracted from the note)
  fiveWOneHTitle: 'थोडक्यात — कोण, काय, केव्हा, कुठे, का, कसे',
  fiveWWho: 'कोण',
  fiveWWhat: 'काय',
  fiveWWhen: 'केव्हा',
  fiveWWhere: 'कुठे',
  fiveWWhy: 'का',
  fiveWHow: 'कसे',
  fiveWEmpty: 'या टिपणीत नमूद नाही',
  copyText: 'मजकूर कॉपी करा',
  copied: 'कॉपी झाले ✓',
  downloadTxt: '.txt डाउनलोड',
  downloadMd: '.md डाउनलोड',
  downloadPdf: 'PDF डाउनलोड',
  translateToEnglish: 'इंग्रजीत भाषांतर करा',
  translateToHindi: 'हिंदीत भाषांतर करा',
  showMarathi: 'मराठी',
  showEnglish: 'English',
  showHindi: 'हिंदी',
  translating: 'भाषांतर सुरू आहे…',
  translatingEnglish: 'इंग्रजी भाषांतर सुरू आहे…',
  translatingHindi: 'हिंदी भाषांतर सुरू आहे…',
  revisingArticle: 'बातमी सुधारली जात आहे…',
  posterTitle: 'तयार झालेले पोस्टर',
  // Same panel, यूट्यूब lane: calling a thumbnail a "पोस्टर" is simply wrong to the officer
  // who chose यूट्यूब थंबनेल on the form.
  thumbnailTitle: 'तयार झालेले थंबनेल',
  downloadThumbnail: 'थंबनेल डाउनलोड करा',
  // Poster-skeleton label while the article is shown but the poster still renders
  posterPreparing: 'पोस्टर तयार होत आहे…',
  downloadPoster: 'पोस्टर डाउनलोड करा',
  editCopy: 'पोस्टरवरील मजकूर बदला',
  closeEditCopy: 'बदल बंद करा',
  rerender: 'पोस्टर पुन्हा तयार करा',
  rerendering: 'पोस्टर तयार होत आहे…',
  rerenderDone: 'पोस्टर तयार झाले ✓',

  // Feedback
  articleFeedbackTitle: 'बातमीत बदल हवा आहे?',
  articleFeedbackHint:
    'काय बदलायचे ते आपल्या शब्दांत लिहा — उदा. "सुरुवात आणखी आकर्षक करा", "मुद्दे थोडक्यात मांडा".',
  posterFeedbackTitle: 'पोस्टरमध्ये बदल हवा आहे?',
  posterFeedbackTargetCopy: 'मजकूर सुधारा',
  posterFeedbackTargetCopyDesc: 'पोस्टरवरील शब्द / वाक्ये बदलतील (जलद)',
  posterFeedbackTargetScene: 'चित्र बदला',
  posterFeedbackTargetSceneDesc: 'मागील चित्र नव्याने तयार होईल (काही मिनिटे)',
  posterImageFeedbackTitle: 'चित्रात बदल हवा आहे?',
  posterImageFeedbackHint:
    'हवा असलेला दृश्यात्मक बदल स्पष्ट लिहा. प्रत्येक नवीन सूचना सध्याच्या पोस्टरवर लागू होईल; बाकीचे चित्र, मजकूर आणि मांडणी जशीच्या तशी ठेवायची असल्यास तसे नमूद करा.',
  // Click-to-point marker feedback (PosterAnnotator + PosterImageFeedbackBox)
  posterAnnotateHint:
    'पोस्टरवर जिथे बदल हवा तिथे क्लिक करा किंवा ओढून चौकट काढा — प्रत्येक खुणेसाठी वेगळी सूचना लिहा (जास्तीत जास्त ३ खुणा). खूण न करता फक्त लिहूनही चालेल.',
  markerLabel: 'खूण',
  markerNotePlaceholder: 'या जागी काय बदलायचे ते लिहा…',
  markerRemove: 'खूण काढा',
  markerNoteTooShort: 'प्रत्येक खुणेसाठी थोडक्यात सूचना लिहा.',
  posterOverallNotePlaceholder: 'संपूर्ण पोस्टरसाठी अतिरिक्त सूचना (ऐच्छिक)…',
  markerReservedZoneWarning:
    'टीप: वरचा लोगो आणि खालची पट्टी नंतर सॉफ्टवेअरने छापली जाते — त्या भागात केलेले बदल दिसणार नाहीत.',
  markersSubmittedHint:
    'पाठवलेल्या खुणा पोस्टरवर दाखवल्या आहेत — नवीन खूण केल्यास त्या हटतील.',
  markersDismiss: 'खुणा लपवा',

  // "Free this space" — the BLUE box gesture (PosterAnnotator mode 'clear').
  // The point of it: the officer wants to place their OWN logo or photograph at
  // that spot by hand afterwards, so the design there is moved elsewhere and the
  // rectangle is left as plain background.
  clearRegionHint:
    'पोस्टरवर जी जागा मोकळी हवी आहे तिथे ओढून निळी चौकट काढा (जास्तीत जास्त २). प्रत्येक चौकटीसाठी काय करायचे ते निवडा — “दुसरीकडे हलवा” म्हणजे त्या भागातील मजकूर व चित्रे पोस्टरवरच दुसरीकडे नेली जातील (त्यासाठी पोस्टरची संपूर्ण रचना बदलू शकते), तर “काढून टाका” म्हणजे तो मजकूर पूर्णपणे काढून टाकला जाईल आणि बाकी काहीही हलणार नाही. दोन्हींत ती जागा पार्श्वभूमीसारखीच मोकळी राहील — तिथे तुम्ही स्वतःचा लोगो किंवा फोटो नंतर लावू शकता.',
  clearRegionLabel: 'मोकळी जागा',
  clearRegionNotePlaceholder: 'तो भाग कुठे हलवायचा? (ऐच्छिक)…',
  clearRegionRemove: 'मोकळी जागा काढा',
  // Per-box action toggle. 'displace' is the default; 'remove' deletes, so it is
  // never the pre-selected option.
  clearActionDisplace: 'दुसरीकडे हलवा',
  clearActionRemove: 'काढून टाका',
  clearActionLabel: 'या जागेतील मजकुराचे काय करायचे?',
  clearRegionSubmittedHint:
    'पाठवलेल्या मोकळ्या जागा पोस्टरवर दाखवल्या आहेत — नवीन चौकट काढल्यास त्या हटतील.',
  clearRegionReservedZoneWarning:
    'टीप: वरचा लोगो आणि खालची पट्टी नंतर सॉफ्टवेअरने छापली जाते — तिथली जागा मोकळी करता येत नाही.',
  iconClearSpace: 'जागा मोकळी करा (स्वतःच्या लोगोसाठी)',
  iconClearSpaceOn: 'जागा मोकळी करणे बंद करा',
  feedbackPlaceholder: 'येथे आपला अभिप्राय लिहा…',
  sendFeedback: 'बदल करा',
  sendingFeedback: 'पाठवत आहोत…',
  feedbackTooShort: 'कृपया थोडक्यात अभिप्राय लिहा.',
  // One-tap suggestions that prefill the feedback box (still editable before sending).
  feedbackSuggestionsLabel: 'झटपट सूचना:',
  chipsArticle: [
    'आणखी थोडक्यात लिहा',
    'आणखी सविस्तर लिहा',
    'भाषा आणखी सोपी करा',
    'सुरुवात आणखी आकर्षक करा',
  ],
  chipsPosterImage: [
    'रंग अधिक उठावदार करा',
    'मजकूर आणखी मोठा व वाचनीय करा',
    'मांडणी अधिक नीटनेटकी करा',
  ],

  // Caption toggle on the create form — a social post is poster-only unless asked
  // otherwise, so this is an opt-in shown once ट्विटर/फेसबुक is selected.
  captionToggleLabel: 'कॅप्शनही तयार करा',
  captionToggleHint:
    'पोस्टरसोबत मराठी कॅप्शनही लिहिली जाईल. निवडले नाही तर फक्त पोस्टर तयार होईल — कॅप्शन नंतरही जोडता येते.',

  // Shown on a finished social post that was created poster-only
  captionNoneTitle: 'या पोस्टसाठी कॅप्शन तयार केलेली नाही',
  captionNoneHint:
    'आता कॅप्शन तयार करून घ्या, किंवा स्वतः लिहा. टिपणीत नसलेली माहिती जोडली जाणार नाही.',
  captionGenerate: 'कॅप्शन तयार करा',
  captionGenerating: 'कॅप्शन तयार होत आहे…',
  captionWriteOwn: 'स्वतः कॅप्शन लिहा',

  // Caption of a social post (twitter/facebook): hand edit + AI feedback loop
  captionLabel: 'कॅप्शन',
  captionEdit: 'कॅप्शन बदला',
  captionEditHint:
    'कॅप्शन इथेच बदलता येते — बदल केल्यावर "कॅप्शन जतन करा" वर क्लिक करा.',
  captionSave: 'कॅप्शन जतन करा',
  captionSaving: 'जतन करत आहोत…',
  captionSaved: 'कॅप्शन जतन झाली ✓',
  captionRevert: 'बदल रद्द करा',
  captionDirtyBlocksAi:
    'कॅप्शन बदलणे सुरू आहे — आधी ते जतन करा किंवा रद्द करा.',
  captionCounterLabel: 'अक्षरे',
  // The caption box is always editable now, so the hand edit saves itself when focus
  // leaves the textarea — there is no "जतन करा" button to press.
  captionAutosaveHint: 'कॅप्शन इथेच बदलता येते — बदल आपोआप जतन होतील.',
  captionSavingShort: 'जतन करत आहोत…',
  captionFeedbackTitle: 'कॅप्शनमध्ये बदल हवा आहे?',
  captionFeedbackHint:
    'काय बदलायचे ते आपल्या शब्दांत लिहा. AI आपली विनंती समजून कॅप्शनमध्ये बदल करेल.',
  revisingCaption: 'कॅप्शन सुधारली जात आहे…',
  chipsCaption: [
    'कॅप्शन अधिक स्पष्ट आणि सोपे करा',
    'महत्त्वाच्या माहितीवर अधिक भर द्या',
    'भाषा आणखी सोपी करा',
    'शेवटी योग्य हॅशटॅग जोडा',
  ],

  // Icon-button row under a social poster + the icon pair inside the caption box.
  // Icon-only controls, so every one of these is its title/aria-label — never visible text.
  iconDownloadPoster: 'पोस्टर डाउनलोड करा',
  iconRedesignPoster: 'वेगळी रचना तयार करा',
  iconRecolourPoster: 'वेगळ्या रंगात तयार करा',
  iconEditPoster: 'चित्रात बदल करा (पोस्टरवर खूण करा)',
  iconEditPosterOn: 'खूण करणे बंद करा',
  iconPublishDisabled: 'सध्या X वर पोस्ट करता येणार नाही',
  iconCopyCaption: 'कॅप्शन कॉपी करा',
  iconGenerateCaption: 'कॅप्शन तयार करा',

  // One fold for both change requests, switched by the pills at its top. The two
  // drafts are kept apart, so switching a pill never discards what was typed.
  changeRequestTitle: 'AI ला सूचना द्या',
  changeTabCaption: 'कॅप्शन',
  changeTabPoster: 'पोस्टर',
  changeCaptionPlaceholder:
    'कॅप्शनमध्ये काय बदलायचे ते लिहा — उदा. "२८० अक्षरांपेक्षा लहान करा"…',
  changePosterPlaceholder:
    'पोस्टरमध्ये काय बदलायचे ते लिहा — उदा. "मजकूर आणखी मोठा करा"…',

  // Poster version history (every render is kept; the strip lets users compare/download)
  posterVersionsTitle: 'आधीच्या आवृत्त्या',
  posterVersionLabel: 'आवृत्ती',
  posterVersionOriginal: 'मूळ',
  posterVersionCurrent: 'सद्य',
  // Says what pressing a thumbnail does, because the strip used to only open the PNG.
  posterVersionsHint:
    'जुनी आवृत्ती निवडा — तीच सद्य पोस्टर होईल आणि पुढील बदल तिच्यावर होतील. कोणतीही आवृत्ती हरवत नाही.',

  // Generation thread: all runs spawned from the same note lineage, shown as a
  // horizontal rail on the detail page (hidden when the run has no follow-ups)
  threadTitle: 'याच टिपणीवरून तयार झालेली कामे',
  threadHint:
    'या टिपणीवरून आतापर्यंत तयार झालेली सर्व कामे. दुसरे काम उघडण्यासाठी त्यावर क्लिक करा.',
  threadRootBadge: 'मूळ',
  threadCurrentBadge: 'हे पान',
  threadNoteEdited: 'बदललेली टिपणी',

  // Cross-format links in a finished run's action row: open Creative and Social with
  // this run's note prefilled and the other platform preselected. The short name sits
  // on the button between the platform mark and the arrow; the sentence is its title +
  // aria-label, so a screen reader hears what the button actually does.
  crossFormatTwitterShort: 'ट्विटर',
  crossFormatFacebookShort: 'फेसबुक',
  crossFormatToTwitter: 'याच मजकुरावरून ट्विटर पोस्ट तयार करा',
  crossFormatToFacebook: 'याच मजकुरावरून फेसबुक पोस्ट तयार करा',
  // Shown on Creative and Social while the run named by ?from= is being fetched.
  prefillLoading: 'आधीच्या कामातील टिपणी आणली जात आहे…',
  prefillFailed:
    'आधीच्या कामातील टिपणी आणता आली नाही — खाली टिपणी लिहा किंवा फाईल जोडा.',
  prefillApplied: 'आधीच्या कामातील टिपणी भरली आहे. हवे ते बदल करून तयार करा.',

  // "Next step" panel on a finished generation (edit the note and re-run; the
  // cross-format folds moved to the poster links above)
  nextActionsTitle: 'पुढील पाऊल',
  nextActionsHint: 'हीच टिपणी वापरून पुन्हा काम सुरू करायचे आहे?',
  nextTwitterStarted:
    'ट्विटर पोस्ट तयार होत आहे — प्रगती वरील "सुरू असलेली कामे" मध्ये पाहा.',
  nextFacebookStarted:
    'फेसबुक पोस्ट तयार होत आहे — प्रगती वरील "सुरू असलेली कामे" मध्ये पाहा.',
  // Still read by SOCIAL_SOURCE_OPTIONS in lib/generationOptions.ts, which is kept
  // alongside the other unused option tables there.
  sourceArticle: 'तयार झालेला लेख',
  sourceArticleDesc:
    'या कामात तयार झालेला लेख पोस्टसाठी आधार म्हणून वापरला जाईल.',
  sourceNote: 'मूळ टिपणी',
  sourceNoteDesc: 'तुम्ही दिलेली मूळ टिपणी वापरली जाईल.',
  nextArticleTitle: 'याच टिपणीवरून लेख तयार करा',
  nextArticleHint:
    'हीच टिपणी वापरून महासंवाद शैलीतील बातमी (हवे असल्यास पोस्टरसह) तयार होईल.',
  nextArticleCta: 'बातमी तयार करा',
  nextPosterTitle: 'या बातमीसाठी पोस्टर तयार करा',
  nextPosterHint:
    'तयार झालेल्या बातमीवरून महासंवाद शैलीतील पोस्टर याच कामात तयार होईल — नवीन काम सुरू होणार नाही.',
  nextPosterRetryHint:
    'मागील वेळी पोस्टर तयार होऊ शकले नाही. खालील बटणावर क्लिक करून पुन्हा प्रयत्न करा.',
  nextPosterCta: 'पोस्टर तयार करा',
  editNoteTitle: 'टिपणी बदलून पुन्हा तयार करा',
  editNoteHint:
    'टिपणीत हवे ते बदल करा — त्याच सेटिंग्जसह नवीन काम सुरू होईल; हे काम जसेच्या तसे राहील.',
  editNoteCta: 'नव्याने तयार करा',

  // Background tasks panel (every generation started this session, tracked in the navbar)
  tasksButton: 'सुरू असलेली कामे',
  tasksTitle: 'सुरू असलेली कामे',
  tasksEmpty: 'सध्या कोणतेही काम सुरू नाही.',
  taskCopyCaption: 'कॅप्शन कॉपी करा',
  taskDownloadPoster: 'पोस्टर डाउनलोड करा',
  taskRegenerate: 'पुन्हा तयार करा',
  taskViewFull: 'पूर्ण पाहा',

  // In-place poster redesign (social runs): re-render THIS post's poster in a completely
  // new AI-designed look on the same run — the escape hatch when the Devanagari came out
  // wrong, or you just want a different design.
  posterRedesign: 'वेगळी रचना तयार करा',
  posterRedesignHint:
    'हेच पोस्टर AI कडून पूर्णपणे वेगळ्या रचनेत पुन्हा तयार करा (मजकूर चुकीचा आल्यास किंवा वेगळा लूक हवा असल्यास).',
  // Same re-render, but the current colour family is barred — for when the design is fine and
  // only the colours are wrong. Honest about being a fresh render, not a recolour: the poster
  // copy is rewritten too, so the new version will not be the old one repainted.
  posterRecolour: 'वेगळ्या रंगात तयार करा',
  posterStyleLabelPrefix: 'रंगसंगती व रचना:',

  // The hand-typed article-poster heading. On the create form it is optional and pre-empts the
  // automatic choice; on the detail page it is how a wrong heading is corrected, since the
  // officer only sees the text once the poster exists. Both say the same thing: leave it blank
  // and the system decides.
  posterHeadingLabel: 'पोस्टरवरील मजकूर (ऐच्छिक)',
  posterHeadingPlaceholder: 'उदा. भारत टॅक्सी',
  posterHeadingHint:
    'पोस्टरवर नेमका हाच मजकूर छापला जाईल. रिकामे ठेवल्यास टिपणीतील योजना / पुरस्कार / उपक्रमाचे नाव आपोआप शोधून वापरले जाईल.',
  // The create form's own wording. The shared hint above is written for the detail page,
  // where the poster already exists and this is how a wrong line is corrected; here the box
  // at the top of the page is ALSO called "पोस्टरवरील मजकूर", so this one's job is to say
  // which of the two decides — otherwise the officer sees two fields making one promise.
  posterHeadingCreateHint:
    'बॅनरवर वरील मजकुरातील मुख्य नाव आपोआप शोधून छापले जाते. ते नाव स्वतः ठरवायचे असल्यास येथे लिहा — मग नेमका हाच मजकूर बॅनरवर येईल.',
  posterHeadingTooLong: 'पोस्टरवरील मजकूर १२० अक्षरांपेक्षा कमी ठेवा.',
  // Detail page: the edit fold under the poster.
  posterHeadingEdit: 'पोस्टरवरील मजकूर बदला',
  posterHeadingApply: 'हा मजकूर वापरून पुन्हा तयार करा',
  posterHeadingClear: 'आपोआप ठरवू द्या',
  posterHeadingCurrentPrefix: 'सध्याचा मजकूर:',
  posterHeadingAuto: 'आपोआप ठरवला जात आहे',
  posterHeadingCancel: 'रद्द करा',

  // Direct publish to the official social accounts (detail page, social runs)
  publishToX: 'X वर पोस्ट करा',
  publishToFacebook: 'फेसबुकवर पोस्ट करा',
  publishAgain: 'पुन्हा पोस्ट करा',
  publishConfirmHint:
    'ही पोस्ट अधिकृत खात्यावर लगेच प्रकाशित होईल आणि ती इथून मागे घेता येणार नाही. पुढे जायचे?',
  publishConfirmYes: 'होय, प्रकाशित करा',
  publishCancel: 'रद्द करा',
  publishing: 'पोस्ट होत आहे…',
  publishSuccess: 'पोस्ट प्रकाशित झाली!',
  publishedViewPost: 'प्रकाशित पोस्ट पाहा',

  // Glossary (नाव-शब्दकोश) admin/review page
  glossaryTitle: 'नाव-शब्दकोश (मराठी → इंग्रजी)',
  glossaryIntro:
    'भाषांतरात नावे, पदनाम, ठिकाणे व योजना बरोबर यावीत यासाठीचा शब्दकोश. फक्त “तपासलेली” नोंद भाषांतरात जशीच्या तशी वापरली जाते. प्रत्येक भाषांतरातून नवीन नावे आपोआप येथे येतात — ती तपासा किंवा दुरुस्त करा.',
  glossaryAddTitle: 'नवीन नाव जोडा',
  glossaryAddToggle: '+ नवीन नाव जोडा',
  glossaryMarathi: 'मराठी',
  glossaryEnglish: 'इंग्रजी',
  glossaryHindi: 'हिंदी',
  glossaryType: 'प्रकार',
  glossaryNotes: 'टीप',
  glossaryAdd: 'जोडा',
  glossaryAdding: 'जोडत आहोत…',
  glossarySave: 'जतन करा',
  glossarySaving: 'जतन करत आहोत…',
  glossarySaved: 'जतन झाले ✓',
  glossaryEdit: 'बदला',
  glossaryCancel: 'रद्द करा',
  glossaryDelete: 'काढा',
  glossaryDeleteConfirm: 'हे नाव कायमचे काढायचे?',
  glossaryVerify: 'तपासले म्हणून खूण करा',
  glossaryUnverify: 'खूण काढा',
  glossaryVerified: 'तपासले',
  glossaryUnverified: 'तपासायचे आहे',
  glossarySearchPlaceholder: 'नाव शोधा…',
  glossaryFilterAllTypes: 'सर्व प्रकार',
  glossaryStatusAll: 'सर्व',
  glossaryStatusUnverified: 'तपासायची',
  glossaryStatusVerified: 'तपासलेली',
  glossaryEmpty: 'अजून एकही नाव नाही.',
  glossaryNoResults: 'शोधाशी जुळणारे नाव सापडले नाही.',
  glossaryLoading: 'नावे उघडत आहोत…',
  glossarySelectAllUnverified: 'सर्व तपासायची निवडा',
  glossaryBulkSelected: 'निवडलेली',
  glossaryBulkVerify: 'तपासले म्हणून खूण करा',
  glossaryBulkBusy: 'खूण करत आहोत…',
  glossaryBulkClear: 'निवड रद्द करा',
  glossaryBulkPartial:
    'काही नावांना खूण करता आली नाही. कृपया पुन्हा प्रयत्न करा.',
  glossaryShowing: 'दाखवत आहोत',
  glossaryMarathiPlaceholder: 'उदा. जिल्हाधिकारी',
  glossaryEnglishPlaceholder: 'उदा. District Collector',
  glossaryHindiPlaceholder: 'उदा. कोल्हापुर (ऐच्छिक)',
  glossaryCount: 'एकूण नावे',

  // History
  historyTitle: 'मागील काम',
  historyIntro:
    'या मंचावर तयार झालेले सर्व लेख, पोस्टर आणि सोशल पोस्ट येथे मिळतील.',
  historyEmpty: 'अजून काहीही तयार केलेले नाही.',
  historyNew: '+ नवीन तयार करा',
  historySearchPlaceholder: 'मागील काम शोधा…',
  historyNoResults: 'शोधाशी जुळणारे काही सापडले नाही.',
  historyCount: 'एकूण',
  paginationPrev: 'मागील',
  paginationNext: 'पुढील',
  open: 'उघडा',

  // Cost badge (estimated OpenAI spend for the run)
  costLabel: 'अंदाजे खर्च',

  // Poster master-template library (enabled-rotation semantics: many images per
  // type may be in use at once; one is picked at random per poster).
  refTitle: 'पोस्टर मास्टर टेम्पलेट',
  refIntro:
    'पोस्टरसाठी वापरली जाणारी मूळ (मास्टर) टेम्पलेट चित्रे येथे व्यवस्थापित करा. "वापरात" असलेल्या चित्रांतून प्रत्येक पोस्टरसाठी एक आपोआप निवडले जाते — ज्या टेम्पलेटमध्ये तुमचे सर्व मुद्दे मावतात ते.',
  refUpload: 'नवीन चित्र अपलोड करा',
  refUploading: 'अपलोड होत आहे…',
  refEnabled: 'वापरात',
  refEnable: 'वापरा',
  refDisable: 'थांबवा',
  refDelete: 'काढा',
  refDeleteConfirm: 'हे चित्र कायमचे काढायचे?',
  refEmpty: 'या प्रकारात अजून एकही चित्र नाही.',
  refNoneEnabled: 'या प्रकारातील एकही चित्र सध्या वापरात नाही.',
  refFileTypeError: 'कृपया PNG, JPEG किंवा WebP चित्र निवडा.',
  refUploadedOn: 'अपलोड',
  refCustomChip: 'नवीन प्रकार',
  // A type's rotation can hold dozens of masters, so its card opens on ONE row and
  // grows two rows at a time. The count tells the operator how much is still folded
  // away — without it, "आणखी दाखवा" gives no idea whether one image is hidden or forty.
  refShowMore: 'आणखी दाखवा',
  refShowLess: 'कमी दाखवा',
  refHiddenCount: (n: number) => `आणखी ${n} चित्रे`,

  // Shape bands — how the library is presented. These name what the picker actually
  // reasons over (how many points a master can hold), not what its placeholder art is
  // about, so an operator can answer "which one is this?" by looking at the picture.
  // See lib/referenceGroups.ts for why the old per-type sections were replaced.
  refBandUnanalyzed: 'अजून तपासलेली नाहीत',
  refBandUnanalyzedHint:
    'ही चित्रे तपासेपर्यंत पोस्टरसाठी निवडली जाणार नाहीत. प्रत्येकावर "पुन्हा तपासा" दाबा.',
  refBandSingle: 'एकच संदेश',
  refBandSingleHint: 'मुद्द्यांची यादी नाही — एक घोषणा, एक वाक्य किंवा अवतरण.',
  refBandFew: 'थोडे मुद्दे',
  refBandFewHint: '१ ते ३ मुद्दे मावतात.',
  refBandMedium: 'मध्यम यादी',
  refBandMediumHint: '४ ते ६ मुद्दे मावतात.',
  refBandMany: 'मोठी यादी',
  refBandManyHint: '७ किंवा अधिक मुद्दे मावतात.',
  refBandCount: (n: number) => `${n} टेम्पलेट`,
  refBandEmpty: 'या मापाचे एकही टेम्पलेट नाही.',

  // Which library. Three separate libraries serve three separate features, so this is a
  // real division — unlike the topic groups it replaces at the top of the page.
  refTabTwitter: 'ट्विटर / फेसबुक',
  refTabArticle: 'लेख पोस्टर',
  refTabYoutube: 'यूट्यूब थंबनेल',

  // Upload. One button for the whole page: the group is a field on the form rather than
  // a card you have to find first.
  refAddOpen: 'नवीन टेम्पलेट जोडा',
  refAddTitle: 'नवीन टेम्पलेट',
  refAddCancel: 'रद्द करा',
  // The upload form's ONE question, asked with the same four sections the page is
  // browsed by. It is a real answer, not a filing convenience: the chosen band becomes
  // the master's slot count, which is what decides whether a note with N points may use
  // it at all — hence "किती मुद्दे मावतात", never "कोणता विषय".
  refAddBandLabel: 'या टेम्पलेटमध्ये किती मुद्दे मावतात?',
  refAddBandHint:
    'चित्रातील मुद्द्यांच्या जागा मोजून गट निवडा. तुम्ही निवडलेला गटच कायम राहील — तपासणीनंतरही तो बदलणार नाही.',
  refAddPick: 'चित्र निवडा',
  refAddHint: 'PNG, JPEG किंवा WebP चित्र निवडल्यावर ते लगेच जोडले जाईल.',
  refGroupLine: 'गट',

  // Heading over the flat, relevance-ordered list a search produces. Bands are dropped
  // there on purpose: a search has its own order, and re-bucketing it would bury the
  // best hit under a size heading.
  refSearchResultsTitle: 'शोध निकाल',
  // Template brand family. A type tagged CMO renders the मंत्रिमंडळ निर्णय lockup
  // (code-stamped leader header + DGIPR footer) and is kept out of the DGIPR
  // classifier pool — it appears only when a run picks विभाग = CMO.
  refBrandLabel: 'विभाग',
  refBrandDgipr: 'DGIPR',
  refBrandCmo: 'CMO (मंत्रिमंडळ निर्णय)',
  refBrandChip: 'CMO',

  // Template layout, read off the master's pixels. This — not the type
  // description — decides whether the generated poster may carry a photo at all,
  // so a wrong reading here quietly produces a wrong poster: it is shown on every
  // tile, and can be re-checked or corrected by hand.
  refLayoutTextOnly: 'फक्त मजकूर',
  refLayoutWithPhoto: 'छायाचित्रासह',
  refLayoutUnknown: 'तपासलेले नाही',
  refLayoutRecheck: 'पुन्हा तपासा',
  refLayoutChecking: 'तपासत आहे…',
  refLayoutSlots: 'मुद्दे',
  refLayoutFlipToTextOnly: '“फक्त मजकूर” म्हणून नोंदवा',
  refLayoutFlipToPhoto: '“छायाचित्रासह” म्हणून नोंदवा',
  // The vision pass's read of what this master is ABOUT (subject/scheme). Shown for
  // library browsing AND matched against the note when a reference is picked, so it
  // is editable: a vague read costs a wrong template on every future run.
  refLayoutAbout: 'विषय:',
  refLayoutAboutEmpty: 'विषय नोंदवलेला नाही.',
  refLayoutAboutEdit: 'विषय बदला',
  refLayoutAboutLabel: 'हे टेम्पलेट कशाबद्दल आहे?',
  refLayoutAboutHint:
    'मराठीत एक-दोन वाक्यांत लिहा — योजना, विषय किंवा घोषणा. टिपणीशी जुळवून योग्य टेम्पलेट निवडण्यासाठी हाच मजकूर वापरला जातो.',
  refLayoutAboutPlaceholder: 'उदा. शेतकरी कर्जमुक्ती योजनेची घोषणा.',
  refLayoutAboutSave: 'जतन करा',
  refLayoutAboutSaving: 'जतन करत आहे…',
  refLayoutAboutCancel: 'रद्द करा',

  // Template search (shared by the /references library and the create form's picker).
  // The placeholder names the two things that are actually searchable — the subject line
  // and the type — because a bare "शोधा" invites a query the index cannot answer.
  refSearchLabel: 'टेम्पलेट शोधा',
  refSearchPlaceholder:
    'विषय, योजना किंवा प्रकार लिहा — उदा. लाडकी बहीण, पुरस्कार, कोट',
  refSearchHint:
    'मराठीत किंवा रोमन लिपीत लिहा (उदा. "ladki bahin"). शुद्धलेखन थोडे चुकले तरी चालते.',
  refSearchClear: 'शोध काढा',
  refSearchNoResults: 'या शोधाशी जुळणारे एकही टेम्पलेट नाही.',
  refSearchNoResultsHint:
    'दुसरा शब्द वापरून पाहा, किंवा गाळण्या काढा. टेम्पलेटच्या "विषय" ओळीत जे लिहिले आहे त्यावरूनच शोध चालतो.',
  refSearchCountOf: 'पैकी',
  refSearchCountSuffix: 'टेम्पलेट',
  // Structured filters. These read the master's own analysed layout, so they are exact —
  // unlike the text query, nothing here is a guess.
  refFilterPhoto: 'छायाचित्रासह',
  refFilterTextOnly: 'फक्त मजकूर',
  refFilterSlots: '४+ मुद्दे',
  refFilterClearAll: 'सर्व गाळण्या काढा',
  // Masters with no layout_spec carry no searchable text at all, so they can never match.
  // Saying so is the honest alternative to letting them vanish behind every query.
  refSearchUnanalyzed: 'अजून तपासलेली नाहीत — ती शोधात येऊ शकत नाहीत',
  refSearchUnanalyzedHint:
    'या टेम्पलेट्सचा विषय अजून नोंदवलेला नाही. "मास्टर टेम्पलेट" पानावर "पुन्हा तपासा" दाबल्यावर ती शोधात येतील.',

  // Custom reference types (create / edit / delete)
  refTypeNew: '+ नवीन प्रकार तयार करा',
  refTypeNewHint:
    'ट्विटर पोस्टरसाठी स्वतःचा प्रकार बनवा — नाव, थोडक्यात वर्णन आणि किमान एक टेम्पलेट चित्र.',
  refTypeName: 'प्रकाराचे नाव',
  refTypeNamePlaceholder: 'उदा. शेतकरी योजना',
  refTypeDesc: 'वर्णन',
  refTypeDescHint:
    'या वर्णनावरूनच टिपणीसाठी योग्य प्रकार आपोआप निवडला जातो — हे पोस्टर कधी वापरावे ते थोडक्यात लिहा.',
  refTypeDescPlaceholder:
    'उदा. शेतकऱ्यांसाठीच्या योजना, अनुदान किंवा कर्जमाफीची माहिती',
  refTypeCreate: 'प्रकार तयार करा',
  refTypeCreating: 'तयार करत आहोत…',
  refTypeEdit: 'संपादन',
  refTypeSave: 'जतन करा',
  refTypeSaving: 'जतन करत आहोत…',
  refTypeCancel: 'रद्द करा',
  refTypeDelete: 'प्रकार काढा',
  refTypeDeleteConfirm:
    'हा प्रकार कायमचा काढायचा? यातील सर्व टेम्पलेट चित्रेही काढली जातील.',

  // Home-page reference picker (pin a specific master template for this run)
  refPickerTitle: 'पोस्टर टेम्पलेट',
  refPickerHint:
    'आपोआप निवड वापरा किंवा गॅलरीतून एक ठरावीक टेम्पलेट निवडा. टेम्पलेटमध्ये किती मुद्दे मावतात त्यानुसार गट केले आहेत.',
  refPickerAuto: 'आपोआप निवड (शिफारस)',
  refPickerAutoDesc: 'विषयानुसार योग्य प्रकार व चित्र मंच स्वतः निवडेल',
  refPickerManual: 'स्वतः निवडा',
  refPickerManualDesc: 'गॅलरीतून ठरावीक टेम्पलेट निवडा',
  refPickerBadge: 'निवडले',
  refPickerSelected: 'निवडलेले टेम्पलेट',
  // The three below no longer describe anything this form can CREATE — the whole-type
  // pin went with the type headings. They stay because a restored pin (an older link, a
  // re-run of an earlier generation) still has to be readable rather than blank.
  refPickerTypeBadge: 'संपूर्ण प्रकार',
  refPickerTypeSelected: 'निवडलेला प्रकार',
  refPickerTypeHint:
    'हा प्रकार वापरला जाईल; यातील एक चित्र आपोआप (यादृच्छिक) निवडले जाईल.',
  refPickerEmpty:
    'एकही टेम्पलेट चित्र वापरात नाही. "मास्टर टेम्पलेट" पानावर चित्रे सुरू करा.',
  refPickerLoading: 'टेम्पलेट आणत आहोत…',
  refPickerPinnedTypeHint:
    'हा प्रकार व हेच चित्र वापरले जाईल; प्रकार आपोआप निवडला जाणार नाही.',
  // 'disclosure' variant (the create form): one collapsed optional row instead of the
  // आपोआप / स्वतः निवडा card pair — closed simply MEANS automatic, so the pair was asking
  // a question the fold already answers.
  refPickerDisclosureTitle: 'संदर्भ टेम्पलेट निवडा (ऐच्छिक)',
  refPickerDisclosureHint:
    'रिकामे ठेवल्यास मंच विषयानुसार योग्य टेम्पलेट स्वतः निवडेल.',
  refPickerDisclosureNone: 'आपोआप निवड',
  refPickerDisclosureClear: 'निवड काढा',
  // The क्रिएटिव्ह lane overrides the two above (noneLabel/noneHint on ReferencePicker).
  // Leaving it empty there no longer means "the platform picks a template for you" — it means
  // NO template is used at all and the poster is designed from scratch, which is the opposite
  // claim. The लेख and यूट्यूब lanes still auto-select, so they keep the originals.
  refPickerDisclosureNoneSocial: 'संपूर्ण AI रचना — टेम्पलेट नाही',
  refPickerDisclosureHintSocial:
    'रिकामे ठेवल्यास कोणतेही टेम्पलेट वापरले जाणार नाही — रंग, मांडणी व रचना AI स्वतः ठरवते. टेम्पलेट निवडल्यासच पोस्टर त्या टेम्पलेटनुसार तयार होते.',

  // Transcription (/transcribe). A recording in, Marathi text out — nothing is generated,
  // rewritten or summarised here, which the intro says plainly so nobody expects an article.
  transcribeTitle: 'ध्वनिलेखन',
  transcribeIntro:
    'ध्वनिमुद्रण जोडा किंवा यूट्युब लिंक द्या — त्याचा मराठी मजकूर याच पानावर मिळेल. मजकूर जसाच्या तसा उतरवला जातो; त्यात कोणताही बदल, सारांश किंवा भर घातली जात नाही. जोडलेली फाईल जतन केली जाते; यूट्युब व्हिडिओ मात्र डाउनलोड किंवा जतन केला जात नाही.',
  transcribeNewTitle: 'नवीन ध्वनिलेखन',
  transcribeUpload: 'ध्वनिफीत जोडा',
  transcribeHint:
    'एकावेळी अनेक फाईल जोडता येतील (कमाल १० फाईल्स, प्रत्येकी ५० MB). मोबाईलवरील नेहमीचे ध्वनिफीत प्रकार चालतात.',
  transcribeSharedReadError:
    'मोबाईलवरून पाठवलेली ध्वनिफीत उघडता आली नाही. कृपया पुन्हा Share करून Newsroom निवडा.',
  transcribeFilesTitle: 'जोडलेली ध्वनिमुद्रणे',
  transcribeNeedFile:
    'कृपया किमान एक ध्वनिमुद्रण जोडा किंवा यूट्युब लिंक द्या.',
  transcribeSubmit: 'मजकूर तयार करा',
  transcribeRunning:
    'मजकूर तयार होत आहे… मोठ्या ध्वनिमुद्रणाला काही मिनिटे लागू शकतात.',
  transcribeQueued: 'रांगेत आहे…',
  transcribeResultTitle: 'तयार झालेला मजकूर',
  transcribeCharsSuffix: 'अक्षरे',
  // A transcript that came back from the content-addressed cache: the same recording had
  // been transcribed before, so nothing was re-run.
  transcribeCached: 'आधीच्या ध्वनिलेखनातून',
  transcribeFileFailed: 'हे ध्वनिमुद्रण उतरवता आले नाही',
  transcribeEmpty: 'या ध्वनिमुद्रणातून मजकूर मिळाला नाही.',
  transcribeRecent: 'मागील ध्वनिलेखने',
  transcribeListEmpty: 'अद्याप कोणतेही ध्वनिलेखन नाही. वरून एक ध्वनिफीत जोडा.',
  transcribeListLoading: 'यादी लोड होत आहे…',
  transcribeListLoadError: 'मागील ध्वनिलेखनांची यादी मिळाली नाही.',
  transcribeFileCountSuffix: 'ध्वनिमुद्रणे',
  transcribeOpen: 'उघडा',
  transcribeClose: 'बंद करा',
  transcribeDownloadName: 'ध्वनिलेखन',
  // Carries this transcript to /dlo as the note of a new intake. Named for what the officer
  // gets at the end of that flow, not for what the button does to the text.
  transcribeToArticle: 'बातमी तयार करा',
  transcribeToArticleHint:
    'हा मजकूर लेखाच्या टिपणीत जाईल. तिथे तो तपासून व दुरुस्त करून बातमी तयार करता येईल.',

  // Errors
  // Said at the picker, before the upload starts — the whole point of checking the size in
  // the browser. The number must match UPLOAD_FILE_MAX_MB (@dgipr/schemas), which is what the
  // API enforces.
  fileTooLargeError:
    'फाईल खूप मोठी आहे. प्रत्येक फाईल कमाल ५० MB असावी. कृपया लहान फाईल निवडा.',
  genericError: 'काहीतरी चुकले. कृपया पुन्हा प्रयत्न करा.',
  busyError: 'एक काम आधीच सुरू आहे. ते पूर्ण होईपर्यंत थांबा.',

  // Explainer videos (/video)
  navVideo: 'व्हिडिओ (Beta)',
  videoTitle: 'नवीन व्हिडिओ तयार करा',
  videoIntro:
    'टिपणीवरून दोन स्वतंत्र गोष्टी तयार होतील: मराठी निवेदन आणि आवाज बंद असतानाही माहिती समजावणारी साधी दृश्य-कथा. आधी दोन्ही तपासा — व्हिडिओ तयार करण्याचा खर्च फक्त तुमच्या मंजुरीनंतरच होतो.',
  videoInputModeLabel: 'व्हिडिओ कशावरून तयार करायचा?',
  videoInputModeNote: 'टिपणीवरून',
  videoInputModeNoteDesc:
    'टिपणीतील माहितीतून ३० सेकंदांची संहिता तयार केली जाईल.',
  videoInputModeScript: 'तयार संहितेवरून',
  videoInputModeScriptDesc:
    'मराठी निवेदनातील प्रत्येक शब्द जशाचा तसा ठेवून व्हिडिओची वेळ ठरवली जाईल.',
  videoNoteLabel: 'टिपणी येथे लिहा किंवा चिकटवा',
  videoScriptInputLabel: 'तयार मराठी निवेदन येथे लिहा किंवा चिकटवा',
  videoScriptInputHint:
    'फक्त आवाजात वाचायचे निवेदन द्या. दृश्य-सूचना, वक्त्यांची नावे किंवा रंगमंच सूचना देऊ नका.',
  videoScriptEstimateLabel: 'मोफत अंदाज',
  videoScriptEstimateOver:
    'ही संहिता दोन मिनिटांपेक्षा मोठी दिसते. कृपया निवेदन लहान करा.',
  videoScriptMarathiOnly: 'तयार निवेदन मराठीत असणे आवश्यक आहे.',
  // Officer-supplied voiceover: the department's own voice, or a TTS product
  // whose plan gives no API access. The file replaces the synthesized track
  // entirely and decides the video's length.
  videoNarrationAudioLabel: 'निवेदनाची ध्वनिफीत (ऐच्छिक)',
  videoNarrationAudioHint:
    'तुमच्याकडे या निवेदनाची तयार ध्वनिफीत असेल तर ती द्या — तीच व्हिडिओत वापरली जाईल आणि तिच्या लांबीवरून दृश्ये ठरतील. काहीही न दिल्यास आवाज आपोआप तयार होईल.',
  videoNarrationAudioRemove: 'ध्वनिफीत काढा',
  videoNarrationAudioMeasured: 'दिलेल्या ध्वनिफीतीवरून',
  videoNarrationAudioUnreadable:
    'ही ध्वनिफीत ब्राउझरला वाचता आली नाही; तरीही पाठवून पाहता येईल.',
  videoNarrationAudioTooLong:
    'ही ध्वनिफीत दोन मिनिटांपेक्षा मोठी आहे. कृपया लहान ध्वनिफीत द्या.',
  videoNarrationAudioTooBig: 'ध्वनिफीत ५० MB पेक्षा मोठी असू शकत नाही.',
  videoHeadingLabel: 'शीर्षक / मुख्य मुद्दा (ऐच्छिक)',
  videoDurationLabel: 'व्हिडिओची लांबी',
  videoDurationShort: '३० सेकंद',
  videoDurationShortHint: 'निवेदन ३० सेकंदांत बसवले जाते — साधारण २–४ दृश्ये',
  videoDurationLong: '१ मिनिट',
  videoDurationLongHint: 'निवेदन १ मिनिटात बसवले जाते — साधारण ४–८ दृश्ये',
  videoOrientationLabel: 'आकार',
  videoOrientationLandscape: 'आडवा (16:9)',
  videoOrientationLandscapeHint: 'YouTube, वेबसाईट',
  videoOrientationVertical: 'उभा (9:16)',
  videoOrientationVerticalHint: 'रील्स, स्टेटस, शॉर्ट्स',
  videoTierLabel: 'दर्जा',
  videoTierFast: 'संतुलित',
  videoTierFastHint: 'शिफारस केलेला',
  videoTierStandard: 'सर्वोत्तम',
  // Deliberately NOT a cost claim any more. It used to read "सुमारे अडीचपट
  // खर्च" (~2.5x the cost), which was Veo's ratio; on Kling 3.0 with the
  // resolution pinned server-side the two tiers cost the same, and the estimate
  // rendered beside each option now says so on its own.
  videoTierStandardHint: 'उच्च दर्जा — सर्व्हर सेटिंगनुसार लागू',
  videoCreate: 'संहिता तयार करा',
  videoCreateFromScript: 'दृश्य आराखडा तयार करा',
  videoCreateHint: 'या टप्प्यावर व्हिडिओचा खर्च होत नाही.',
  videoEstimateApprox:
    'खर्च अंदाजे आहे — नक्की खर्च स्टोरीबोर्ड मंजुरीच्या वेळी दिसेल.',
  videoActiveBlocked:
    'दुसरा व्हिडिओ प्रकल्प सध्या तयार होत आहे. तो पूर्ण झाल्यावर नवीन सुरू करता येईल.',
  videoRecent: 'मागील व्हिडिओ',
  videoNoteTooShort: 'टिपणी किमान २० अक्षरांची हवी.',
  videoScriptTooShort: 'तयार निवेदन किमान २० अक्षरांचे हवे.',

  // Script gate (gate 1)
  videoScriptTitle: 'संहिता तपासा व संपादित करा',
  videoScriptIntro:
    'सर्व दृश्यांतील निवेदन एकाच सलग आवाजात वाचले जाईल; दृश्य बदलताना विराम पडणार नाही. क्रमाने वाचल्यावर संहिता नैसर्गिक वाहते आहे का ते पहा. दृश्याने त्याच क्षणी ऐकू येणारे प्रत्येक वाक्य दाखवण्याची गरज नाही.',
  videoSceneLabel: 'दृश्य',
  videoSceneBeatLabel: 'निवेदनाचा मुद्दा',
  videoNarrationLabel: 'निवेदन (मराठी)',
  videoNarrationHint:
    'ही सर्व निवेदन-खाने क्रमाने जोडून एकच सलग आवाज तयार होईल. दृश्याची नियोजित वेळ ३–१५ सेकंद आहे; संपूर्ण निवेदन निवडलेल्या एकूण वेळेत बसवा.',
  videoNarrationLockedHint:
    'हे तुम्ही दिलेले अंतिम निवेदन आहे. प्रत्येक शब्द जशाचा तसा ठेवला जाईल; फक्त दृश्य-वर्णन संपादित करता येईल.',
  videoNarrationTooFast: 'निवेदन थोडे वेगाने वाजेल — हवे असल्यास लहान करा.',
  videoNarrationListen: 'निवेदनाचा आवाज ऐका',
  videoNarrationTotalOver:
    'सलग निवेदन एकूण वेळेपेक्षा जास्त आहे — मजकूर लहान करा, नाहीतर संपूर्ण संहिता सलगपणा राखून आपोआप संक्षिप्त केली जाईल.',
  videoBriefLabel: 'प्रारंभ दृश्य-वर्णन (इंग्रजी)',
  videoBriefHint:
    'या दृश्यातून काय दाखवायचे आहे ते लिहा. निवेदनाची खरी लांबी ठरल्यानंतर दिग्दर्शन, अभिनय, हावभाव आणि कॅमेऱ्याची हालचाल स्वतंत्रपणे तयार होईल.',
  videoEndBriefLabel: 'अंतिम दृश्य-वर्णन (इंग्रजी)',
  videoEndBriefHint:
    'ऐच्छिक. दरवाजा पूर्ण बंद होणे किंवा वस्तू दुसऱ्या व्यक्तीकडे पोहोचणे यासारखी ठरावीक अंतिम स्थिती आवश्यक असेल तरच लिहा. अन्यथा रिकामे ठेवा.',
  videoMotionBriefLabel: 'दृश्यातील हालचाल आणि अभिनय',
  videoMotionBriefEditHint:
    'या दृश्यात काय घडते — हावभाव, हातांची व वस्तूंची हालचाल, कॅमेरा — हे क्रमाने इंग्रजीत लिहा. चित्रे बदलत नाहीत; हा मजकूर फक्त पुढच्या वेळी हे दृश्य तयार करताना वापरला जातो.',
  videoMotionBriefSave: 'हालचाल जतन करा',
  videoMotionBriefSaved:
    'जतन झाले. हे दृश्य पुन्हा तयार केल्यावर हा बदल दिसेल.',
  videoKeyPointLabel: 'पडद्यावरील ठळक ओळ (मराठी)',
  videoKeyPointHint:
    'या दृश्यावर दिसणारा एकच ठोस तपशील — रक्कम, मुदत, संख्या, योजनेचे नाव. रिकामी ठेवली तर या दृश्यावर काहीही लिहिले जाणार नाही.',
  videoKeyPointReviewLabel: 'पडद्यावरील ओळ',
  videoStyleLabel: 'दृश्यशैली व स्थळ (इंग्रजी — सर्व दृश्यांना लागू)',
  videoStyleHint:
    'सर्व दृश्ये याच वास्तव, live-action चित्रपट-शैलीत तयार होतात. महाराष्ट्र/भारत, नैसर्गिक प्रकाश, वास्तव भारतीय व्यक्ती व संयत documentary look स्पष्ट ठेवा. ही ओळ बदलली की सर्व दृश्ये पुन्हा काढावी लागतात.',
  videoAddScene: 'दृश्य जोडा',
  videoRemoveScene: 'हे दृश्य काढा',
  videoInsertSceneAfter: 'यानंतर नवीन दृश्य जोडा',
  videoNarrationResplitHint:
    'या दृश्यावर कोणते वाक्य ऐकू यावे ते ठरवा. शेजारच्या दृश्यातून मजकूर कापून इथे चिकटवा — शब्द तेच राहिले तर आवाज पुन्हा तयार करावा लागत नाही; फक्त दृश्यांची वेळ आवाजाशी जुळवली जाते.',
  videoInsertedSceneHint:
    'नवीन दृश्य. शेजारच्या दृश्यातील मजकूर कापून इथे चिकटवा आणि दृश्य-वर्णन लिहा. नवीन शब्द लिहू नका — तसे केल्यास संपूर्ण निवेदन पुन्हा तयार करावे लागेल.',
  videoSaveStoryboardScript: 'बदल जतन करा',
  videoSaveStoryboardScriptHint:
    'निवेदनाचे शब्द तेच ठेवून फक्त विभागणी बदलली, तर आवाज पुन्हा तयार होत नाही. ज्या दृश्यांची वेळ बदलेल तेवढीच दृश्ये पुन्हा तयार करावी लागतील.',
  videoSceneNeedsFrames:
    'या दृश्याची चित्रे अजून काढलेली नाहीत — खालील “या दृश्याची चित्रे तयार करा” वापरा.',
  // A stored scene with no frames yet (a just-saved inserted scene). The redraw
  // fold is the same control, but "पुन्हा काढा" is the wrong word when nothing
  // has been drawn at all.
  videoRenderSceneFrames: 'या दृश्याची चित्रे तयार करा',
  // Page-level: renders the frames of every scene that is still missing them.
  // The storyboard job skips scenes whose frames are current, so only the new
  // scene is paid for; the narration audio is already measured and is not
  // re-synthesized.
  videoRenderMissingFrames: 'उरलेल्या दृश्यांची चित्रे तयार करा',
  videoRenderMissingFramesHint:
    'चित्रे नसलेल्या दृश्यांचीच चित्रे तयार होतील (अल्प खर्च). आधी तयार झालेली चित्रे, आवाज व क्लिप्स तशाच राहतात.',
  videoToStoryboard: 'स्टोरीबोर्ड तयार करा',
  videoToStoryboardHint:
    'प्रत्येक दृश्याचे नमुना चित्र तयार होईल (अल्प खर्च, व्हिडिओ नाही).',

  // Storyboard gate (gate 2)
  videoStoryboardTitle: 'स्टोरीबोर्ड तपासा',
  videoStoryboardIntro:
    'प्रत्येक दृश्याची प्रारंभ फ्रेम आणि गरज असेल तेथे अंतिम फ्रेम तपासा. चित्र साधे व सहज animate होण्यासारखे नसेल तर वर्णन बदलून पुन्हा काढा — त्याचा खर्च अगदी थोडा आहे.',
  videoStartFrameLabel: 'प्रारंभ फ्रेम',
  videoEndFrameLabel: 'अंतिम फ्रेम',
  videoRedrawStill: 'प्रारंभ फ्रेम पुन्हा काढा',
  videoRedrawStillNote:
    'प्रारंभ फ्रेम बदलली की या दृश्याला अंतिम फ्रेम असल्यास तीही तिच्यावरून नव्याने काढली जाते.',
  videoRedrawEndStill: 'अंतिम फ्रेम पुन्हा काढा',
  // The fold's TOGGLE. Deliberately different from the two labels above, which
  // belong to the primary button inside the fold — the one that actually spends.
  videoEditStartBrief: 'प्रारंभ फ्रेमचे वर्णन बदला',
  videoEditEndBrief: 'अंतिम फ्रेमचे वर्णन बदला',
  videoInsertedSceneSaveFirst:
    'हे नवीन दृश्य अजून जतन झालेले नाही. खालील “बदल जतन करा” दाबल्यावर या दृश्याची चित्रे काढता येतील.',
  videoEndStillPending: 'अंतिम फ्रेम अजून काढलेली नाही',
  videoEditBrief: 'वर्णन बदला',
  videoAnimate: 'व्हिडिओ तयार करा',
  videoAnimateEstimate: 'अंदाजे खर्च',
  videoAnimateConfirm: 'नक्की तयार करायचा? हा खर्च परत मिळत नाही.',
  videoAnimateConfirmYes: 'होय, व्हिडिओ तयार करा',
  videoAnimateCancel: 'रद्द करा',
  videoBackToScript: 'संहितेकडे परत जा',

  // Rendering + result
  videoAnimatingHint:
    'व्हिडिओ तयार होण्यास काही मिनिटे लागतात. हे पान बंद केले तरी काम सुरू राहते.',
  videoResultTitle: 'तयार व्हिडिओ',
  videoDownload: 'व्हिडिओ डाउनलोड करा',
  videoSrtDownload: 'SRT (निवेदन वेळेसह) डाउनलोड करा',
  videoSrtHint:
    'व्हिडिओ मुका आहे. खालील बटणाने निवेदनाचा मराठी आवाज जोडा — SRT फाईलमध्ये प्रत्येक दृश्याची वेळ आहे.',
  videoSrtHintVoiced:
    'व्हिडिओत मराठी निवेदनाचा आवाज जोडला आहे. SRT फाईलमध्ये प्रत्येक दृश्याची वेळ आहे.',
  videoAddNarration: 'निवेदनाचा आवाज जोडा',
  videoReNarration: 'आवाज पुन्हा तयार करा',
  videoRestitch: 'क्लिप्स पुन्हा जोडून व्हिडिओ तयार करा',
  videoRestitchHint:
    'आधी तयार झालेल्या क्लिप्स आणि आवाजच पुन्हा जोडले जातील; कोणत्याही दृश्याचा अतिरिक्त खर्च होणार नाही.',
  videoRestitchingHint: 'तयार क्लिप्स पुन्हा जोडून अंतिम व्हिडिओ तपासत आहोत…',
  videoClipPreview: 'तयार झालेली क्लिप',
  videoNarrationHintCta:
    'प्रत्येक दृश्याचे मराठी निवेदन Sarvam आवाजात तयार होऊन व्हिडिओत जोडले जाईल.',
  videoNarratingHint:
    'निवेदनाचा आवाज तयार होत आहे. हे पान बंद केले तरी काम सुरू राहते.',
  videoTimedScript: 'वेळेसह निवेदन',
  videoFixScene: 'एखादे दृश्य सुधारायचे?',
  videoReanimateScene: 'फक्त हे दृश्य पुन्हा तयार करा',
  videoReanimateHint: 'फक्त या दृश्याचा खर्च होईल; बाकीचा व्हिडिओ तसाच राहतो.',
  videoRetryAnimate: 'पुन्हा प्रयत्न करा',
  videoResumeHint: 'आधी तयार झालेली दृश्ये पुन्हा वापरली जातील.',
  videoBackToStoryboard: 'स्टोरीबोर्डवर परत जा',
  videoBackToStoryboardDoneHint:
    'चित्रे बदलणे, निवेदनाची विभागणी बदलणे किंवा नवीन दृश्य जोडण्यासाठी स्टोरीबोर्डवर परत जा. सध्याचा व्हिडिओ व सर्व क्लिप्स जतन राहतात.',
  videoBackToStoryboardHint:
    'दृश्यांची चित्रे व हालचालीची सूचना पुन्हा तपासून बदलता येईल. आधी तयार झालेल्या क्लिप्स जतन राहतात — पुन्हा ॲनिमेशन केल्यास फक्त उरलेली दृश्ये तयार होतील.',
  videoStillPending: 'चित्र अजून काढलेले नाही',
  videoSceneFailed: 'हे दृश्य अयशस्वी झाले',

  // ---------- चॅट (/chat) ----------
  navChat: 'चॅट',
  chatTitle: 'चॅट',
  chatNew: 'नवीन चॅट',
  chatNewShort: 'नवीन',
  chatEmptyTitle: 'काय मदत करू?',
  chatEmptyHint:
    'काहीही विचारा — पत्राचा मसुदा, शासन निर्णयाचा अर्थ, चित्रात काय आहे, फाईलचा सारांश.',
  chatPlaceholder: 'इथे लिहा…',
  chatSend: 'पाठवा',
  chatStop: 'थांबवा',
  chatThinking: 'विचार करत आहे…',
  // Only read aloud: on screen this is a spinner, which says the same thing faster.
  chatLoading: 'उघडत आहोत…',
  chatFailed: 'उत्तर तयार करता आले नाही. पुन्हा प्रयत्न करा.',
  chatLoadFailed: 'ही चॅट उघडता आली नाही.',
  chatYours: 'तुमच्या चॅट्स',
  chatOthers: 'इतर चॅट्स',
  chatNoThreads: 'अजून एकही चॅट नाही.',
  chatListFailed: 'चॅट्सची यादी उघडता आली नाही.',
  chatDelete: 'चॅट काढून टाका',
  chatDeleteConfirm: 'ही चॅट कायमची काढून टाकायची?',
  chatDeleteFailed: 'चॅट काढता आली नाही.',
  chatOpenList: 'चॅट्सची यादी',
  chatCloseList: 'यादी बंद करा',
  chatAttach: 'फाईल जोडा',
  chatAttachImage: 'चित्र',
  chatAttachDocument: 'दस्तऐवज',
  chatAttachAudio: 'ध्वनिमुद्रण',
  chatAttachYouTube: 'यूट्युब लिंक',
  chatAttachRemove: 'काढून टाका',
  // Nothing is uploaded, read or transcribed until the message is sent, so a picked file
  // waits — and its chip says so rather than claiming to be ready.
  chatAttachPending: 'पाठवल्यावर वाचली जाईल',
  chatAttachWorking: 'फाईल्स वाचून घेत आहोत… त्यानंतर संदेश पाठवला जाईल.',
  chatAttachPreparing: 'तयार करत आहोत…',
  chatAttachTranscribing: 'ध्वनिमुद्रण लिहून घेत आहोत… (काही मिनिटे लागू शकतात)',
  chatAttachReady: 'तयार',
  chatAttachFailed: 'ही फाईल वाचता आली नाही.',
  chatAttachEmpty: 'या फाईलमध्ये वाचण्यासारखा मजकूर मिळाला नाही.',
  chatAttachWait: 'फाईल तयार होईपर्यंत थांबा.',
  chatAttachTooMany: 'एका संदेशाला जास्तीत जास्त १० फाईल्स जोडता येतात.',
  chatAttachedImage: 'चित्र',
  chatCopy: 'कॉपी करा',
  chatCopied: 'कॉपी झाले',

  // ---------- वापर विश्लेषण (/analytics) ----------
  navAnalytics: 'वापर विश्लेषण',
  analyticsTitle: 'वापर विश्लेषण',
  analyticsIntro:
    'विभागाने या मंचावर किती काम केले याचा एकत्रित आढावा. सर्व आकडे संपूर्ण विभागाचे आहेत.',
  analyticsRangeLabel: 'कालावधी',
  analyticsRange7d: '७ दिवस',
  analyticsRange30d: '३० दिवस',
  analyticsRange90d: '९० दिवस',
  analyticsRangeAll: 'सुरुवातीपासून',
  analyticsLoading: 'आकडेवारी गोळा करत आहोत…',
  analyticsRetry: 'पुन्हा प्रयत्न करा',
  analyticsEmpty: 'या कालावधीत कोणतीही नोंद नाही.',
  analyticsTrendTitle: 'दैनंदिन वापर',
  analyticsTrendHint:
    'प्रत्येक स्तंभ म्हणजे त्या दिवशी पूर्ण झालेली कामे. रिकामे दिवसही दाखवले आहेत.',
  analyticsTrendAllHint: 'शेवटच्या ९० दिवसांचा आलेख.',
  // What the vertical axis counts. Stated on the chart itself, not only in the caption: a
  // reader looking at the bar heights should not have to find a footnote to know the unit.
  analyticsTrendYAxis: 'उभा अक्ष: त्या दिवशी पूर्ण झालेली कामे (संख्या)',
  analyticsTrendTable: 'दिवसनिहाय आकडे पाहा',
  analyticsTableDay: 'दिवस',
  analyticsTableWork: 'कामे',
  analyticsShareTitle: 'सुविधानिहाय वापर',
  analyticsShareHint: 'या कालावधीत प्रत्येक सुविधेने तयार केलेले साहित्य.',
  analyticsFeaturesTitle: 'सुविधानिहाय तपशील',
  analyticsOpenFeature: 'तपशील पाहा',
  analyticsBack: 'विश्लेषणाकडे परत',
  analyticsOpenTool: 'ही सुविधा उघडा',
  analyticsDetailsTitle: 'तपशील',
  analyticsBreakdownTitle: 'विभागणी',
  analyticsCostTitle: 'खर्च',
  analyticsCostPerOutput: 'सरासरी खर्च प्रति साहित्य',
  analyticsCostTotal: 'या कालावधीतील एकूण खर्च',
  analyticsCostNone: 'या सुविधेचा खर्च स्वतंत्रपणे मोजला जात नाही.',
  analyticsNotTracked: 'नोंद उपलब्ध नाही',
  analyticsEventNotice:
    'या सुविधेची नोंद ठेवायला अलीकडेच सुरुवात झाली आहे, त्यामुळे त्याआधीचा वापर यात दिसणार नाही.',
  analyticsEventsUnavailable:
    'वापराच्या नोंदी वाचता आल्या नाहीत. भाषांतर व मुद्रितशोधनाचे आकडे अपूर्ण असू शकतात.',
  analyticsEstimateNote: 'हा अंदाजे आकडा आहे.',
  analyticsDeltaNew: 'नवीन',
  analyticsDeltaFlat: 'बदल नाही',

  // Services — which paid outside service each feature actually ran on. Named by
  // CAPABILITY, never by provider: "ध्वनिलेखन" stays ध्वनिलेखन whether ElevenLabs or
  // Sarvam served it, and the provider is a smaller line underneath.
  analyticsServicesTitle: 'वापरलेल्या सेवा',
  analyticsServicesHint:
    'या सुविधेतील प्रत्येक कामासाठी वापरलेली सेवा, मॉडेल, कॉल, प्रक्रिया आणि खर्च.',
  analyticsServicesNone:
    'या कालावधीत या कार्यप्रवाहातील कोणतीही सेवा वापरली गेली नाही.',
  analyticsServiceTableTask: 'काम आणि सेवा',
  analyticsServiceTableUsage: 'वापर',
  analyticsServiceTableCost: 'खर्च',
  analyticsServiceText: 'मजकूर निर्मिती (AI)',
  analyticsServiceEmbedding: 'अर्थाधारित संदर्भ शोध',
  analyticsServiceImage: 'प्रतिमा निर्मिती',
  analyticsServiceOcr: 'स्कॅन केलेली पृष्ठे वाचणे (OCR)',
  analyticsServiceStt: 'ध्वनिलेखन (आवाजाचे मजकुरात रूपांतर)',
  analyticsServiceTts: 'निवेदनाचा आवाज (TTS)',
  analyticsServiceClip: 'व्हिडिओ क्लिप निर्मिती',
  analyticsServiceTranslate: 'भाषांतर सेवा',
  analyticsTaskAudioTranscription: 'ध्वनिमुद्रणाचे ध्वनिलेखन',
  analyticsTaskYoutubeTranscription: 'YouTube व्हिडिओचे ध्वनिलेखन',
  analyticsTaskAudioYoutubeTranscription:
    'ध्वनिमुद्रण व YouTube व्हिडिओचे ध्वनिलेखन',
  analyticsTaskDocumentOcr: 'स्कॅन केलेल्या पृष्ठांचे OCR वाचन',
  analyticsTaskDesignationExtraction: 'व्यक्ती व पदनाम शोध',
  analyticsTaskArticleGeneration: 'लेखाचा मसुदा व पडताळणी',
  analyticsTaskArticleRevision: 'अभिप्रायानुसार लेख सुधारणा',
  analyticsTaskTranslationNames: 'भाषांतरापूर्वी नावांचा शोध',
  analyticsTaskEnglishTranslation: 'इंग्रजी भाषांतर',
  analyticsTaskHindiTranslation: 'हिंदी भाषांतर',
  analyticsTaskMarathiTranslation: 'मराठी भाषांतर',
  analyticsTaskProofreading: 'मुद्रितशोधन व भाषा तपासणी',
  analyticsTaskSocialPost: 'सोशल मीडिया पोस्टर तयार करणे',
  analyticsTaskSocialCaption: 'सोशल मीडिया कॅप्शन लिहिणे',
  analyticsTaskSocialCaptionRevision: 'कॅप्शनमध्ये सुधारणा',
  analyticsTaskYoutubeThumbnail: 'YouTube थंबनेल तयार करणे',
  analyticsTaskPosterRegeneration: 'पोस्टर पुन्हा तयार करणे',
  analyticsTaskPosterContentRevision: 'पोस्टर मजकूर किंवा दृश्य सुधारणा',
  analyticsTaskPosterImageRevision: 'निशाणीवरून पोस्टर प्रतिमा सुधारणा',
  analyticsTaskArticlePoster: 'लेखासाठी पोस्टर तयार करणे',
  analyticsTaskVideoScript: 'व्हिडिओ पटकथा व दृश्य नियोजन',
  analyticsTaskVideoStoryboard: 'निवेदन व स्टोरीबोर्ड तयार करणे',
  analyticsTaskVideoStoryboardRevision: 'स्टोरीबोर्ड दृश्य पुन्हा तयार करणे',
  analyticsTaskVideoClips: 'व्हिडिओ क्लिप तयार करणे',
  analyticsTaskVideoSceneRevision: 'व्हिडिओ दृश्य पुन्हा ॲनिमेट करणे',
  analyticsTaskVideoNarration: 'व्हिडिओ निवेदन तयार करणे',
  analyticsTaskLegacyCombined: 'पूर्वीची एकत्रित AI नोंद',
  analyticsUnitCalls: 'कॉल',
  analyticsUnitImages: 'प्रतिमा',
  analyticsUnitPages: 'पृष्ठे',
  analyticsUnitMinutes: 'मिनिटे',
  analyticsUnitChars: 'अक्षरे',
  analyticsUnitClips: 'क्लिप',
  // Marked per row rather than explained once at the bottom: a reader who has already
  // taken the number as measured will not go back and re-read it.
  analyticsServiceEstimated: 'अंदाजित',
  analyticsServiceEstimatedTitle:
    'हा खर्च ठरवलेल्या दराने काढला आहे, प्रत्यक्ष बिलावरून नाही.',
  analyticsServiceRecent: 'अलीकडून नोंद',
  analyticsServiceRecentTitle:
    'या सेवेची नोंद ठेवायला अलीकडेच सुरुवात झाली, त्यामुळे त्याआधीचा वापर यात नाही.',
  analyticsRatesTitle: 'अंदाजासाठी वापरलेले दर',
  analyticsRatesHint:
    'हे दर आमच्याकडे नोंदवलेले आहेत; सेवेच्या किमती बदलल्यास ते बदलावे लागतात.',

  // Metric keys → labels. One flat map, shared by the KPI tiles, the feature
  // cards and the drill-downs, so the same number is never named two ways.
  analyticsMetricTotalOutputs: 'एकूण तयार झालेले साहित्य',
  analyticsMetricArticles: 'लेख',
  analyticsMetricPosters: 'पोस्टर',
  analyticsMetricCaptions: 'कॅप्शन',
  analyticsMetricTranscripts: 'ध्वनिलेखने',
  analyticsMetricVideos: 'व्हिडिओ',
  analyticsMetricTranslations: 'भाषांतरे',
  analyticsMetricChecks: 'तपासण्या',
  analyticsMetricActiveDays: 'वापर झालेले दिवस',
  analyticsMetricCostPerOutput: 'सरासरी खर्च प्रति साहित्य',
  analyticsMetricPublished: 'प्रकाशित पोस्ट',
  analyticsMetricFeedbackRounds: 'सुधारणा फेऱ्या',
  analyticsMetricFailed: 'अयशस्वी',
  analyticsMetricSuccessRate: 'यशस्वी होण्याचे प्रमाण',
  analyticsMetricIntakesStarted: 'सुरू केलेली कामे',
  analyticsMetricIntakesReady: 'तपासणीसाठी तयार',
  analyticsMetricPdfExports: 'PDF डाउनलोड',
  analyticsMetricRecordings: 'ध्वनिमुद्रणे व लिंक',
  analyticsMetricCharacters: 'अक्षरे',
  analyticsMetricEstimatedMinutes: 'अंदाजे कालावधी',
  analyticsMetricFailedFiles: 'अयशस्वी फाईल्स',
  analyticsMetricAdHoc: 'सुटे भाषांतर',
  analyticsMetricFromGenerations: 'लेखांची भाषांतरे',
  analyticsMetricIssuesFound: 'आढळलेल्या त्रुटी',
  analyticsMetricProjectsStarted: 'सुरू केलेले प्रकल्प',

  // Breakdown slice keys → labels.
  analyticsSliceTwitter: 'ट्विटर',
  analyticsSliceFacebook: 'फेसबुक',
  analyticsSliceArticlePoster: 'लेख पोस्टर',
  analyticsSliceYoutubeThumb: 'यूट्युब थंबनेल',
  analyticsSliceNews: 'बातमी',
  analyticsSliceScheme: 'योजना-लेख',
  analyticsSliceEnglish: 'इंग्रजी',
  analyticsSliceHindi: 'हिंदी',
  analyticsSliceMarathi: 'मराठी',
  analyticsSliceShort: '३० सेकंदांचे',
  analyticsSliceLong: '१ मिनिटाचे',
} as const;

// The window the page is reporting on, spelled out. Shown under the title because
// "गेल्या ३० दिवसांत" alone leaves the reader guessing which 30 days — and in a
// meeting the exact dates are the first thing that gets asked.
export function analyticsWindowLine(window: string): string {
  return `${window} या कालावधीतील आकडेवारी`;
}

// Growth against the previous period of the same length. Stated in full rather
// than as a bare arrow: this line is often read aloud.
export function analyticsDeltaLine(
  percent: number,
  direction: 'up' | 'down',
): string {
  const change = percent.toLocaleString('mr-IN');
  return direction === 'up'
    ? `मागील कालावधीपेक्षा ${change}% जास्त`
    : `मागील कालावधीपेक्षा ${change}% कमी`;
}

// Used instead of a percentage when the base was so small that the percentage would be
// absurd — the first busy month against a nearly empty one.
export function analyticsDeltaCount(
  count: number,
  direction: 'up' | 'down',
): string {
  const change = count.toLocaleString('mr-IN');
  return direction === 'up'
    ? `मागील कालावधीपेक्षा ${change} ने जास्त`
    : `मागील कालावधीपेक्षा ${change} ने कमी`;
}

// "$1" is deliberately spelled out rather than written as a symbol: `$१` mixes a Latin sign
// with a Devanagari numeral and reads as neither.
export function analyticsCostRateNote(rate: number): string {
  return `खर्च १ अमेरिकी डॉलर = ₹${rate.toLocaleString('mr-IN')} या दराने रुपयांत दाखवला आहे.`;
}

// One rate line, e.g. "ध्वनिलेखन (ElevenLabs): ₹३५ प्रति ६० मिनिटे". `per` is spelled out
// rather than reduced to a per-unit figure, because the published rate really is quoted per
// hour or per 1,000 characters and a reader reconciling it against an invoice needs the
// same shape.
export function analyticsRateLine(
  service: string,
  provider: string,
  inr: number,
  per: number,
  unit: string,
): string {
  const amount = inr.toLocaleString('mr-IN', { maximumFractionDigits: 2 });
  const quantity = per.toLocaleString('mr-IN');
  return `${service} (${provider}): ₹${amount} प्रति ${quantity} ${unit}`;
}

export function analyticsDayWork(day: string, count: number): string {
  return `${day}: ${count.toLocaleString('mr-IN')} कामे`;
}

// Marathi labels + chip colors for a video project's statuses. The two gates
// are the USER's turn (not the server's), so they get the queued color, not
// the running one.
// DLO intake status, for the shared work list on /dlo. 'ready' is deliberately not "पूर्ण":
// a ready intake is waiting for the officer to review it, not finished.
export const DLO_STATUS_LABELS: Record<
  string,
  { label: string; chip: 'queued' | 'running' | 'completed' | 'failed' }
> = {
  queued: { label: 'रांगेत', chip: 'queued' },
  running: { label: 'प्रक्रिया सुरू', chip: 'running' },
  ready: { label: 'तपासणीसाठी तयार', chip: 'completed' },
  failed: { label: 'अयशस्वी', chip: 'failed' },
};

// Its own map rather than a reuse of DLO_STATUS_LABELS: there 'ready' means "ready for the
// officer to review", here it means the transcript is done — the same word would mislead.
export const TRANSCRIPTION_STATUS_LABELS: Record<
  string,
  { label: string; chip: 'queued' | 'running' | 'completed' | 'failed' }
> = {
  queued: { label: 'रांगेत', chip: 'queued' },
  running: { label: 'सुरू आहे', chip: 'running' },
  ready: { label: 'तयार', chip: 'completed' },
  failed: { label: 'अयशस्वी', chip: 'failed' },
};

export const VIDEO_STATUS_LABELS: Record<
  string,
  { label: string; chip: 'queued' | 'running' | 'completed' | 'failed' }
> = {
  scripting: { label: 'संहिता तयार होत आहे', chip: 'running' },
  script_ready: { label: 'संहिता तपासणीच्या प्रतीक्षेत', chip: 'queued' },
  storyboarding: { label: 'चित्रे तयार होत आहेत', chip: 'running' },
  storyboard_ready: {
    label: 'स्टोरीबोर्ड मंजुरीच्या प्रतीक्षेत',
    chip: 'queued',
  },
  animating: { label: 'व्हिडिओ तयार होत आहे', chip: 'running' },
  completed: { label: 'पूर्ण झाले', chip: 'completed' },
  failed: { label: 'अयशस्वी', chip: 'failed' },
};

// Marathi labels for the video project's machine step keys (the working
// statuses' progress lines).
export const VIDEO_STEP_LABELS: Record<string, string> = {
  script: 'संहिता लिहित आहोत…',
  stills: 'दृश्यांची नमुना चित्रे काढत आहोत…',
  animate: 'दृश्ये ॲनिमेट होत आहेत…',
  narrate: 'निवेदनाचा आवाज तयार होत आहे…',
  stitch: 'दृश्ये जोडत आहोत…',
  upload: 'व्हिडिओ जतन होत आहे…',
  done: 'पूर्ण झाले',
};

// Marathi labels for the DLO intake job's machine step keys.
export const DLO_INTAKE_STEP_LABELS: Record<DloIntakeStep, string> = {
  upload: 'फाईल अपलोड होत आहेत…',
  transcribe: 'ध्वनिमुद्रणाचे शब्दांकन होत आहे…',
  extract: 'कागदपत्रांतील मजकूर वाचत आहोत…',
  combine: 'सर्व माहिती एकत्र करत आहोत…',
  done: 'पूर्ण झाले',
};

// Marathi labels for the machine step keys the API writes.
export const STEP_LABELS: Record<GenerationStep, string> = {
  // Covers the whole setup window before drafting: the name dictionary, the officer's
  // designations and — when ARTICLE_STYLE_REFERENCES_ENABLED is on — the style reference.
  // Deliberately not "संदर्भ बातमी शोधत आहोत", which is false whenever references are bypassed.
  retrieve: 'बातमीची तयारी करत आहोत…',
  extract_5w1h: 'माहितीचे विश्लेषण करत आहोत…',
  editorial_brief: 'संपादकीय आराखडा तयार करत आहोत…',
  draft: 'बातमी लिहित आहोत…',
  coverage: 'बातमीची पूर्णता तपासत आहोत…',
  faithfulness: 'तथ्यांची पडताळणी करत आहोत…',
  fact_check: 'तथ्य-तपासणी यादी तयार करत आहोत…',
  // The step resolves which reference template the poster is built on. It no longer
  // classifies the note into a post type first (information-first selection), so the label
  // names what the officer is actually waiting for.
  classify: 'संदर्भ टेम्पलेट निवडत आहोत…',
  copy: 'पोस्टरचा मजकूर तयार करत आहोत…',
  image: 'पोस्टरचे चित्र तयार करत आहोत…',
  // Platform-neutral: this shows for facebook runs too, and on a caption-only run it is
  // the ONLY progress line the officer ever sees.
  caption: 'कॅप्शन लिहित आहोत…',
  scene: 'पोस्टरचे चित्र तयार करत आहोत…',
  render: 'पोस्टर जुळवत आहोत…',
  revise_article: 'अभिप्रायानुसार बातमी सुधारत आहोत…',
  revise_copy: 'अभिप्रायानुसार मजकूर सुधारत आहोत…',
  revise_scene: 'नवीन चित्र तयार करत आहोत…',
  revise_image: 'चित्र पुन्हा तयार करत आहोत…',
  translate: 'भाषांतर',
  done: 'पूर्ण झाले',
};

// Marathi labels for the glossary term types (shared by the review table + filter).
export const TERM_TYPE_LABELS: Record<TermType, string> = {
  person: 'व्यक्ती',
  designation: 'पदनाम',
  scheme: 'योजना',
  place: 'ठिकाण',
  org: 'संस्था',
  other: 'इतर',
};

// Marathi labels for the proofread issue categories (/proofread issue chips).
export const PROOFREAD_TYPE_LABELS: Record<ProofreadIssueType, string> = {
  grammar: 'व्याकरण',
  spelling: 'शुद्धलेखन',
  punctuation: 'विरामचिन्हे',
  name: 'नाव',
  style: 'शैली',
};

export const REF_CATEGORY_LABELS: Record<ReferenceCategory, string> = {
  twitter: 'ट्विटर पोस्टर टेम्पलेट',
  article: 'लेख पोस्टर टेम्पलेट',
  youtube: 'यूट्यूब थंबनेल टेम्पलेट',
};

// Short Marathi category labels for the history-card gradient banner (image-less
// cards). Distinct from the longer form labels (categoryScheme etc.).
export const CATEGORY_LABELS: Record<Category, string> = {
  scheme: 'योजना',
  news: 'बातमी',
  twitter: 'ट्विटर',
  facebook: 'फेसबुक',
  youtube: 'यूट्यूब',
};

export const STATUS_LABELS: Record<GenerationStatus, string> = {
  queued: 'रांगेत',
  running: 'सुरू आहे…',
  completed: 'पूर्ण',
  failed: 'अयशस्वी',
};

const DATE_FORMAT = new Intl.DateTimeFormat('mr-IN', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}

// Day + month only (e.g. "१३ जुलै") — for tight spots like the thread rail where the
// full date + time overflows the compact card.
const SHORT_DATE_FORMAT = new Intl.DateTimeFormat('mr-IN', {
  day: 'numeric',
  month: 'long',
});

export function formatDateShort(iso: string): string {
  return SHORT_DATE_FORMAT.format(new Date(iso));
}

// The estimated USD cost of a run, for the small cost badge. Null (pre-feature rows or a
// run that hasn't recorded cost yet) shows an em dash.
export function formatCost(usd: number | null): string {
  if (usd === null || Number.isNaN(usd)) return '—';
  return `$${usd.toFixed(2)}`;
}

// Gate-2 scene chip: the clip window plus (when audio exists) the measured
// narration length, e.g. "क्लिप ६ से. · निवेदन ४.८ से.".
export function videoSceneTiming(
  clipSeconds: number,
  narrationSeconds?: number,
): string {
  const clip = `क्लिप ${clipSeconds} से.`;
  if (narrationSeconds === undefined) return clip;
  return `${clip} · निवेदन ${narrationSeconds.toFixed(1)} से.`;
}

// Gate-1 live hint: this slice's estimated speech plus the planned visual
// window. Final audio is one continuous track, not one recording per scene.
export function videoNarrationEstimate(
  seconds: number,
  clipSeconds?: number,
): string {
  const spoken = `अंदाजे ${seconds.toFixed(0)} से. बोलणे`;
  if (clipSeconds === undefined) return spoken;
  return `${spoken} → क्लिप ~${clipSeconds} से.`;
}

// A single scene's narration past the per-scene ceiling. This one is NOT
// advisory: the save route rejects it (no clip can be longer than 15 seconds),
// and without this the officer only saw the raw zod `too_big` payload. The
// remedy is stated because it is not obvious — the text has to be split across
// two scenes, not deleted.
export function videoNarrationTooLong(chars: number, max: number): string {
  return `हे निवेदन ${chars.toLocaleString('mr-IN')} अक्षरांचे आहे. एका दृश्याचे निवेदन जास्तीत जास्त ${max.toLocaleString('mr-IN')} अक्षरे असू शकते — एक क्लिप १५ सेकंदांपेक्षा मोठी होत नाही. “यानंतर नवीन दृश्य जोडा” वापरून हा मजकूर दोन दृश्यांत विभागा.`;
}

// Gate-1 running total against the project's selected length. Advisory only:
// the storyboard job measures the real audio and shortens what overruns.
// The clip provider caps its prompt, so a very long hand-typed direction is
// shortened at render time rather than failing. Say so while it is being typed.
export const VIDEO_MOTION_BRIEF_ADVISORY_CHARS = 600;

export function videoMotionBriefLength(chars: number): string {
  return chars > VIDEO_MOTION_BRIEF_ADVISORY_CHARS
    ? `${chars} अक्षरे — इतकी लांब सूचना व्हिडिओ तयार करताना सुमारे ${VIDEO_MOTION_BRIEF_ADVISORY_CHARS} अक्षरांपर्यंत छोटी केली जाईल.`
    : `${chars} अक्षरे`;
}

export function videoNarrationTotal(
  estimatedSeconds: number,
  targetSeconds: number,
): string {
  return `एकूण निवेदन: अंदाजे ${estimatedSeconds.toFixed(0)} से. / लक्ष्य ${targetSeconds} से.`;
}

export function videoReadyScriptEstimate(
  estimatedSeconds: number,
  sceneCount: number,
): string {
  const total = Math.max(0, Math.ceil(estimatedSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const duration =
    minutes > 0
      ? `${minutes.toLocaleString('mr-IN')} मि. ${seconds.toLocaleString('mr-IN')} से.`
      : `${seconds.toLocaleString('mr-IN')} से.`;
  return `अंदाजे ${duration} · ${sceneCount.toLocaleString('mr-IN')} दृश्ये`;
}
