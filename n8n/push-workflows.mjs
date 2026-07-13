#!/usr/bin/env node
// Push the committed workflow exports into a running n8n over its public REST API.
//
//   pnpm n8n:push [--dry-run] [--only=<workflow-name>] [--create]
//
// n8n keeps workflows in its own database, not on disk: `git pull` on the host does
// nothing to them. This is the only supported way to ship a workflow change.
//
// Matching is by workflow NAME, because the exports carry no id (exporting from the
// n8n UI strips it). Credential ids and the Webhook node's Header Auth are properties
// of the *target instance*, not of the logic, so they are read back off the live
// workflow and re-applied to the export before the write — otherwise a push would
// unbind OpenAI from every node and silently disable the webhook secret.

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPORT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'workflow-exports',
);

// n8n's public API rejects a body with any property outside this set (400
// "request/body must NOT have additional properties"), so the export — which also
// carries pinData/meta/tags/versionId — is narrowed to exactly these.
const WRITABLE_FIELDS = ['name', 'nodes', 'connections', 'settings'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const allowCreate = args.includes('--create');
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length);

const apiUrl = (process.env.N8N_API_URL ?? '').replace(/\/+$/, '');
const apiKey = process.env.N8N_API_KEY ?? '';

if (!apiUrl || !apiKey) {
  console.error(
    'Missing N8N_API_URL / N8N_API_KEY.\n' +
      '  N8N_API_URL: e.g. https://n8n.indicex.xyz\n' +
      '  N8N_API_KEY: n8n editor -> Settings -> n8n API -> Create an API key\n' +
      'Put both in the (gitignored) root .env.',
  );
  process.exit(1);
}

