-- AI explainer-video projects (apps/web/app/video): a user note becomes a
-- per-scene Marathi narration script (gate 1: reviewed/edited), cheap storyboard
-- keyframe stills (gate 2: approved), and only then Veo-animated clips stitched
-- into one silent MP4 + SRT. Own table rather than generations: the shape is
-- scene-centric and the status flow has two user gates in the middle.
-- Same access pattern as generations/dlo_intakes: no auth this phase,
-- service-role only.

create table if not exists video_projects (
  id              uuid primary key default gen_random_uuid(),
  -- Two idle user-gate statuses (script_ready, storyboard_ready) sit between the
  -- three working ones; routes flip INTO working statuses before their 202.
  status          text not null default 'scripting'
                  check (status in ('scripting', 'script_ready', 'storyboarding',
                                    'storyboard_ready', 'animating', 'completed',
                                    'failed')),
  -- Machine step key refining the working statuses (script|stills|animate|stitch|upload|done);
  -- the UI maps it to Marathi labels.
  step            text,
  error           text,
  note            text not null,
  heading         text,
  -- short = ~15-30s (2-4 scenes), long = ~30-60s (4-8 scenes); each scene is one
  -- Veo clip (default 8s).
  duration_bucket text not null default 'short'
                  check (duration_bucket in ('short', 'long')),
  orientation     text not null default 'landscape'
                  check (orientation in ('landscape', 'vertical')),
  -- Veo quality tier; per-second pricing lives in @dgipr/schemas.
  tier            text not null default 'fast'
                  check (tier in ('fast', 'lite', 'standard')),
  -- Per-scene state: [{ narration, visualBrief, durationSeconds, status,
  --   stillPath/stillVersion, clipPath/clipVersion/clipStillVersion, error }]
  -- jsonb on purpose (dlo_intakes precedent): scene-shape evolution needs no
  -- migrations, and a scene's clip is persisted the moment its Veo render lands
  -- so a crashed animate job resumes instead of re-billing finished clips.
  scenes          jsonb not null default '[]'::jsonb,
  title           text,
  -- One English style paragraph declared per project and embedded verbatim in every
  -- keyframe + Veo prompt — the v1 cross-scene visual-consistency mechanism.
  style           text,
  reference_title text,
  reference_url   text,
  video_path      text,
  srt_path        text,
  -- Bumped on every successful stitch; versioned storage paths are never reused
  -- (public bucket is CDN-cached).
  video_version   integer not null default 0,
  cost_usd        numeric(10, 4),
  cost_breakdown  jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists video_projects_created_at_idx
  on video_projects (created_at desc);

-- No public policies: RLS on keeps the anon key out; the service-role key bypasses it.
alter table video_projects enable row level security;

-- PUBLIC bucket like 'posters': final MP4s/SRTs/stills/clips are served directly
-- to the browser. Paths are versioned per render and never reused (CDN-cached):
-- projects/{id}/scene-{i}-still-v{n}.png, scene-{i}-clip-v{n}.mp4,
-- video-v{n}.mp4, subtitles-v{n}.srt.
insert into storage.buckets (id, name, public)
values ('videos', 'videos', true)
on conflict (id) do nothing;
