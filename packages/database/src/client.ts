// Supabase client for server-side ingestion/retrieval.
//
// Uses the service-role key, which bypasses row-level security, so this client
// must only ever run server-side (scripts, API) — never in the browser.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        'Copy .env.example to .env and fill it in (see repo README).',
    );
  }
  return value;
}

export function createServiceRoleClient(): SupabaseClient {
  const url = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
