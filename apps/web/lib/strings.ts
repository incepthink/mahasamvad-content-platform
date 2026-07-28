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
  navDlo: 'लेखनिर्मिती',
  navTranscribe: 'ध्वनिलेखन',
  navMenu: 'मेनू',
  navCollapse: 'मेनू लहान करा',
  navExpand: 'मेनू मोठा करा',
  poweredBy: 'Powered by',

  // New-generation form
  newTitle: 'नवीन लेख / पोस्टर तयार करा',
  noteLabel: 'टिपणी येथे लिहा किंवा चिकटवा',
  noteHint: 'Paste your official note (टिपणी) here',

  // Media-room home page: paste a FINISHED article, then make a poster / social post
  // from it (no article is written here — the pasted text is used as-is).
  mediaRoomTitle: 'पोस्टर व सोशल पोस्ट तयार करा',
  articlePasteLabel: 'पूर्ण लेख येथे चिकटवा',
  articlePasteHint:
    'तयार झालेला लेख येथे चिकटवा किंवा खालून फाईलमधून घ्या — दोन्ही एकत्रही करता येईल. त्यावरून पोस्टर व सोशल पोस्ट तयार होईल.',
  articlePastePlaceholder:
    'उदा. पूर्ण तयार झालेला मराठी लेख येथे चिकटवा… हाच लेख पोस्टर व सोशल पोस्टचा आधार असेल.',
  mediaOutputLabel: 'काय तयार करायचे?',
  categoryPoster: 'पोस्टर',
  categoryPosterDesc: 'लेखावर आधारित मराठी पोस्टर',
  // The output picker is two levels: WHAT to make (पोस्टर / कॅप्शन) and then WHAT FOR
  // (लेख / ट्विटर / फेसबुक). The second row's labels are shared by both branches — the
  // card above already says whether a poster or only a caption is being made, so these
  // deliberately do NOT reuse categoryTwitter/categoryFacebook, whose descriptions
  // promise "पोस्टर + कॅप्शन" (conditional under पोस्टर, false under कॅप्शन).
  mediaOutputCaption: 'कॅप्शन',
  mediaOutputCaptionDesc: 'पोस्टरशिवाय फक्त मराठी कॅप्शन',
  mediaOutputVideo: 'व्हिडिओ',
  mediaOutputVideoDesc: 'टिपणीवरून मराठी व्हिडिओ — व्हिडिओ पानावर जा',
  mediaCaptionOnlyInfo:
    'फक्त कॅप्शन तयार होईल — पोस्टर तयार होणार नाही, त्यामुळे ही पोस्ट येथून थेट प्रकाशित करता येणार नाही.',
  mediaTargetLabel: 'कशासाठी?',
  mediaTargetArticle: 'लेख',
  mediaTargetArticleDesc: 'लेखासोबत प्रसिद्ध करण्यासाठीचे पोस्टर',
  mediaTargetTwitter: 'ट्विटर',
  mediaTargetTwitterDesc: 'X (ट्विटर) साठी',
  mediaTargetFacebook: 'फेसबुक',
  mediaTargetFacebookDesc: 'फेसबुकसाठी',
  notePlaceholder:
    'उदा. शासन निर्णय, बैठकीची टिपणी, योजनेची माहिती… ही टिपणीच लेखाचा एकमेव आधार असेल.',
  headingLabel: 'शीर्षक किंवा लेखाचा रोख (ऐच्छिक)',
  headingHint:
    'शीर्षक द्या, किंवा लेखाचा रोख थोडक्यात सांगा — रिकामे ठेवल्यास मंच स्वतः रोख ठरवेल.',
  headingPlaceholder: 'उदा. कर्जमुक्तीमुळे ग्रामीण अर्थव्यवस्थेला नवी ऊर्जा',
  // The officer-supplied STYLE reference (tier 1). The hint has one job: make it unmistakable
  // that this article is copied for its SHAPE and never for its facts — an officer who pastes
  // a related article expecting its details to be reused would be misreading the field.
  styleRefLabel: 'नमुना लेख — शैलीसाठी (ऐच्छिक)',
  styleRefHint:
    'आधी प्रसिद्ध झालेला एखादा लेख इथे चिकटवा; त्याची मांडणी, शीर्षक-रचना व भाषाशैली नमुना म्हणून वापरली जाईल. यातील कोणतीही माहिती, नावे किंवा आकडे नव्या लेखात घेतले जाणार नाहीत — त्यासाठी टिपणीच एकमेव आधार आहे. रिकामे ठेवल्यास मंच जुळणारा महासंवाद लेख स्वतः निवडेल.',
  styleRefPlaceholder:
    'उदा. महासंवादवर आधी प्रसिद्ध झालेल्या लेखाचा संपूर्ण मजकूर…',
  styleRefTooLong: 'नमुना लेख खूप मोठा आहे — कृपया थोडा कमी करा.',
  categoryLabel: 'लेखाचा प्रकार?',
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
  designFresh: 'AI रचना (शिफारस)',
  designFreshDesc:
    'प्रत्येक वेळी पूर्णपणे नवे, वेगळे पोस्टर — रंग व रचना AI ठरवते',
  designAdaptive: 'टेम्पलेटवर आधारित',
  designAdaptiveDesc: 'निवडलेल्या टेम्पलेटचा आधार, विषयानुसार थोडा बदल',
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
    'एक लेख सध्या तयार होत आहे. तो पूर्ण झाल्यावर नवीन सुरू करता येईल.',

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
  // Chiefly for the media room, where a pasted article plus a file's text can add up
  // past the API's cap.
  noteTooLong:
    'मजकूर ६०,००० अक्षरांच्या मर्यादेपेक्षा मोठा आहे — नको असलेला भाग वगळा.',

  // DLO (Digital Liaison Officer) interface — meeting notes + recordings +
  // documents → transcription/extraction → editable review → article.
  dloTitle: 'DLO — बैठकीतून लेख',
  dloIntro:
    'बैठकीतील टिपणी, ध्वनिमुद्रण (MP3, WAV, M4A आदी) आणि कागदपत्रे (PDF/DOCX/TXT) येथे द्या — या सर्व माहितीतून लेख तयार होईल.',
  dloStepInput: 'माहिती द्या',
  dloStepProcessing: 'प्रक्रिया',
  // The middle rail step now covers processing + the Pointers selection + the source review,
  // so its label names the two things the officer does there.
  dloStepReview: 'मुद्दे व तपासणी',
  dloStepOutput: 'तयार लेख',
  dloNotesLabel: 'बैठकीतील टिपणी येथे लिहा',
  dloNotesHint:
    'बैठकीत जे ऐकले, ठरले किंवा आठवते ते सर्व येथे लिहा — मुद्दे, निर्णय, घोषणा, आकडेवारी.',
  dloNotesPlaceholder:
    'उदा. आजच्या बैठकीत मा. मंत्री महोदयांनी… असे जाहीर केले; योजनेसाठी … कोटी रुपयांची तरतूद…',
  // Audio and documents are added through separate controls, and the difference is real: a
  // recording is transcribed whole and has nothing to choose, while a document is read here
  // and now — page by page, with the scanned ones stopping to ask which pages are worth
  // OCR'ing before a single credit is spent.
  dloAudioTitle: 'ध्वनिमुद्रण (MP3, AAC, M4A)',
  dloAudioUpload: 'ध्वनिफीत जोडा',
  dloAudioHint:
    'बैठकीचे ध्वनिमुद्रण — एकावेळी अनेक फाईल जोडता येतील (प्रत्येकी कमाल ५० MB). फक्त MP3, AAC व M4A चालतात.',
  dloAudioFilesTitle: 'जोडलेली ध्वनिमुद्रणे',
  dloDocsTitle: 'कागदपत्रे (PDF / DOCX / TXT)',
  dloDocsHint:
    'शासन निर्णय, टिपणी किंवा इतर कागदपत्रे. प्रत्येक फाईल येथेच वाचली जाते — स्कॅन केलेल्या PDF मधून कोणती पृष्ठे वाचायची ते तुम्ही निवडाल.',
  // One upload card's own heading; the section above it explains what documents are for.
  dloDocsCardTitle: 'कागदपत्र',
  dloDocsIntakeHint:
    'PDF, DOCX किंवा TXT फाईल निवडा (कमाल ५० MB). स्कॅन केलेली PDF देखील चालते. फाईल या बैठकीसोबत जतन केली जाईल.',
  dloDocsAdd: 'आणखी कागदपत्र जोडा',
  dloRemoveFile: 'फाईल काढा',
  dloFileTypeError:
    'कृपया ध्वनिमुद्रण फाईल निवडा (MP3, WAV, M4A, AAC, FLAC, OGG, OPUS, WEBM, AIFF, AMR, WMA).',
  dloNeedInput: 'कृपया टिपणी लिहा किंवा किमान एक फाईल जोडा.',
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
    'खालील मजकूर टिपणी, ध्वनिमुद्रण व कागदपत्रांतून तयार झाला आहे. नावे, आकडे, पदनामे व योजनांची नावे तपासून हवे ते बदल करा — हाच मजकूर लेखाचा एकमेव आधार असेल.',
  dloReviewFailedWarning:
    'काही फाईल्समधून मजकूर मिळाला नाही — त्यांशिवाय पुढे जाता येईल:',
  dloReviewTooShort: 'कृपया किमान २० अक्षरांचा मजकूर ठेवा.',
  // Review step: one card per source (notes / each recording / each document),
  // PDFs with page-wise selection.
  dloReviewNotesTitle: 'बैठकीतील टिपणी',
  dloReviewInclude: 'लेखात समाविष्ट करा',
  dloReviewExcluded: 'वगळले आहे',
  dloReviewKindAudio: 'ध्वनिमुद्रण',
  dloReviewKindPdf: 'PDF कागदपत्र',
  dloReviewKindDocx: 'DOCX कागदपत्र',
  dloReviewKindTxt: 'TXT फाईल',
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
    'लेख तयार करण्यापूर्वी वरील स्कॅन केलेल्या PDF ची पृष्ठे वाचून घ्या.',
  dloReviewNoPagesPicked: 'किमान एक पृष्ठ निवडा.',
  dloReviewTotal: 'लेखासाठी वापरला जाणारा मजकूर:',
  dloReviewPreviewShow: 'पूर्ण मजकूर पाहा',
  dloReviewPreviewHide: 'पूर्ण मजकूर लपवा',
  dloReviewEmpty: 'कोणताही मजकूर निवडलेला नाही — किमान एक स्रोत निवडा.',
  dloReviewRereading: 'OCR ने पुन्हा वाचत आहे…',
  // व्यक्ती व पदनाम: the designation the article will print before each person's name. A blank
  // field means the name prints bare — a designation is never guessed from the note.
  designationsTitle: 'व्यक्ती व पदनाम तपासा',
  designationsHint:
    'लेखात या व्यक्तींचा पहिला उल्लेख "पदनाम + नाव" असा होईल (उदा. मुख्यमंत्री देवेंद्र फडणवीस). पदनाम रिकामे ठेवल्यास फक्त नाव येईल. इंग्रजी व हिंदी भाषांतरातही हेच पदनाम वापरले जाईल.',
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
    'खूण केल्यास हे पदनाम नाव-शब्दकोशात जतन होईल आणि पुढच्या लेखात आपोआप भरले जाईल.',
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
    'टिपणीत पदनाम आहे पण नाव नाही. नाव-शब्दकोशानुसार हे पदनाम खालील व्यक्तीचे आहे आणि ते लेखात वापरले जाईल. चुकीचे असल्यास खूण काढून टाका.',
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
    'यांचे पूर्ण नाव लेखात आढळले नाही, त्यामुळे पदनाम जोडता आले नाही:',
  designationWarnCorrected: 'लेखातील चुकीचे पदनाम बदलले:',
  dloGenerate: 'लेख तयार करा →',
  dloOutputTitle: 'तयार झालेला लेख',
  dloViewDetail: 'सविस्तर पाहा (अभिप्राय, भाषांतर, पोस्टर)',
  dloStartOver: 'पुन्हा सुरुवात करा',
  dloNewArticle: 'नवीन DLO लेख तयार करा',
  dloRegenerateArticle: 'याच स्रोतातून पुन्हा लेख तयार करा',

  // Several officers work at once, so /dlo is a list of work and each intake lives at its
  // own address. 'काम' throughout rather than the more technical 'सत्र', matching dloStartOver.
  dloNewWork: '+ नवीन काम सुरू करा',
  dloNewWorkTitle: 'नवीन काम',
  dloResumeTitle: 'सुरू असलेले काम',
  dloResumeAction: 'पुढे चला →',
  dloRecent: 'मागील कामे',
  dloMyWork: 'तुमचे काम',
  dloOtherWork: 'इतर कामे',
  dloListEmpty: 'अद्याप कोणतेही काम नाही. वरील फॉर्ममधून सुरुवात करा.',
  dloListLoading: 'यादी लोड होत आहे…',
  dloListLoadError: 'मागील कामांची यादी मिळाली नाही.',
  dloSourceCountSuffix: 'स्रोत',
  dloArticleReady: 'लेख तयार',
  dloArticleCount: 'लेख',
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

  // Standalone Marathi-to-English/Hindi translation
  translatePageTitle: 'भाषांतर (Translation)',
  translateInputLabel: 'मराठी मजकूर येथे लिहा किंवा चिकटवा',
  translateInputHint:
    'या मजकुराचे थेट भाषांतर केले जाईल. हा मजकूर जतन केला जाणार नाही.',
  translateInputPlaceholder: 'भाषांतरासाठी मराठी मजकूर येथे लिहा…',
  translateAction: 'भाषांतर करा',
  translateMayTakeTime: 'मोठ्या मजकुराला एक-दोन मिनिटे लागू शकतात.',
  translateOverLimit: 'मजकूर १०,००० अक्षरांपेक्षा जास्त आहे.',
  translateOutputTitle: 'इंग्रजी भाषांतर',
  translateOutputTitleHindi: 'हिंदी भाषांतर',
  translateLockedTerms: 'शब्दकोश संज्ञा वापरल्या',

  // Target-language choice (standalone /translate page)
  translateTargetLabel: 'कोणत्या भाषेत भाषांतर हवे?',
  translateTargetEnglish: 'इंग्रजी',
  translateTargetHindi: 'हिंदी',

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
  // Warning shown above a Hindi translation whose output could not carry some locked
  // names — the translation is delivered, but these need a human's eye.
  translateUnpreservedTitle: 'ही नावे तपासा',
  translateUnpreservedHint:
    'खालील नावे हिंदी भाषांतरात जशीच्या तशी दिसत नाहीत — ती बदललेली असू शकतात. कृपया भाषांतरात तपासा:',
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
    'PDF, DOCX किंवा TXT फाईल निवडा (कमाल २५ MB). स्कॅन केलेली PDF देखील चालते. फाईल जतन केली जाणार नाही.',
  docUpload: 'फाईल निवडा',
  docUploadOther: 'दुसरी फाईल निवडा',
  // Only on a surface that shows several upload cards at once (/dlo), where one document
  // has to be droppable without touching the rest.
  docRemove: 'हे कागदपत्र काढा',
  docUnsupported: 'फक्त PDF, DOCX आणि TXT फाईल्स चालतात.',
  docGone: 'ही फाईल आता उपलब्ध नाही. कृपया पुन्हा अपलोड करा.',
  // The pre-OCR selection step. Only a SCANNED PDF reaches it: a file whose text can be
  // read directly costs nothing, so it is read at once. Here the text does not exist yet —
  // showing it would mean running the very OCR being approved — so the choice is by page
  // number alone.
  docSelectTitle: 'कोणती पृष्ठे वाचायची?',
  docSelectHint:
    'ही स्कॅन केलेली PDF आहे, त्यामुळे प्रत्येक पृष्ठ OCR ने वाचावे लागेल. फक्त निवडलेलीच पृष्ठे वाचली जातील, म्हणून नको असलेली पृष्ठे आताच वगळा.',
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
    'निवडलेल्या पृष्ठांचा हा मजकूर वरील लेखासोबत आपोआप वापरला जाईल — वेगळे बटण दाबण्याची गरज नाही.',
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

  // The draft arriving live (useArticleStream). Deliberately not called "लेख" — it is not
  // the finished article until the run completes, and the officer must not copy from it.
  articleStreamingTitle: 'लेख लिहिला जात आहे',
  articleStreamingBadge: 'लिहीत आहे…',

  // Progress
  progressTitle: 'तयार होत आहे…',
  progressHint:
    'यास काही मिनिटे लागू शकतात. हे पान उघडे ठेवा किंवा नंतर परत या.',
  stepDone: 'पूर्ण',
  failedTitle: 'काम अपूर्ण राहिले',
  failedHint: 'क्षमस्व, काहीतरी चुकले. पुन्हा प्रयत्न करून पहा.',
  retry: 'पुन्हा प्रयत्न करा',

  // Results
  articleTitle: 'तयार झालेला लेख',
  givenArticle: 'दिलेला लेख',
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
  revisingArticle: 'लेख सुधारला जात आहे…',
  posterTitle: 'तयार झालेले पोस्टर',
  // Poster-skeleton label while the article is shown but the poster still renders
  posterPreparing: 'पोस्टर तयार होत आहे…',
  downloadPoster: 'पोस्टर डाउनलोड करा',
  editCopy: 'पोस्टरवरील मजकूर बदला',
  closeEditCopy: 'बदल बंद करा',
  rerender: 'पोस्टर पुन्हा तयार करा',
  rerendering: 'पोस्टर तयार होत आहे…',
  rerenderDone: 'पोस्टर तयार झाले ✓',

  // Feedback
  articleFeedbackTitle: 'लेखात बदल हवा आहे?',
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
  captionFeedbackTitle: 'कॅप्शनमध्ये बदल हवा आहे?',
  captionFeedbackHint:
    'काय बदलायचे ते आपल्या शब्दांत लिहा — उदा. "२८० अक्षरांपेक्षा लहान करा", "सर्व आकडे मराठी अंकांत लिहा". टिपणीत नसलेली माहिती जोडली जाणार नाही.',
  revisingCaption: 'कॅप्शन सुधारली जात आहे…',
  chipsCaption: [
    '२८० अक्षरांपेक्षा लहान करा',
    'सर्व आकडे मराठी अंकांत (१२३) लिहा',
    'भाषा आणखी सोपी करा',
    'शेवटी योग्य हॅशटॅग जोडा',
  ],

  // Poster version history (every render is kept; the strip lets users compare/download)
  posterVersionsTitle: 'आधीच्या आवृत्त्या',
  posterVersionLabel: 'आवृत्ती',
  posterVersionOriginal: 'मूळ',
  posterVersionCurrent: 'सद्य',
  posterVersionOpen: 'मोठ्या आकारात पाहा',

  // Generation thread: all runs spawned from the same note lineage, shown as a
  // horizontal rail on the detail page (hidden when the run has no follow-ups)
  threadTitle: 'याच टिपणीवरून तयार झालेली कामे',
  threadHint:
    'या टिपणीवरून आतापर्यंत तयार झालेली सर्व कामे. दुसरे काम उघडण्यासाठी त्यावर क्लिक करा.',
  threadRootBadge: 'मूळ',
  threadCurrentBadge: 'हे पान',
  threadNoteEdited: 'बदललेली टिपणी',

  // "Next step" panel on a finished generation (create the other format from the
  // same note, or edit the note and re-run)
  nextActionsTitle: 'पुढील पाऊल',
  nextActionsHint:
    'हीच टिपणी वापरून आणखी काही तयार करायचे आहे? खालील पर्याय निवडा.',
  nextTwitterTitle: 'याच टिपणीवरून ट्विटर पोस्ट तयार करा',
  nextTwitterHint:
    'निवडलेल्या मजकुरावरून X (ट्विटर) साठी मराठी पोस्टर + कॅप्शन तयार होईल.',
  nextSourceLabel: 'कोणता मजकूर वापरायचा?',
  sourceArticle: 'तयार झालेला लेख',
  sourceArticleDesc:
    'या कामात तयार झालेला लेख पोस्टसाठी आधार म्हणून वापरला जाईल.',
  sourceNote: 'मूळ टिपणी',
  sourceNoteDesc: 'तुम्ही दिलेली मूळ टिपणी वापरली जाईल.',
  nextTwitterCta: 'ट्विटर पोस्ट तयार करा',
  nextTwitterStarted:
    'ट्विटर पोस्ट तयार होत आहे — प्रगती वरील "सुरू असलेली कामे" मध्ये पाहा.',
  nextFacebookTitle: 'याच टिपणीवरून फेसबुक पोस्ट तयार करा',
  nextFacebookHint:
    'निवडलेल्या मजकुरावरून फेसबुकसाठी मराठी पोस्टर + कॅप्शन तयार होईल.',
  nextFacebookCta: 'फेसबुक पोस्ट तयार करा',
  nextFacebookStarted:
    'फेसबुक पोस्ट तयार होत आहे — प्रगती वरील "सुरू असलेली कामे" मध्ये पाहा.',
  nextArticleTitle: 'याच टिपणीवरून लेख तयार करा',
  nextArticleHint:
    'हीच टिपणी वापरून महासंवाद शैलीतील लेख (हवे असल्यास पोस्टरसह) तयार होईल.',
  nextArticleCta: 'लेख तयार करा',
  nextPosterTitle: 'या लेखासाठी पोस्टर तयार करा',
  nextPosterHint:
    'तयार झालेल्या लेखावरून महासंवाद शैलीतील पोस्टर याच कामात तयार होईल — नवीन काम सुरू होणार नाही.',
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
    'पोस्टरसाठी वापरली जाणारी मूळ (मास्टर) टेम्पलेट चित्रे येथे व्यवस्थापित करा. एका प्रकारात एकाच वेळी अनेक चित्रे "वापरात" ठेवता येतात — प्रत्येक पोस्टरसाठी त्यांतील एक आपोआप निवडले जाते. नवीन प्रकारही तयार करता येतात.',
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
    'आपोआप निवड वापरा, संपूर्ण प्रकार निवडा किंवा गॅलरीतून एक ठरावीक टेम्पलेट निवडा.',
  refPickerAuto: 'आपोआप निवड (शिफारस)',
  refPickerAutoDesc: 'विषयानुसार योग्य प्रकार व चित्र मंच स्वतः निवडेल',
  refPickerManual: 'स्वतः निवडा',
  refPickerManualDesc: 'गॅलरीतून ठरावीक टेम्पलेट निवडा',
  refPickerBadge: 'निवडले',
  refPickerSelected: 'निवडलेले टेम्पलेट',
  refPickerTypeSelect: 'संपूर्ण प्रकार वापरा (यादृच्छिक चित्र)',
  refPickerTypeBadge: 'संपूर्ण प्रकार',
  refPickerTypeSelected: 'निवडलेला प्रकार',
  refPickerTypeHint:
    'हा प्रकार वापरला जाईल; यातील एक चित्र आपोआप (यादृच्छिक) निवडले जाईल.',
  refPickerEmpty:
    'एकही टेम्पलेट चित्र वापरात नाही. "मास्टर टेम्पलेट" पानावर चित्रे सुरू करा.',
  refPickerLoading: 'टेम्पलेट आणत आहोत…',
  refPickerPinnedTypeHint:
    'हा प्रकार व हेच चित्र वापरले जाईल; प्रकार आपोआप निवडला जाणार नाही.',

  // Transcription (/transcribe). A recording in, Marathi text out — nothing is generated,
  // rewritten or summarised here, which the intro says plainly so nobody expects an article.
  transcribeTitle: 'ध्वनिलेखन',
  transcribeIntro:
    'ध्वनिमुद्रण जोडा — त्याचा मराठी मजकूर याच पानावर मिळेल. मजकूर जसाच्या तसा उतरवला जातो; त्यात कोणताही बदल, सारांश किंवा भर घातली जात नाही. फाईल जतन केली जाते.',
  transcribeNewTitle: 'नवीन ध्वनिलेखन',
  transcribeUpload: 'ध्वनिफीत जोडा',
  transcribeHint:
    'एकावेळी अनेक फाईल जोडता येतील (कमाल १० फाईल्स, प्रत्येकी ५० MB). फक्त MP3, AAC व M4A चालतात.',
  transcribeFilesTitle: 'जोडलेली ध्वनिमुद्रणे',
  transcribeNeedFile: 'कृपया किमान एक ध्वनिमुद्रण जोडा.',
  transcribeSubmit: 'मजकूर तयार करा',
  transcribeRunning: 'मजकूर तयार होत आहे… मोठ्या ध्वनिमुद्रणाला काही मिनिटे लागू शकतात.',
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

  // Errors
  // Said at the picker, before the upload starts — the whole point of checking the size in
  // the browser. The number must match UPLOAD_FILE_MAX_MB (@dgipr/schemas), which is what the
  // API enforces.
  fileTooLargeError:
    'फाईल खूप मोठी आहे. प्रत्येक फाईल कमाल ५० MB असावी. कृपया लहान फाईल निवडा.',
  genericError: 'काहीतरी चुकले. कृपया पुन्हा प्रयत्न करा.',
  busyError: 'एक काम आधीच सुरू आहे. ते पूर्ण होईपर्यंत थांबा.',

  // Explainer videos (/video)
  navVideo: 'व्हिडिओ',
  videoTitle: 'नवीन व्हिडिओ तयार करा',
  videoIntro:
    'टिपणीवरून दोन स्वतंत्र गोष्टी तयार होतील: मराठी निवेदन आणि आवाज बंद असतानाही माहिती समजावणारी साधी दृश्य-कथा. आधी दोन्ही तपासा — व्हिडिओ तयार करण्याचा खर्च फक्त तुमच्या मंजुरीनंतरच होतो.',
  videoNoteLabel: 'टिपणी येथे लिहा किंवा चिकटवा',
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
  videoCreateHint: 'या टप्प्यावर व्हिडिओचा खर्च होत नाही.',
  videoEstimateApprox:
    'खर्च अंदाजे आहे — नक्की खर्च स्टोरीबोर्ड मंजुरीच्या वेळी दिसेल.',
  videoActiveBlocked:
    'दुसरा व्हिडिओ प्रकल्प सध्या तयार होत आहे. तो पूर्ण झाल्यावर नवीन सुरू करता येईल.',
  videoRecent: 'मागील व्हिडिओ',
  videoNoteTooShort: 'टिपणी किमान २० अक्षरांची हवी.',

  // Script gate (gate 1)
  videoScriptTitle: 'संहिता तपासा व संपादित करा',
  videoScriptIntro:
    'निवेदन आणि दृश्य-कथा स्वतंत्र आहेत; दृश्याने त्याच क्षणी ऐकू येणारे प्रत्येक वाक्य दाखवण्याची गरज नाही. प्रत्येक चित्रात एक hero subject, एक कृती आणि शांत पार्श्वभूमी आहे का ते पहा. गर्दी, रांग, अनेक वाहने किंवा अनेक कृती असतील तर दृश्य-वर्णन साधे करा.',
  videoSceneLabel: 'दृश्य',
  videoSceneBeatLabel: 'निवेदनाचा मुद्दा',
  videoNarrationLabel: 'निवेदन (मराठी)',
  videoNarrationHint:
    'जेवढे निवेदन लिहाल तेवढी या दृश्याची क्लिप लांब होते (३–१५ सेकंद). सर्व दृश्यांचे निवेदन मिळून निवडलेल्या एकूण वेळेत बसवा.',
  videoNarrationTooFast: 'निवेदन थोडे वेगाने वाजेल — हवे असल्यास लहान करा.',
  videoNarrationListen: 'निवेदनाचा आवाज ऐका',
  videoNarrationTotalOver:
    'निवेदन एकूण वेळेपेक्षा जास्त आहे — काही दृश्ये लहान करा, नाहीतर ती आपोआप लहान केली जातील.',
  videoBriefLabel: 'प्रारंभ दृश्य-वर्णन (इंग्रजी)',
  videoBriefHint:
    'वास्तव चित्रीकरणासारखी साधी फ्रेम: एक प्रमुख व्यक्ती/वस्तू (अत्यावश्यक असल्यास एकाच कृतीतील दोन व्यक्ती), एकच कृती, जास्तीत जास्त एक वाहन व २–३ महत्त्वाच्या वस्तू. गर्दी, रांग, traffic, अनेक कामे आणि busy background टाळा; चित्रात मजकूर/अक्षरे नसतील.',
  videoEndBriefLabel: 'अंतिम दृश्य-वर्णन (इंग्रजी)',
  videoEndBriefHint:
    'ऐच्छिक. त्याच जवळच्या फ्रेममध्ये, त्याच व्यक्ती व वस्तूंमध्ये एकच छोटा बदल शक्य असेल तर लिहा. नवीन व्यक्ती/वस्तू, प्रवेश-निर्गमन किंवा दुसरी कृती नको. रिकामे ठेवल्यास प्रारंभ फ्रेमवरूनच संयत हालचाल तयार होईल.',
  videoKeyPointLabel: 'पडद्यावरील ठळक ओळ (मराठी)',
  videoKeyPointHint:
    'या दृश्यावर दिसणारा एकच ठोस तपशील — रक्कम, मुदत, संख्या, योजनेचे नाव. रिकामी ठेवली तर या दृश्यावर काहीही लिहिले जाणार नाही.',
  videoKeyPointReviewLabel: 'पडद्यावरील ओळ',
  videoStyleLabel: 'दृश्यशैली व स्थळ (इंग्रजी — सर्व दृश्यांना लागू)',
  videoStyleHint:
    'सर्व दृश्ये याच वास्तव, live-action चित्रपट-शैलीत तयार होतात. महाराष्ट्र/भारत, नैसर्गिक प्रकाश, वास्तव भारतीय व्यक्ती व संयत documentary look स्पष्ट ठेवा. ही ओळ बदलली की सर्व दृश्ये पुन्हा काढावी लागतात.',
  videoAddScene: 'दृश्य जोडा',
  videoRemoveScene: 'हे दृश्य काढा',
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
  videoStillPending: 'चित्र अजून काढलेले नाही',
  videoSceneFailed: 'हे दृश्य अयशस्वी झाले',
} as const;

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
  retrieve: 'संदर्भ लेख शोधत आहोत…',
  extract_5w1h: 'माहितीचे विश्लेषण करत आहोत…',
  editorial_brief: 'संपादकीय आराखडा तयार करत आहोत…',
  draft: 'लेख लिहित आहोत…',
  coverage: 'लेखाची पूर्णता तपासत आहोत…',
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
  revise_article: 'अभिप्रायानुसार लेख सुधारत आहोत…',
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
};

// Short Marathi category labels for the history-card gradient banner (image-less
// cards). Distinct from the longer form labels (categoryScheme etc.).
export const CATEGORY_LABELS: Record<Category, string> = {
  scheme: 'योजना',
  news: 'बातमी',
  twitter: 'ट्विटर',
  facebook: 'फेसबुक',
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

// Gate-1 live hint under the narration textarea: the estimated spoken length
// AND the clip it will produce, since the clip is now derived from the speech —
// the officer's edit here is what decides how long this scene runs.
export function videoNarrationEstimate(
  seconds: number,
  clipSeconds?: number,
): string {
  const spoken = `अंदाजे ${seconds.toFixed(0)} से. बोलणे`;
  if (clipSeconds === undefined) return spoken;
  return `${spoken} → क्लिप ~${clipSeconds} से.`;
}

// Gate-1 running total against the project's selected length. Advisory only:
// the storyboard job measures the real audio and shortens what overruns.
export function videoNarrationTotal(
  estimatedSeconds: number,
  targetSeconds: number,
): string {
  return `एकूण निवेदन: अंदाजे ${estimatedSeconds.toFixed(0)} से. / लक्ष्य ${targetSeconds} से.`;
}
