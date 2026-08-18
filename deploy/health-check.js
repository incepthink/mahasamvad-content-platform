'use strict';
// Stuck-job + recent-failure report for the DGIPR platform.
//
// WHY THIS EXISTS
// ---------------
// Nothing on this platform tells anyone when a run breaks. The container logs are the
// wrong place to look for it, twice over: a job failure or an upload rejection is a
// HANDLED reply, so it never reaches Fastify's error handler and never logs at
// "level":50 -- and `docker compose up -d api` destroys the log history on every deploy.
//
// The durable record is the DATABASE. Every long-running job persists its own outcome
// (status/step/error) on its row, precisely so a polling client survives a refresh; that
// design makes the same rows a permanent, queryable failure log. This script reads them.
//
// It reports two things, and the SECOND is the one nothing else can see:
//
//   FAILED  -- a run that ended badly. Already visible to the officer in the UI, but
//              nobody sees the aggregate, so a systemic break (an expired API key, an
//              un-applied migration) looks like scattered bad luck.
//   STUCK   -- a run still claiming to be queued/running long after it should have
//              finished. This is INVISIBLE EVERYWHERE ELSE: a wedged job never sets
//              `failed`, so it is absent from the UI's error state, absent from
//              /analytics, and absent from the logs. The officer just watches a spinner.
//
// Staleness is measured on `updated_at`, not `created_at`, because every patch through
// packages/database stamps it -- so a long job that is genuinely progressing keeps
// refreshing it and a wedged one does not. A 40-minute video render is not "stuck"; a
// 40-minute silence is.
//
// It talks to PostgREST directly rather than importing @dgipr/database: this runs inside
// the api container (see health-check.sh), so SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// are already in the environment, and a dependency-free script cannot be broken by a
// future refactor of the query layer. The `/rest/v1` prefix is what supabase-js appends,
// so this stays correct whatever SUPABASE_URL is pointed at.
//
// SILENT WHEN HEALTHY -- it prints nothing at all when there is nothing to report, so it
// can be run from cron, which mails only on output.
//
// Exit codes: 0 = ran (whether or not it found anything), 2 = could not check at all
// (missing credentials, PostgREST unreachable, a table missing). Only 2 means "this
// report is not news".

const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Non-terminal statuses per table, and how long a run may sit in one without a heartbeat.
//
// The video thresholds are the interesting ones. `script_ready` and `storyboard_ready`
// are IDLE REVIEW GATES -- the pipeline is deliberately waiting for a human to approve
// spend -- so they are NOT listed here. A project can sit at a gate for a week and be
// perfectly healthy; listing them would make this report cry wolf on every project.
// `animating` gets 180 minutes because clips render SERIALLY, so a many-scene project
// legitimately runs for hours.
const CHECKS = [
  {
    table: 'transcriptions',
    label: 'transcription (/transcribe)',
    statuses: ['queued', 'running'],
    minutes: 60, // Sarvam batch STT of a long meeting recording
    select: 'id,status,title,file_count,updated_at',
  },
  {
    table: 'dlo_intakes',
    label: 'DLO intake (/dlo)',
    statuses: ['queued', 'running'],
    minutes: 60, // batch STT + per-page OCR of a scanned booklet
    select: 'id,status,step,updated_at',
  },
  {
    table: 'generations',
    label: 'article / poster (generations)',
    statuses: ['queued', 'running'],
    minutes: 30, // an article is minutes; a poster render ~2
    select: 'id,category,status,step,updated_at',
  },
  {
    table: 'video_projects',
    label: 'video (/video)',
    statuses: ['scripting', 'storyboarding', 'animating'],
    minutes: 180, // serial clip rendering; review gates deliberately excluded
    select: 'id,title,status,step,updated_at',
  },
];

const FAILED_WINDOW_HOURS = 24;

function minutesAgo(m) {
  return new Date(Date.now() - m * 60000).toISOString();
}

