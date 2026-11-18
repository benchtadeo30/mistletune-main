// First decoder step predicts a language token, entirely on device.
export async function detectWhisperLanguage(model, waveform, tokenizer) {
  const vocabulary = { ...tokenizer.model.vocab };
  for (const token of tokenizer.added_tokens) vocabulary[token.content] = token.id;
  const start = vocabulary['<|startoftranscript|>'];
  const languages = Object.entries(vocabulary).filter(([token]) => /^<\|[a-z]{2,3}\|>$/.test(token));
  if (!Number.isInteger(start) || !languages.length) throw new Error('The bundled tokenizer has no language tokens.');
  const encoded = await model.encode(waveform);
  // The shipped native decoder consumes uint64_t tokens despite its TS
  // declaration saying Int32Array. Supply one aligned 64-bit slot (length 1).
  const tokens = new Float64Array(1);
  new DataView(tokens.buffer).setUint32(0, start, true);
  const logits = await model.decode(tokens, encoded);
  let language;
  let score = -Infinity;
  for (const [token, id] of languages) {
    if (Number.isFinite(logits[id]) && logits[id] > score) { score = logits[id]; language = token.slice(2, -2); }
  }
  if (!language) throw new Error('Whisper could not identify the song language.');
  return language;
}
