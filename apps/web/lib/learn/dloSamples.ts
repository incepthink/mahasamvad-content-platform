// The DLO lesson's articles, written ONCE by the real article engine and kept here — the
// lesson never shows a result the product did not make (see ./dloSandbox.ts).
//
// Produced on 2026-10-01 by packages/content-engine/src/scripts/learn-dlo-samples.ts from
// SAMPLE_NOTE:
//   v1     the /dlo draft call exactly as the runner makes it — generateArticleSimple with the
//          dlo prompt (dlo-rag-v6, OpenAI gpt-5.6-sol, three retrieved Mahasamvad
//          style references), category बातमी.
//   short  the article-feedback revision (reviseArticle, as the feedback job calls it) for the
//          article view's own quick suggestion «आणखी थोडक्यात लिहा».
//
// Copied verbatim, including what the product does that a lesson might wish it did not: the
// revision carries a dateline and no headline, because the revision path rewrites the article
// without one. Regenerate with the script rather than editing these by hand.

import type { ArticleFile } from './dloSandbox';

export const DLO_SAMPLE_ARTICLES: Readonly<Record<ArticleFile, string>> = {
  v1: `### *उर्वरित १४ अपघातप्रवण ठिकाणांची कामे ३१ डिसेंबरपर्यंत पूर्ण करा – जिल्हाधिकारी*

## *रस्ता सुरक्षेच्या उपाययोजनांना गती देण्याचे निर्देश*

### *आनंदपूर जिल्हा रस्ता सुरक्षा समितीची आढावा बैठक*

जिल्ह्यातील उर्वरित १४ अपघातप्रवण ठिकाणांवरील दुरुस्तीची कामे ३१ डिसेंबरपर्यंत पूर्ण करावीत. तसेच शाळा व महाविद्यालयांजवळ वेगमर्यादेचे फलक आणि गतिरोधक बसवावेत, असे निर्देश जिल्हाधिकाऱ्यांनी दिले.

जिल्हाधिकारी कार्यालय, आनंदपूर येथे ८ ऑक्टोबर रोजी जिल्हा रस्ता सुरक्षा समितीची आढावा बैठक झाली. जिल्ह्यात गेल्या वर्षभरात ४२ अपघातप्रवण ठिकाणे निश्चित केली असून, त्यापैकी २८ ठिकाणांवरील दुरुस्तीची कामे पूर्ण झाली आहेत.

हेल्मेट आणि सीटबेल्टच्या वापराबाबत नागरिकांमध्ये जागृती करण्यासाठी १५ ते ३० ऑक्टोबरदरम्यान जिल्हाभर जनजागृती मोहीम राबविण्याचे निर्देशही जिल्हाधिकाऱ्यांनी दिले.

अपघातग्रस्तांना तातडीने रुग्णालयात पोहोचविणाऱ्या नागरिकांचा प्रशस्तिपत्र देऊन सन्मान करण्याचा निर्णय समितीने घेतला. अपघात झाल्यास नागरिकांनी ११२ या क्रमांकावर संपर्क साधावा.

०००००`,
  short: `आनंदपूर, दि. ८ : जिल्ह्यातील उर्वरित १४ अपघातप्रवण ठिकाणांवरील दुरुस्तीची कामे ३१ डिसेंबरपर्यंत पूर्ण करण्याचे निर्देश जिल्हाधिकाऱ्यांनी जिल्हा रस्ता सुरक्षा समितीच्या आढावा बैठकीत दिले.

जिल्ह्यात गेल्या वर्षभरात ४२ अपघातप्रवण ठिकाणे निश्चित करण्यात आली असून, त्यापैकी २८ ठिकाणांवरील दुरुस्तीची कामे पूर्ण झाली आहेत. शाळा व महाविद्यालयांजवळ वेगमर्यादेचे फलक तसेच गतिरोधक बसविण्याच्या सूचनाही देण्यात आल्या आहेत.

हेल्मेट व सीटबेल्ट वापराबाबत १५ ते ३० ऑक्टोबरदरम्यान जिल्हाभर जनजागृती मोहीम राबविण्यात येणार आहे. अपघातग्रस्तांना तातडीने रुग्णालयात पोहोचविणाऱ्या नागरिकांचा प्रशस्तिपत्र देऊन सन्मान करण्यात येईल. अपघात झाल्यास नागरिकांनी ११२ या क्रमांकावर संपर्क साधावा, असे आवाहन करण्यात आले आहे.`,
};