function hoursAgo(h) {
  return new Date(Date.now() - h * 3600000).toISOString();
}

function ageLabel(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 90) return m + 'm';
  const h = m / 60;
  return h < 48 ? h.toFixed(1) + 'h' : (h / 24).toFixed(1) + 'd';
}

async function query(path) {
  const res = await fetch(BASE + '/rest/v1/' + path, {
    headers: {
      apikey: KEY,
      Authorization: 'Bearer ' + KEY,
      Accept: 'application/json',
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(res.status + ' ' + body.slice(0, 300));
  return JSON.parse(body);
}

// A row's identifying detail, kept to one short line -- this is a digest, not a dump.
function describe(row) {
  const bits = [];
  if (row.category) bits.push(row.category);
  if (row.title) bits.push(String(row.title).slice(0, 40));
  if (row.step) bits.push('step=' + row.step);
  if (row.file_count) bits.push(row.file_count + ' files');
  return bits.length ? ' (' + bits.join(', ') + ')' : '';
}

async function main() {
  if (!BASE || !KEY) {
    console.error(
      'health-check: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. ' +
        'Run this inside the api container (see health-check.sh).',
    );
    process.exit(2);
  }

  const out = [];
  let unreachable = false;

  for (const check of CHECKS) {
    const inList = '(' + check.statuses.join(',') + ')';

    let stuck = [];
    let failed = [];
    try {
      stuck = await query(
        check.table +
          '?status=in.' +
          inList +
          '&updated_at=lt.' +
          minutesAgo(check.minutes) +
          '&select=' +
          check.select +
          '&order=updated_at.asc&limit=50',
      );
      failed = await query(
        check.table +
          '?status=eq.failed&updated_at=gte.' +
          hoursAgo(FAILED_WINDOW_HOURS) +
          '&select=' +
          check.select +
          ',error&order=updated_at.desc&limit=50',
      );
    } catch (error) {
      // A table that does not exist yet (an un-applied migration) must not sink the
      // whole report -- the other three still have something to say.
      unreachable = true;
      out.push(
        '??     ' + check.label + ': could not check -- ' + error.message,
      );
      continue;
    }

    if (stuck.length > 0) {
      out.push(
        'STUCK  ' +
          check.label +
          ' -- ' +
          stuck.length +
          ' with no update for ' +
          check.minutes +
          '+ min:',
      );
      for (const row of stuck) {
        out.push(
          '         ' +
            row.id +
            '  ' +
            row.status +
            '  ' +
            ageLabel(row.updated_at) +
            ' silent' +
            describe(row),
        );
      }
    }

    if (failed.length > 0) {
      out.push(
        'FAILED ' +
          check.label +
          ' -- ' +
          failed.length +
          ' in the last ' +
          FAILED_WINDOW_HOURS +
          'h:',
      );
      for (const row of failed) {
        const msg = (row.error || '(no message)')
          .replace(/\s+/g, ' ')
          .slice(0, 160);
        out.push('         ' + row.id + describe(row));
        out.push('           ' + msg);
      }
    }
  }

  if (out.length === 0) process.exit(0); // silent when healthy -- cron mails nothing

  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log('DGIPR platform health -- ' + now + ' IST');
  console.log('='.repeat(72));
  for (const line of out) console.log(line);
  console.log('');
  console.log(
    'A STUCK row is the one nothing else reports: no error is stored, the UI shows a',
  );
  console.log(
    'spinner, /analytics counts nothing. Grep the api log for its id, then decide',
  );
  console.log(
    'whether to fail the row by hand. A restart marks in-flight rows failed (the',
  );
  console.log(
    'single-process orphan reaper), so a burst right after a deploy is expected.',
  );

  process.exit(unreachable ? 2 : 0);
}

main().catch(function (error) {
  console.error(
    'health-check: ' + (error && error.stack ? error.stack : error),
  );
  process.exit(2);
});
