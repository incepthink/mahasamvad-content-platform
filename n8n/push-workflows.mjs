#!/usr/bin/env node
// Push the committed workflow exports into a running n8n over its public REST API.
//
//   pnpm n8n:push [--dry-run] [--only=<workflow-name>] [--create] [--allow-unbound]
//
// n8n keeps workflows in its own database, not on disk: `git pull` on the host does
// nothing to them. This is the only supported way to ship a workflow change.
//
// Matching is by workflow NAME, because the exports carry no id (exporting from the
// n8n UI strips it). Credentials are likewise instance-specific: they never travel
// inside a workflow JSON, so the exports name them but do not carry ids, and every
// push re-binds them to the ids of the TARGET instance's own credentials (matched by
// name). If a name cannot be resolved there, the push ABORTS before writing anything:
// writing an id that does not exist on the target produces a workflow that imports and
// activates cleanly and then dies at runtime with
//   Credential with ID "..." does not exist for type "httpHeaderAuth"
// which is exactly the failure this guard exists to prevent. Create the credential in
// the n8n UI (deploy/README.md, Phase C1 step 3) and push again.

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
const allowUnbound = args.includes('--allow-unbound');
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

async function request(method, path, body) {
  const res = await fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: {
      'X-N8N-API-KEY': apiKey,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    text: await res.text(),
  };
}

/** @returns {Promise<any>} parsed JSON body; throws with n8n's own error text on failure. */
async function api(method, path, body) {
  const { ok, status, statusText, text } = await request(method, path, body);
  if (!ok) {
    // n8n names the offending property on a 400 — surfacing it raw is the fastest fix path.
    throw new Error(`${method} ${path} -> ${status} ${statusText}\n${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function paginate(path) {
  const all = [];
  let cursor;
  do {
    const qs = new URLSearchParams({
      limit: '100',
      ...(cursor ? { cursor } : {}),
    });
    const page = await api('GET', `${path}?${qs}`);
    all.push(...(page.data ?? []));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return all;
}

const listWorkflows = () => paginate('/workflows');

/** The target's real credentials. Not every n8n exposes credential reads on the public API
 *  (older versions / restricted keys answer 403/404/405); `null` means "cannot enumerate",
 *  and the caller falls back to scanning live workflows. */
async function listCredentials() {
  const { ok, status } = await request('GET', '/credentials?limit=1');
  if (!ok) {
    if ([403, 404, 405].includes(status)) return null;
    throw new Error(`GET /credentials -> ${status}`);
  }
  return paginate('/credentials');
}

/** Resolves a credential NAME to an id that exists on the target.
 *
 *  Authoritative mode (the target lists its credentials) is the only mode that can spot a
 *  *dangling* id — one a previous push wrote into a node although no such credential exists.
 *  The fallback mode harvests ids out of live workflow nodes, which is exactly where dangling
 *  ids live, so it cannot validate them; it only widens the search across every workflow on
 *  the instance instead of just the one being pushed. */
function buildResolver(credentials, workflows) {
  if (credentials) {
    const byName = new Map();
    for (const c of credentials) {
      byName.set(c.name, byName.has(c.name) ? null : c.id); // null marks an ambiguous name
    }
    return {
      authoritative: true,
      resolve(name) {
        if (!byName.has(name))
          return {
            error: `no credential named "${name}" exists on the target`,
          };
        const id = byName.get(name);
        if (id === null)
          return {
            error: `more than one credential on the target is named "${name}" — rename so it is unique`,
          };
        return { id };
      },
    };
  }

  const byName = new Map();
  for (const workflow of workflows) {
    for (const node of workflow.nodes ?? []) {
      for (const cred of Object.values(node.credentials ?? {})) {
        if (cred?.name && cred?.id && !byName.has(cred.name))
          byName.set(cred.name, cred.id);
      }
    }
  }
  return {
    authoritative: false,
    resolve(name) {
      const id = byName.get(name);
      return id
        ? { id }
        : {
            error: `no workflow on the target binds a credential named "${name}" (this n8n does not expose its credential list, so that is the only way to find its id)`,
          };
    },
  };
}

const isWebhook = (node) => node.type === 'n8n-nodes-base.webhook';

/** Rewrite instance-specific bindings on the export to match what is already live. */
function reconcile(exported, live, resolver) {
  const liveWebhook = (live?.nodes ?? []).find(isWebhook);
  const notes = [];
  const unresolved = [];

  const nodes = exported.nodes.map((node) => {
    const next = structuredClone(node);

    for (const [type, cred] of Object.entries(next.credentials ?? {})) {
      const { id, error } = resolver.resolve(cred.name);
      if (error) {
        unresolved.push({ node: next.name, credential: cred.name, error });
        if (allowUnbound) {
          // An honest "credential not set" in the editor beats an id that resolves to nothing
          // and only fails once the node runs.
          delete next.credentials[type];
          notes.push(
            `node "${next.name}": credential "${cred.name}" left UNBOUND (--allow-unbound)`,
          );
        }
        continue;
      }
      if (id !== cred.id) {
        notes.push(
          `node "${next.name}": credential "${cred.name}" ${cred.id ?? '(unbound)'} -> ${id}`,
        );
        next.credentials[type] = { ...cred, id };
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

  return { nodes, notes, unresolved };
}

/** Resolve everything and report, but write nothing — so one unbindable credential in the
 *  second file cannot leave the first file already pushed. */
async function planPush(file, workflows, resolver) {
  const exported = JSON.parse(await readFile(join(EXPORT_DIR, file), 'utf8'));
  const name = exported.name;

  const matches = workflows.filter((w) => w.name === name);
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} workflows on the target are named "${name}" (${matches
        .map((w) => w.id)
        .join(', ')}). Rename or delete the duplicates — refusing to guess.`,
    );
  }

  if (matches.length === 0 && !allowCreate) {
    throw new Error(
      `no workflow named "${name}" on the target. Re-run with --create to create it.`,
    );
  }

  // The list endpoint already returns nodes, but re-fetch so the reconcile reads the freshest
  // graph (a push republishes; a stale read could resurrect an older webhook binding).
  const live = matches.length
    ? await api('GET', `/workflows/${matches[0].id}`)
    : null;
  const { nodes, notes, unresolved } = reconcile(exported, live, resolver);

  return { file, exported, live, nodes, notes, unresolved };
}

