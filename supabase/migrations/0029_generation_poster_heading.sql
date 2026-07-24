-- The exact text the officer wants printed on an ARTICLE poster, typed by hand.
--
-- Why a column and not a job parameter (the generateCaption precedent): the heading must survive
-- a poster redo. startPosterRegenerateJob re-derives everything from the row, so a heading held
-- only in the create request would be silently lost the first time someone pressed
-- "वेगळ्या रंगात तयार करा" and the poster would revert to the automatic subject/editorial text.
--
-- Why not `generations.heading`: that is the article's editorial ANGLE, already surfaced in the
-- detail page's edit-and-re-run fold and carried across cross-format runs. An angle
-- ("शेतकऱ्यांच्या दृष्टिकोनातून लिहा") is not poster text, and overloading it would put that
-- sentence on a poster.
--
-- When set, it wins outright: it becomes the poster's headline with the TEXT LOCK block that
-- reproduces it character for character, and the automatic named-subject model call is skipped.
-- Empty/null = today's behaviour (resolve the named subject, else the editorial headline).
--
-- Additive + nullable, but written at INSERT time — apply BEFORE deploying the API.
alter table generations
  add column if not exists poster_heading text;
