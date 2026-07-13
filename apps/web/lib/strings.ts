// Every Marathi UI string in one place (no i18n library — the UI is Marathi-first
// with small English hints). Keep wording plain and free of technical jargon:
// the users are non-technical government communication staff.

import type {
  Category,
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
  navMenu: 'मेनू',
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

  // Standalone Marathi-to-English translation
  translatePageTitle: 'भाषांतर (Translation)',
  translateInputLabel: 'मराठी मजकूर येथे लिहा किंवा चिकटवा',
  translateInputHint:
    'या मजकुराचे थेट इंग्रजी भाषांतर केले जाईल. हा मजकूर जतन केला जाणार नाही.',
  translateInputPlaceholder: 'भाषांतरासाठी मराठी मजकूर येथे लिहा…',
  translateMineTerms: 'या मजकुरातून नवीन नाव-शब्दकोश संज्ञा शोधा',
  translateAction: 'भाषांतर करा',
  translateMayTakeTime: 'मोठ्या मजकुराला एक-दोन मिनिटे लागू शकतात.',
  translateOverLimit: 'मजकूर १०,००० अक्षरांपेक्षा जास्त आहे.',
  translateOutputTitle: 'इंग्रजी भाषांतर',
  translateLockedTerms: 'शब्दकोश संज्ञा वापरल्या',
  translateMinedTerms: 'नवीन संज्ञा तपासणीसाठी जोडल्या',

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
  feedbackPlaceholder: 'येथे आपला अभिप्राय लिहा…',
  sendFeedback: 'बदल करा',
  sendingFeedback: 'पाठवत आहोत…',
  feedbackTooShort: 'कृपया थोडक्यात अभिप्राय लिहा.',

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
  refPickerTypeSelect: 'संपूर्ण प्रकार निवडा',
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

// The estimated USD cost of a run, for the small cost badge. Null (pre-feature rows or a
// run that hasn't recorded cost yet) shows an em dash.
export function formatCost(usd: number | null): string {
  if (usd === null || Number.isNaN(usd)) return '—';
  return `$${usd.toFixed(2)}`;
}
