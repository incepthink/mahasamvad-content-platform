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
  navNew: 'नवीन मजकूर',
  navHistory: 'मागील काम',
  navTranslate: 'भाषांतर',
  navProofread: 'मुद्रितशोधन',
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
  categoryFacebook: 'फेसबुक पोस्ट',
  categoryFacebookDesc: 'फेसबुकसाठी मराठी पोस्टर + कॅप्शन',

  // Design-mode selector (shown only for the समाजमाध्यम — ट्विटर/फेसबुक — flows)
  designModeLabel: 'पोस्टरची रचना-शैली?',
  designOnbrand: 'ब्रँडनुसार',
  designOnbrandDesc: 'DGIPR ठरलेल्या टेम्पलेटनुसार पोस्टर',
  designAdaptive: 'अनुकूल',
  designAdaptiveDesc: 'टेम्पलेटचा आधार, पण विषयानुसार बदल',
  designFresh: 'नवीन',
  designFreshDesc: 'विषयानुसार पूर्णपणे नवे चित्र',

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
  // Review step: one card per source (notes / each recording / each document),
  // PDFs with page-wise selection.
  dloReviewNotesTitle: 'बैठकीतील टिपणी',
  dloReviewInclude: 'लेखात समाविष्ट करा',
  dloReviewExcluded: 'वगळले आहे',
  dloReviewKindAudio: 'ध्वनिमुद्रण',
  dloReviewKindPdf: 'PDF कागदपत्र',
  dloReviewKindDocx: 'DOCX कागदपत्र',
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
  dloGenerate: 'लेख तयार करा →',
  dloOutputTitle: 'तयार झालेला लेख',
  dloViewDetail: 'सविस्तर पाहा (अभिप्राय, भाषांतर, पोस्टर)',
  dloStartOver: 'पुन्हा सुरुवात करा',
  dloNewArticle: 'नवीन DLO लेख तयार करा',

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

  // PDF translation (/translate → PDF mode). The uploaded file and its मजकूर are held
  // only while the काम सुरू आहे — nothing is saved.
  translateModeText: 'मजकूर',
  translateModePdf: 'PDF फाईल',
  translateDocUploadTitle: 'PDF फाईल अपलोड करा',
  translateDocUploadHint:
    'लेख असलेली PDF निवडा (कमाल २५ MB). स्कॅन केलेली PDF देखील चालते. फाईल जतन केली जाणार नाही.',
  translateDocUpload: 'PDF निवडा',
  translateDocPdfOnly: 'कृपया फक्त .pdf फाईल निवडा.',
  translateDocTooLarge: 'फाईल २५ MB पेक्षा मोठी आहे.',
  translateDocExtracting: 'PDF मधील मजकूर वाचत आहोत…',
  translateDocExtractingHint:
    'PDF मध्येच मजकूर असेल तर हे काही सेकंदांत होते; स्कॅन केलेली फाईल OCR ने वाचावी लागते आणि त्यास काही मिनिटे लागतात. हे पान उघडे ठेवा.',
  // OCR runs one ≤10-page Sarvam job at a time, so long scans need a page counter rather
  // than a spinner that looks stuck.
  translateDocExtractProgress: 'OCR: पृष्ठ',
  translateDocGone: 'ही फाईल आता उपलब्ध नाही. कृपया PDF पुन्हा अपलोड करा.',
  // The pre-OCR selection step. Only reached for a SCANNED PDF: a document whose text can
  // be read directly costs nothing, so its pages are read at once and picked in the normal
  // review list. Here the text does not exist yet — showing it would mean running the very
  // OCR the user is being asked to approve — so the choice is by page number alone.
  translateDocSelectTitle: 'कोणती पृष्ठे वाचायची?',
  translateDocSelectHint:
    'ही स्कॅन केलेली PDF आहे, त्यामुळे प्रत्येक पृष्ठ OCR ने वाचावे लागेल. फक्त निवडलेलीच पृष्ठे वाचली जातील, म्हणून नको असलेली पृष्ठे आताच वगळा.',
  translateDocSelectTotal: 'एकूण पृष्ठे',
  translateDocSelectCount: 'पृष्ठे निवडली',
  translateDocReadSelected: 'निवडलेली पृष्ठे वाचा',
  translateDocChangeSelection: 'पृष्ठ निवड बदला',
  translateDocChangeSelectionHint:
    'वेगळी पृष्ठे निवडल्यास ती पुन्हा वाचावी लागतील, आणि सध्याचा मजकूर व भाषांतर पुन्हा तयार होईल.',
  translateDocPagesTitle: 'कोणती पृष्ठे भाषांतरित करायची?',
  translateDocPagesHint:
    'वाचलेला मजकूर तपासा. चूक असल्यास पृष्ठ उघडून दुरुस्त करा — भाषांतर याच मजकुरावर होईल.',
  // Which backend read the file. The text layer is exact; OCR guesses from pixels and can
  // misread names and आकडे, so the review matters more there.
  translateDocSourceTextLayer: 'मजकूर थेट PDF मधून घेतला',
  translateDocSourceOcr: 'मजकूर OCR ने वाचला',
  translateDocSourceTextLayerHint:
    'नावे आणि आकडे जसेच्या तसे आले आहेत. तरीही एकदा नजर टाका.',
  translateDocSourceOcrHint:
    'OCR मध्ये नावे आणि आकडे चुकू शकतात — भाषांतरापूर्वी तपासा.',
  translateDocReextract: 'मजकूर चुकीचा दिसतोय? OCR ने पुन्हा वाचा',
  translateDocReextractHint:
    'काही PDF मध्ये अक्षरे चुकीच्या क्रमाने साठवलेली असतात. OCR पानाचे चित्र वाचते, त्यामुळे असा मजकूर बरोबर येतो. यास काही मिनिटे लागतील आणि सध्याचा मजकूर व भाषांतर पुन्हा तयार होईल.',
  translateDocReextractYes: 'होय, OCR ने वाचा',
  translateDocReextractCancel: 'रद्द करा',
  translateDocPage: 'पृष्ठ',
  translateDocChars: 'अक्षरे',
  translateDocSelectAll: 'सर्व निवडा',
  translateDocClearAll: 'निवड काढा',
  translateDocEdit: 'मजकूर पाहा / दुरुस्त करा',
  translateDocEditClose: 'बंद करा',
  translateDocEdited: 'दुरुस्त केले',
  translateDocLangMr: 'मराठी',
  translateDocLangEn: 'English',
  translateDocSelectedSummary: 'पृष्ठे निवडली',
  translateDocNoSelection: 'किमान एक पृष्ठ निवडा.',
  translateDocEstimate: 'अंदाजे वेळ',
  translateDocMinutes: 'मिनिटे',
  translateDocInstructionLabel: 'AI सूचना (ऐच्छिक)',
  translateDocInstructionHint:
    'उदा. “फक्त पृष्ठ १ ते ९ भाषांतरित करा”, “शेवटची दोन पाने वगळा”. सूचनेवरून फक्त पृष्ठांची निवड ठरते — मजकूर बदलला जात नाही.',
  translateDocInstructionPlaceholder: 'फक्त पृष्ठ १ ते ९ भाषांतरित करा',
  translateDocInstructionApply: 'सूचना लागू करा',
  translateDocInstructionWorking: 'सूचना समजून घेत आहोत…',
  translateDocInstructionApplied: 'AI ने निवडलेली पृष्ठे:',
  translateDocInstructionUnclear:
    'सूचना समजली नाही. कृपया पृष्ठे स्वतः निवडा किंवा सूचना वेगळ्या शब्दांत लिहा.',
  translateDocTargetsLabel: 'कोणत्या भाषांमध्ये भाषांतर हवे?',
  translateDocTargetsHint: 'दोन्ही भाषा एकाच वेळी निवडता येतात.',
  translateDocNoTargets: 'किमान एक भाषा निवडा.',
  translateDocTranslating: 'भाषांतर सुरू आहे',
  translateDocTranslatingHint:
    'हे पान उघडे ठेवा. प्रत्येक पृष्ठाचे भाषांतर एकामागून एक होते.',
  translateDocResultsTitle: 'भाषांतर तयार आहे',
  translateDocPassthrough:
    'हे पृष्ठ मुळातच इंग्रजीत आहे — जसेच्या तसे ठेवले आहे.',
  translateDocDownload: 'संपूर्ण भाषांतर उतरवा (.txt)',
  translateDocCopyAll: 'संपूर्ण मजकूर कॉपी करा',
  translateDocRetranslate: 'पृष्ठे बदलून पुन्हा भाषांतर करा',
  translateDocNewFile: 'दुसरी PDF अपलोड करा',
  translateDocEnglishPagesNote:
    'या फाईलमधील काही पृष्ठे इंग्रजीत आहेत. इंग्रजी भाषांतरात ती जशीच्या तशी राहतील; हिंदीसाठी त्यांचे भाषांतर केले जाईल.',

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

  // Explainer videos (/video)
  navVideo: 'व्हिडिओ',
  videoTitle: 'माहिती समजावणारा व्हिडिओ तयार करा',
  videoIntro:
    'टिपणीवरून दृश्यनिहाय संहिता तयार होईल. आधी संहिता, मग प्रत्येक दृश्याचे नमुना चित्र तपासा — व्हिडिओ तयार करण्याचा खर्च फक्त तुमच्या मंजुरीनंतरच होतो.',
  videoNoteLabel: 'टिपणी येथे लिहा किंवा चिकटवा',
  videoHeadingLabel: 'शीर्षक / मुख्य मुद्दा (ऐच्छिक)',
  videoDurationLabel: 'लांबीची पसंती',
  videoDurationShort: 'लहान (~१५–३० सेकंद)',
  videoDurationShortHint: 'साधारण २–४ दृश्ये — AI टिपणीनुसार ठरवते',
  videoDurationLong: 'मध्यम (~३०–६० सेकंद)',
  videoDurationLongHint: 'साधारण ४–८ दृश्ये — AI टिपणीनुसार ठरवते',
  videoOrientationLabel: 'आकार',
  videoOrientationLandscape: 'आडवा (16:9)',
  videoOrientationLandscapeHint: 'YouTube, वेबसाईट',
  videoOrientationVertical: 'उभा (9:16)',
  videoOrientationVerticalHint: 'रील्स, स्टेटस, शॉर्ट्स',
  videoTierLabel: 'दर्जा',
  videoTierFast: 'संतुलित',
  videoTierFastHint: 'शिफारस केलेला — दर्जा व खर्चाचा समतोल',
  videoTierLite: 'हलका',
  videoTierLiteHint: 'सर्वात स्वस्त — चाचणीसाठी',
  videoTierStandard: 'सर्वोत्तम',
  videoTierStandardHint: 'सर्वोच्च दर्जा — सुमारे अडीचपट खर्च',
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
    'प्रत्येक दृश्याचे निवेदन (व्हिडिओत ऐकू येणारा मजकूर) आणि दृश्य-वर्णन तपासा. निवेदनातील नावे, आकडे व तारखा टिपणीशी जुळतात का ते पाहा.',
  videoSceneLabel: 'दृश्य',
  videoSceneBeatLabel: 'मुद्दा',
  videoNarrationLabel: 'निवेदन (मराठी)',
  videoNarrationHint:
    'क्लिपची लांबी निवेदनाच्या लांबीनुसार आपोआप ठरते (प्रति दृश्य ४–८ सेकंद).',
  videoNarrationTooFast: 'निवेदन थोडे वेगाने वाजेल — हवे असल्यास लहान करा.',
  videoNarrationListen: 'निवेदनाचा आवाज ऐका',
  videoBriefLabel: 'दृश्य-वर्णन (इंग्रजी)',
  videoBriefHint: 'चित्रात मजकूर/अक्षरे दिसणार नाहीत — शब्द निवेदनात असतात.',
  videoAddScene: 'दृश्य जोडा',
  videoRemoveScene: 'हे दृश्य काढा',
  videoToStoryboard: 'स्टोरीबोर्ड तयार करा',
  videoToStoryboardHint:
    'प्रत्येक दृश्याचे नमुना चित्र तयार होईल (अल्प खर्च, व्हिडिओ नाही).',

  // Storyboard gate (gate 2)
  videoStoryboardTitle: 'स्टोरीबोर्ड तपासा',
  videoStoryboardIntro:
    'ही चित्रे व्हिडिओतील दृश्यांची सुरुवात असतील. एखादे चित्र पटत नसेल तर वर्णन बदलून पुन्हा काढा — त्याचा खर्च अगदी थोडा आहे.',
  videoRedrawStill: 'चित्र पुन्हा काढा',
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

// Gate-1 live hint under the narration textarea: the estimated spoken length.
export function videoNarrationEstimate(seconds: number): string {
  return `अंदाजे ${seconds.toFixed(0)} से. बोलणे`;
}
