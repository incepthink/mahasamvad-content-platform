-- Whether the on-screen Marathi key points are burned into this project's
-- video. They used to be unconditional: every scene with a keyPoint got an
-- overlay, and the only way to turn one off was to blank that scene's line.
-- The officer now decides once per project, at gate 2 (storyboard), and the
-- default is OFF -- a caption is an addition to the footage, not a property of
-- it, so it is asked for rather than opted out of.
--
-- Persisted on the ROW rather than passed as a job option (the poster_heading
-- 0029 / instructions 0041 reasoning): the stitch runs again on a per-scene
-- re-animate and on the free restitch, neither of which carries the animate
-- request's body, so a request-only flag would silently revert to captions-off
-- the first time a finished video was touched.
--
-- Additive with a default, and every read goes through select() (= select '*'),
-- so an un-applied 0047 costs the toggle alone: buildCaptionOverlays reads
-- `captions_enabled ?? false` and the write is a SEPARATE best-effort update
-- ahead of the animate flip (the 0028 principle).

alter table video_projects
  add column if not exists captions_enabled boolean not null default false;