/** @returns {Promise<any>} parsed JSON body; throws with n8n's own error text on failure. */
async function api(method, path, body) {
  const res = await fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: {
      'X-N8N-API-KEY': apiKey,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    // n8n names the offending property on a 400 — surfacing it raw is the fastest fix path.
    throw new Error(
      `${method} ${path} -> ${res.status} ${res.statusText}\n${text}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

async function listWorkflows() {
  const all = [];
  let cursor;
  do {
    const qs = new URLSearchParams({
      limit: '100',
      ...(cursor ? { cursor } : {}),
    });
    const page = await api('GET', `/workflows?${qs}`);
    all.push(...(page.data ?? []));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return all;
}

/** name -> credential id, harvested from a live workflow's nodes. The public API has no
 *  "list credentials" endpoint, so the live workflow is the only source of these ids. */
function credentialIdsByName(workflow) {
  const map = new Map();
  for (const node of workflow.nodes ?? []) {
    for (const cred of Object.values(node.credentials ?? {})) {
      if (cred?.name && cred?.id) map.set(cred.name, cred.id);
    }
  }
  return map;
}

const isWebhook = (node) => node.type === 'n8n-nodes-base.webhook';

/** Rewrite instance-specific bindings on the export to match what is already live. */
function reconcile(exported, live) {
  const hostedCreds = credentialIdsByName(live);
  const liveWebhook = (live.nodes ?? []).find(isWebhook);
  const notes = [];
  const warnings = [];

  const nodes = exported.nodes.map((node) => {
    const next = structuredClone(node);

    for (const [type, cred] of Object.entries(next.credentials ?? {})) {
      const hostedId = hostedCreds.get(cred.name);
      if (!hostedId) {
        warnings.push(
          `node "${next.name}": credential "${cred.name}" does not exist on the target — ` +
            `bind it once in the n8n UI after this push`,
        );
        continue;
      }
      if (hostedId !== cred.id) {
        notes.push(
          `node "${next.name}": credential "${cred.name}" ${cred.id} -> ${hostedId}`,
        );
        next.credentials[type] = { ...cred, id: hostedId };
      }
    }

    // The exports have webhook auth off; the deployed instances have Header Auth wired to
    // N8N_WEBHOOK_SECRET by hand. Never let a push turn that enforcement off.
    if (isWebhook(next) && liveWebhook) {
      const liveAuth = liveWebhook.parameters?.authentication;
      if (liveAuth && !next.parameters?.authentication) {
        next.parameters = { ...next.parameters, authentication: liveAuth };
        next.credentials = { ...liveWebhook.credentials, ...next.credentials };
        notes.push(
          `node "${next.name}": preserved webhook auth "${liveAuth}" from the target`,
        );
      }
    }

    return next;
  });

  return { nodes, notes, warnings };
}

async function push(file) {
  const exported = JSON.parse(await readFile(join(EXPORT_DIR, file), 'utf8'));
  const name = exported.name;
  console.log(`\n── ${name}  (${file}, ${exported.nodes.length} nodes)`);

  const matches = (await listWorkflows()).filter((w) => w.name === name);
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} workflows on the target are named "${name}" (${matches
        .map((w) => w.id)
        .join(', ')}). Rename or delete the duplicates — refusing to guess.`,
    );
  }

  if (matches.length === 0) {
    if (!allowCreate) {
      throw new Error(
        `no workflow named "${name}" on the target. Re-run with --create to create it ` +
          `(you will then have to bind its credentials once in the n8n UI).`,
      );
    }
    if (dryRun) {
      console.log('   would CREATE (no workflow with this name on the target)');
      return;
    }
    const body = Object.fromEntries(
      WRITABLE_FIELDS.map((f) => [
        f,
        exported[f] ?? (f === 'settings' ? {} : undefined),
      ]),
    );
    const created = await api('POST', '/workflows', body);
    console.log(
      `   created ${created.id} — now bind its credentials in the n8n UI, then activate`,
    );
    return;
  }

  const live = await api('GET', `/workflows/${matches[0].id}`);
  const { nodes, notes, warnings } = reconcile(exported, live);

  console.log(
    `   target ${live.id} (${live.nodes?.length ?? 0} nodes, active=${live.active})`,
  );
  for (const n of notes) console.log(`   · ${n}`);
  for (const w of warnings) console.warn(`   ! ${w}`);
  if (!notes.length) console.log('   · no credential/auth remap needed');

  if (dryRun) {
    console.log(
      `   would UPDATE ${live.id} -> ${nodes.length} nodes` +
        (live.active ? ' + republish' : ''),
    );
    return;
  }

  await api('PUT', `/workflows/${live.id}`, {
    name: exported.name,
    nodes,
    connections: exported.connections,
    settings: exported.settings ?? {},
  });

  // A deactivate/activate cycle is what makes n8n re-register the webhook and publish the
  // new graph; a bare PUT can leave the previously-published version serving traffic.
  if (live.active) {
    await api('POST', `/workflows/${live.id}/deactivate`);
    await api('POST', `/workflows/${live.id}/activate`);
  }

  const after = await api('GET', `/workflows/${live.id}`);
  if (after.nodes?.length !== exported.nodes.length) {
    throw new Error(
      `post-write check failed: target has ${after.nodes?.length} nodes, export has ${exported.nodes.length}`,
    );
  }
  console.log(
    `   updated ${live.id} -> ${after.nodes.length} nodes` +
      (live.active ? ', republished (active)' : ', left inactive'),
  );
}

const files = (await readdir(EXPORT_DIR))
  .filter((f) => f.endsWith('.json'))
  .filter((f) => !only || f === only || f === `${only}.json`);

if (!files.length) {
  console.error(
    `no workflow exports matched${only ? ` --only=${only}` : ''} in ${EXPORT_DIR}`,
  );
  process.exit(1);
}

console.log(`n8n → ${apiUrl}${dryRun ? '   (dry run — no writes)' : ''}`);
try {
  for (const file of files) await push(file);
} catch (err) {
  // These are all operator-actionable (wrong instance, duplicate names, bad key, 400 from
  // n8n) — a stack trace buries the one line that matters.
  // Node's fetch reports connection failures as a bare "fetch failed"; the cause carries
  // the ECONNREFUSED/DNS detail that tells you the URL is wrong.
  const cause = err.cause?.message ? ` (${err.cause.message})` : '';
  console.error(`\n✗ ${err.message}${cause}`);
  process.exit(1);
}
console.log(dryRun ? '\nDry run complete — nothing was written.' : '\nDone.');
