-- 0056: the pictures an officer attaches to a run for the IMAGE MODEL to see.
--
-- Every poster lane on the create form has been made of TEXT alone: the officer types or
-- pastes a note and the image model designs from words. That is fine until the run is about
-- a specific thing — this building, this person, this look — which no paragraph pins down.
-- So the form now takes images beside the note, they are uploaded before the run is
-- submitted, and this column holds the storage paths of the ones that came with it.
--
-- ONE additive nullable jsonb column holding an array of storage PATHS in the public posters
-- bucket, each under PROMPT_IMAGE_PREFIX ('generations/prompt-images/'). Paths rather than
-- URLs because the create route checks every one of them against that prefix before a paid
-- render is pointed at it — the rule source_image_path (0052) already follows, and the reason
-- a browser cannot name an arbitrary object here.
--
-- NAMED prompt_image_paths, matching video_projects.prompt_image_paths (0051), which is the
-- same idea on the /video lane. Deliberately NOT called reference_images: that name is taken
-- on this table by reference_image_id, which pins a MASTER TEMPLATE out of the library and
-- decides a poster's structure. These decide nothing — they are the officer's own pictures,
-- shown to the model and nothing more.
--
-- It lives on the row rather than travelling as a job parameter for the reason
-- style_reference (0035), image_prompt (0045) and source_image_path (0052) do: the retry path
-- and "पुन्हा तयार करा" both rebuild the job by RE-READING the row, so pictures held only in
-- the create request would be silently dropped on the officer's first redo — and the poster
-- would come back without the building it was about, with nothing on screen saying why.
--
-- insertGeneration omits the column unless pictures were actually attached, so an un-applied
-- 0056 costs exactly one thing: a create that carries some. Every other create, on every
-- lane, still succeeds — PostgREST refuses an insert that NAMES a column which does not
-- exist. Apply before the API deploy anyway.
alter table generations
  add column if not exists prompt_image_paths jsonb;

comment on column generations.prompt_image_paths is
  'Pictures the officer attached to this run for the image model to see, as an array of storage paths in the public posters bucket under generations/prompt-images/. Not the reference-template library (see reference_image_id) — these shape no layout, they are simply shown to the model. Null/absent = the run saw no pictures.';