async function write({ exported, live, nodes }) {
  if (!live) {
    const body = Object.fromEntries(
      WRITABLE_FIELDS.map((f) => [
        f,
        f === 'nodes'
          ? nodes
          : (exported[f] ?? (f === 'settings' ? {} : undefined)),
      ]),
    );
    const created = await api('POST', '/workflows', body);
    console.log(`   created ${created.id} — activate it in the n8n UI`);
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
  if (after.nodes?.length !== nodes.length) {
    throw new Error(
      `post-write check failed: target has ${after.nodes?.length} nodes, export has ${nodes.length}`,
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
  const [workflows, credentials] = await Promise.all([
    listWorkflows(),
    listCredentials(),
  ]);
  const resolver = buildResolver(credentials, workflows);
  console.log(
    resolver.authoritative
      ? `credentials on target: ${credentials.length} (ids resolved by name against the instance's own list)`
      : 'credentials on target: NOT LISTABLE by this API key — falling back to ids harvested from live workflows (cannot detect a dangling id)',
  );

  const plans = [];
  for (const file of files) {
    const plan = await planPush(file, workflows, resolver);
    plans.push(plan);
    console.log(
      `\n── ${plan.exported.name}  (${file}, ${plan.exported.nodes.length} nodes)`,
    );
    console.log(
      plan.live
        ? `   target ${plan.live.id} (${plan.live.nodes?.length ?? 0} nodes, active=${plan.live.active})`
        : '   target: none — would CREATE',
    );
    for (const n of plan.notes) console.log(`   · ${n}`);
    for (const u of plan.unresolved)
      console.error(`   ! node "${u.node}": ${u.error}`);
    if (!plan.notes.length && !plan.unresolved.length)
      console.log('   · no credential/auth remap needed');
  }

  const unresolved = plans.flatMap((p) =>
    p.unresolved.map((u) => ({ workflow: p.exported.name, ...u })),
  );
  if (unresolved.length && !allowUnbound) {
    // Writing an id that does not exist on the target yields a workflow that activates fine and
    // then fails at runtime — refuse, and leave the live workflows exactly as they are.
    throw new Error(
      `${unresolved.length} credential binding(s) cannot be resolved on ${apiUrl} — nothing was written.\n` +
        unresolved
          .map((u) => `  · ${u.workflow} / ${u.node}: ${u.error}`)
          .join('\n') +
        `\n\nCreate the credential(s) in the n8n UI with the EXACT name above and bind them once\n` +
        `(deploy/README.md, Phase C1 step 3), then re-run. To push anyway and leave those nodes\n` +
        `visibly unbound in the editor, re-run with --allow-unbound.`,
    );
  }

  if (dryRun) {
    for (const p of plans)
      console.log(
        `\n   would ${p.live ? `UPDATE ${p.live.id}` : 'CREATE'} -> ${p.nodes.length} nodes` +
          (p.live?.active ? ' + republish' : ''),
      );
    console.log('\nDry run complete — nothing was written.');
    process.exit(0);
  }

  for (const plan of plans) {
    console.log(`\n── ${plan.exported.name}`);
    await write(plan);
  }
} catch (err) {
  // These are all operator-actionable (wrong instance, duplicate names, bad key, missing
  // credential, 400 from n8n) — a stack trace buries the one line that matters.
  // Node's fetch reports connection failures as a bare "fetch failed"; the cause carries
  // the ECONNREFUSED/DNS detail that tells you the URL is wrong.
  const cause = err.cause?.message ? ` (${err.cause.message})` : '';
  console.error(`\n✗ ${err.message}${cause}`);
  process.exit(1);
}
console.log('\nDone.');
