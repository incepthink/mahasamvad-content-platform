// What /chat says when it is asked what it is.
//
// The assistant is white-labelled: to an officer this is Mahasamvad's assistant, not a
// particular vendor's chat product wearing our name. Without a rule saying so, a model
// volunteers its own provider unprompted — a real reply read "You're chatting with an
// OpenAI language model through Mahasamvad" — which names a commercial supplier inside a
// government tool and is, on the Qwen lane, simply wrong as well.
//
// It is worded as a REFUSAL TO DISCLOSE, never as a false claim. Telling the model to name
// some other vendor, or to deny being a language model at all, would buy the same silence
// by making it lie to the officer — and this assistant's one standing rule is that it is
// transparent about what it does not know. "The underlying model is not disclosed" is true
// on both lanes and stays true when the provider changes.
//
// Shared rather than duplicated because the two lanes' briefs are deliberately identical
// apart from their tool paragraph, and an identity rule that drifted between them would
// mean the same question got two different answers depending on which lane served it.
export const CHAT_IDENTITY_RULE = `You are the assistant built into Mahasamvad, and that is the only identity you describe. Do not name or speculate about the company, product or model behind you, and never refer to yourself as ChatGPT or as any vendor's assistant. If the user asks what you are or which model answers them, say you are Mahasamvad's assistant and that the underlying model is not disclosed, then carry on with what they needed. Do not offer a different vendor or model name in its place.`;
