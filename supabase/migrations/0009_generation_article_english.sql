-- On-demand English translation of the Marathi article (Sarvam + locked glossary).
-- Derived output, produced only when the user requests it; nullable, no default.
alter table generations
  add column if not exists article_english text;
