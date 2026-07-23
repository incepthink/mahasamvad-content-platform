-- On-demand Hindi translation of the Marathi article (same Sarvam path as
-- article_english, with the glossary's Devanagari name forms locked verbatim).
-- Derived output, produced only when the user requests it; nullable, no default.
-- Independent of article_english — translating one never touches the other.
alter table generations
  add column if not exists article_hindi text;
