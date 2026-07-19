// Every Marathi UI string in one place (no i18n library — the UI is Marathi-first
// with small English hints). Keep wording plain and free of technical jargon:
// the users are non-technical government communication staff.

import type {
  Category,
  DloIntakeStep,
  GenerationStep,
  GenerationStatus,
  ReferenceCategory,
  TermType,
} from '@dgipr/schemas';

export const STR = {
  appName: 'महासंवाद मजकूर मंच',
  appSubtitle: 'माहिती व जनसंपर्क महासंचालनालय, महाराष्ट्र शासन',
  navNew: 'नवीन मजकूर',
  navHistory: 'मागील काम',
  navTranslate: 'भाषांतर',
  navGlossary: 'शब्दकोश',
  navReferences: 'मास्टर टेम्पलेट',
  navDlo: 'DLO लेख',
  navMenu: 'मेनू',
  navCollapse: 'मेनू लहान करा',
  navExpand: 'मेनू मोठा करा',
  poweredBy: 'Powered by',

  // New-generation form
  newTitle: 'नवीन लेख / पोस्टर तयार करा',
  noteLabel: 'टिपणी येथे लिहा किंवा चिकटवा',
  noteHint: 'Paste your official note (टिपणी) here',
  notePlaceholder:
    'उदा. शासन निर्णय, बैठकीची टिपणी, योजनेची माहिती… ही टिपणीच लेखाचा एकमेव आधार असेल.',
  uploadTxt: 'किंवा .txt फाईल निवडा',
  headingLabel: 'शीर्षक किंवा लेखाचा रोख (ऐच्छिक)',
  headingHint:
    'शीर्षक द्या, किंवा लेखाचा रोख थोडक्यात सांगा — रिकामे ठेवल्यास मंच स्वतः रोख ठरवेल.',
  headingPlaceholder: 'उदा. कर्जमुक्तीमुळे ग्रामीण अर्थव्यवस्थेला नवी ऊर्जा',
  categoryLabel: 'लेखाचा प्रकार?',
  categoryScheme: 'योजना-लेख',
  categorySchemeDesc: 'सविस्तर, चिंतनशील महासंवाद फीचर-लेख',
  categoryNews: 'बातमी',
  categoryNewsDesc: 'नेमकी, वस्तुनिष्ठ बातमी (dateline शैली)',
  categoryTwitter: 'ट्विटर पोस्ट',
  categoryTwitterDesc: 'X (ट्विटर) साठी मराठी पोस्टर + कॅप्शन',

  // Design-mode selector (shown only for the ट्विटर पोस्ट flow)
  designModeLabel: 'पोस्टरची रचना-शैली?',
  designOnbrand: 'ब्रँडनुसार',
  designOnbrandDesc: 'DGIPR ठरलेल्या टेम्पलेटनुसार पोस्टर',
  designAdaptive: 'अनुकूल',
  designAdaptiveDesc: 'टेम्पलेटचा आधार, पण विषयानुसार बदल',
  designFresh: 'नवीन',
  designFreshDesc: 'विषयानुसार पूर्णपणे नवे चित्र',

  // Shown on the ट्विटर पोस्ट card while one such task is already running
  twitterBusyInfo:
    'एक ट्विटर पोस्ट सध्या तयार होत आहे. ती पूर्ण झाल्यावर नवीन सुरू करता येईल.',

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
  noteTooShort: 'कृपया किमान २० अक्षरांची टिपणी लिहा.',
  txtOnly: 'कृपया फक्त .txt फाईल निवडा.',

  // DLO (Digital Liaison Officer) interface — meeting notes + recordings +
  // documents → transcription/extraction → editable review → article.
  dloTitle: 'DLO — बैठकीतून लेख',
  dloIntro:
    'बैठकीतील टिपणी, ध्वनिमुद्रण (MP3) आणि कागदपत्रे (PDF/DOCX) येथे द्या — या सर्व माहितीतून लेख तयार होईल.',
  dloStepInput: 'माहिती द्या',
  dloStepProcessing: 'प्रक्रिया',
  dloStepReview: 'तपासणी व संपादन',
  dloStepOutput: 'तयार लेख',
  dloNotesLabel: 'बैठकीतील टिपणी येथे लिहा',
  dloNotesHint:
    'बैठकीत जे ऐकले, ठरले किंवा आठवते ते सर्व येथे लिहा — मुद्दे, निर्णय, घोषणा, आकडेवारी.',
  dloNotesPlaceholder:
    'उदा. आजच्या बैठकीत मा. मंत्री महोदयांनी… असे जाहीर केले; योजनेसाठी … कोटी रुपयांची तरतूद…',
  dloUpload: 'फाईल जोडा (PDF / MP3 / DOCX)',
  dloUploadHint:
    'बैठकीचे ध्वनिमुद्रण (.mp3) आणि कागदपत्रे (.pdf, .docx) — एकावेळी अनेक फाईल जोडता येतील.',
  dloFilesTitle: 'जोडलेल्या फाईल',
  dloRemoveFile: 'फाईल काढा',
  dloFileTypeError: 'कृपया फक्त .pdf, .mp3 किंवा .docx फाईल निवडा.',
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
  dloReviewTooLong: 'मजकूर ६०,००० अक्षरांपेक्षा जास्त आहे — कृपया कमी करा.',
  dloGenerate: 'लेख तयार करा →',
  dloOutputTitle: 'तयार झालेला लेख',
  dloViewDetail: 'सविस्तर पाहा (अभिप्राय, भाषांतर, पोस्टर)',
  dloStartOver: 'पुन्हा सुरुवात करा',
  dloNewArticle: 'नवीन DLO लेख तयार करा',

  // Standalone Marathi-to-English translation
  translatePageTitle: 'भाषांतर (Translation)',
  translateInputLabel: 'मराठी मजकूर येथे लिहा किंवा चिकटवा',
  translateInputHint:
    'या मजकुराचे थेट इंग्रजी भाषांतर केले जाईल. हा मजकूर जतन केला जाणार नाही.',
  translateInputPlaceholder: 'भाषांतरासाठी मराठी मजकूर येथे लिहा…',
  translateAction: 'भाषांतर करा',
  translateMayTakeTime: 'मोठ्या मजकुराला एक-दोन मिनिटे लागू शकतात.',
  translateOverLimit: 'मजकूर १०,००० अक्षरांपेक्षा जास्त आहे.',
  translateOutputTitle: 'इंग्रजी भाषांतर',
  translateLockedTerms: 'शब्दकोश संज्ञा वापरल्या',

  // Pre-translation name check (shown before every translation; the confirmed
  // spellings are locked into the English output and saved to the नाव-शब्दकोश)
  namesChecking: 'मजकुरातील नावे शोधत आहोत…',
  namesReviewTitle: 'नावांची इंग्रजी स्पेलिंग तपासा',
  namesReviewHint:
    'खालील नावे इंग्रजी भाषांतरात अगदी अशीच वापरली जातील. चुकीची स्पेलिंग दुरुस्त करा; एखादे नाव राहिले असेल तर ते खाली जोडा.',
  namesReviewEmpty:
    'या मजकुरात एकही नाव सापडले नाही. आवश्यक असल्यास खाली नाव जोडा.',
  namesAddName: '+ आणखी नाव जोडा',
  namesAddMarathiPlaceholder: 'उदा. संवाद वारी',
  namesAddEnglishPlaceholder: 'उदा. Samvad Wari',
  namesConfirmTranslate: 'भाषांतर सुरू करा',
  namesCancel: 'रद्द करा',
  namesPrepareError: 'नावे शोधता आली नाहीत. कृपया पुन्हा प्रयत्न करा.',
  namesStartCheck: 'नावे तपासा',
  retranslateFold: 'नावे सुधारून पुन्हा भाषांतर करा',

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
  translateToEnglish: 'इंग्रजीत भाषांतर करा',
  showMarathi: 'मराठी',
  showEnglish: 'English',
  translating: 'भाषांतर सुरू आहे…',
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
  sourceArticleDesc: 'या कामात तयार झालेला लेख पोस्टसाठी आधार म्हणून वापरला जाईल.',
  sourceNote: 'मूळ टिपणी',
  sourceNoteDesc: 'तुम्ही दिलेली मूळ टिपणी वापरली जाईल.',
  nextTwitterCta: 'ट्विटर पोस्ट तयार करा',
  nextTwitterStarted:
    'ट्विटर पोस्ट तयार होत आहे — प्रगती वरील "सुरू असलेली कामे" मध्ये पाहा.',
  nextArticleTitle: 'याच टिपणीवरून लेख तयार करा',
  nextArticleHint:
    'हीच टिपणी वापरून महासंवाद शैलीतील लेख (हवे असल्यास पोस्टरसह) तयार होईल.',
  nextArticleCta: 'लेख तयार करा',
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

  // Glossary (नाव-शब्दकोश) admin/review page
  glossaryTitle: 'नाव-शब्दकोश (मराठी → इंग्रजी)',
  glossaryIntro:
    'भाषांतरात नावे, पदनाम, ठिकाणे व योजना बरोबर यावीत यासाठीचा शब्दकोश. फक्त “तपासलेली” नोंद भाषांतरात जशीच्या तशी वापरली जाते. प्रत्येक भाषांतरातून नवीन नावे आपोआप येथे येतात — ती तपासा किंवा दुरुस्त करा.',
  glossaryAddTitle: 'नवीन नाव जोडा',
  glossaryMarathi: 'मराठी',
  glossaryEnglish: 'इंग्रजी',
  glossaryType: 'प्रकार',
  glossaryNotes: 'टीप',
  glossaryAdd: 'जोडा',
  glossaryAdding: 'जोडत आहोत…',
  glossarySave: 'जतन करा',
  glossarySaving: 'जतन करत आहोत…',
  glossarySaved: 'जतन झाले ✓',
  glossaryDelete: 'काढा',
  glossaryDeleteConfirm: 'हे नाव कायमचे काढायचे?',
  glossaryVerify: 'तपासले म्हणून खूण करा',
  glossaryUnverify: 'खूण काढा',
  glossaryVerified: 'तपासले',
  glossaryUnverified: 'तपासायचे आहे',
  glossarySearchPlaceholder: 'नाव शोधा…',
  glossaryFilterAllTypes: 'सर्व प्रकार',
  glossaryUnverifiedOnly: 'फक्त तपासायची',
  glossaryEmpty: 'अजून एकही नाव नाही.',
  glossaryMarathiPlaceholder: 'उदा. जिल्हाधिकारी',
  glossaryEnglishPlaceholder: 'उदा. District Collector',
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

  // Errors
  genericError: 'काहीतरी चुकले. कृपया पुन्हा प्रयत्न करा.',
  busyError: 'एक काम आधीच सुरू आहे. ते पूर्ण होईपर्यंत थांबा.',
} as const;

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
  classify: 'विषय ओळखत आहोत…',
  copy: 'पोस्टरचा मजकूर तयार करत आहोत…',
  image: 'पोस्टरचे चित्र तयार करत आहोत…',
  caption: 'ट्विटर कॅप्शन लिहित आहोत…',
  scene: 'पोस्टरचे चित्र तयार करत आहोत…',
  render: 'पोस्टर जुळवत आहोत…',
  revise_article: 'अभिप्रायानुसार लेख सुधारत आहोत…',
  revise_copy: 'अभिप्रायानुसार मजकूर सुधारत आहोत…',
  revise_scene: 'नवीन चित्र तयार करत आहोत…',
  revise_image: 'चित्र पुन्हा तयार करत आहोत…',
  translate: 'इंग्रजी भाषांतर',
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
