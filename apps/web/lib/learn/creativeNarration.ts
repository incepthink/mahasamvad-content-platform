// What the voice says in /learn/creative's autoplay mode, one clip per key.
//
// These are SPOKEN lines, written to be heard rather than read: no «» quotes or symbols the
// voice would read out, "एआय" rather than "AI", and a little more of the "why" than the
// callout has room for. The on-screen instructions (LEARN in lib/strings.ts) do not change.
//
// The audio is generated once and committed (public/learn/creative/audio/), by
//   pnpm --filter @dgipr/content-engine learn:narrate
// which reads THIS file. That is why it imports nothing: the generator loads it from
// content-engine with tsx, outside the web app's module graph. Change a line here, re-run the
// generator; the free harness (creative.check.ts) fails while any clip is stale.

export const NARRATION_KEYS = [
  'text',
  'verbatim',
  'caption',
  'submit',
  'creating',
  'mark-mode',
  'mark-headline',
  'describe',
  'send',
  'editing',
  'compare',
  'redo',
  'download',
  'finish',
] as const;

export type NarrationKey = (typeof NARRATION_KEYS)[number];

export const CREATIVE_NARRATION: Record<NarrationKey, string> = {
  text: 'नमस्कार! या सरावात आपण क्रिएटिव्ह पोस्टर कसे तयार करायचे आणि त्यात बदल कसा करायचा ते पाहू. सुरुवातीला, वरच्या पेटीत पोस्टरसाठीचा मजकूर लिहायचा किंवा चिकटवायचा असतो. या सरावासाठी आपण तयार नमुना मजकूर वापरू.',
  verbatim:
    'मजकुराखाली दोन पर्याय आहेत. पहिला आहे, जसाच्या तसा मजकूर. हा टिक केल्यास तुम्ही लिहिलेला मजकूर पोस्टरवर जसाच्या तसा छापला जातो. टिक नसेल, तर एआय तुमच्या मजकुरातून पोस्टरसाठी योग्य मजकूर लिहिते. या सरावात आपण हा पर्याय टिक करणार नाही.',
  caption:
    'दुसरा पर्याय आहे, कॅप्शनही तयार करा. हा टिक केल्यास पोस्टरसोबत सोशल मीडियासाठी कॅप्शनही लिहिले जाते. कॅप्शन नंतरही तयार करता येते, म्हणून हाही पर्याय आत्ता टिक करणार नाही.',
  submit:
    'आता तयार करा हे बटण दाबू. त्यानंतर पोस्टर तयार होण्यास सुरुवात होते.',
  creating:
    'पोस्टर तयार होत आहे. खऱ्या कामात याला साधारण एक ते दोन मिनिटे लागतात. सरावात ते काही सेकंदांतच होईल.',
  'mark-mode':
    'पोस्टर तयार झाले! समजा, आपल्याला शीर्षक आणखी मोठे हवे आहे. पोस्टरमध्ये कुठे बदल हवा ते दाखवण्यासाठी आधी खूण करावी लागते. त्यासाठी पोस्टरखालील पेन्सिलचे बटण वापरा.',
  'mark-headline':
    'आता ज्या भागात बदल हवा आहे, म्हणजे शीर्षकावर, क्लिक करा किंवा त्याभोवती चौकट ओढा. तिथे क्रमांक असलेली लाल खूण दिसेल.',
  describe:
    'खुणेशेजारी एक पेटी येते. त्या भागात काय बदल हवा ते साध्या शब्दांत लिहा. उदाहरणार्थ, शीर्षक आणखी मोठे व ठळक करा.',
  send: 'बदल लिहून झाला. आता बदल करा हे बटण दाबा. तुम्ही सांगितलेला बदल पोस्टरमध्ये केला जाईल.',
  editing: 'बदल होत आहे. खऱ्या कामात यालाही साधारण एक मिनिट लागतो.',
  compare:
    'नवीन आवृत्ती तयार झाली. पोस्टरखाली आवृत्त्या दिसतात. प्रत्येक बदलाची स्वतंत्र आवृत्ती राहते, त्यामुळे मूळ पोस्टर कधीही परत पाहता येते. काहीही हरवत नाही.',
  redo: 'हे पुन्हा तयार करा बटण आहे. पोस्टर आवडले नाही, तर हे दाबा. त्याच मजकुरावरून वेगळ्या रचनेचे नवीन पोस्टर तयार होते, आणि जुने पोस्टर आवृत्त्यांमध्ये राहते.',
  download:
    'आणि हे डाउनलोड बटण आहे. यातून लोगो आणि तळपट्टीसह पूर्ण पोस्टर डाउनलोड करता येते.',
  finish:
    'छान! तुम्ही क्रिएटिव्हचा पूर्ण सराव केलात. आता तुम्ही स्वतःच्या मजकुरावरून खरे काम सुरू करू शकता.',
};

// Clips that describe a WAIT. They play to the end even when the wait is over first (the
// sandbox finishes in a few seconds), because cutting "this takes a minute in real work" off
// mid-sentence is worse than a short pause. Every other clip stops the moment its step is
// done, so a learner who acts first is never talked over.
export const WAIT_CLIPS: ReadonlySet<NarrationKey> = new Set([
  'creating',
  'editing',
]);

// Which clip belongs to a step. The two steps that also cover a wait (the poster being made,
// the edit being made) have a clip for each half.
export function narrationKey(
  stepId: string,
  facts: Readonly<{ creating: boolean; editing: boolean }>,
): NarrationKey | null {
  if (stepId === 'submit' && facts.creating) return 'creating';
  if (stepId === 'send' && facts.editing) return 'editing';
  return (NARRATION_KEYS as readonly string[]).includes(stepId)
    ? (stepId as NarrationKey)
    : null;
}

// Roughly how long a line runs when it has no clip yet (eleven_v3 reads Marathi at ~11
// chars/s, measured for /video). Used only until the audio is generated, and while muted.
export function estimatedSeconds(text: string): number {
  return Math.max(2, text.length / 11);
}
