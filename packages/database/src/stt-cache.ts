// Content-addressed cache of Sarvam STT transcripts (see
// supabase/migrations/0031_audio_transcript_cache.sql). Meeting recordings are
// transcribed by a slow, paid Sarvam batch job; keying the result on the audio's
// bytes lets a re-uploaded MP3 reuse its transcript instead of paying again.
//
// The key computation lives here beside the cache so "the key" has one definition.
// Consumed by the DLO intake job's transcribe phase (apps/api/src/jobs/dlo-runner.ts).

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const AUDIO_TRANSCRIPT_CACHE_TABLE = 'audio_transcript_cache';

// The cache key: lowercase SHA-256 hex of the raw audio bytes. Byte-exact — a
// re-export or a metadata edit is a different key (a cache miss), which is correct
// for content addressing: we never risk serving the wrong transcript.
export function hashAudioContent(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

// Batch lookup: one round-trip for however many audio files an intake holds.
// Returns hash -> transcript for the hits only; a missing hash is a cache miss.
export async function getCachedTranscripts(
  client: SupabaseClient,
  hashes: readonly string[],
): Promise<Map<string, string>> {
  if (hashes.length === 0) return new Map();
  const { data, error } = await client
    .from(AUDIO_TRANSCRIPT_CACHE_TABLE)
    .select('content_hash, transcript')
    .in('content_hash', [...hashes]);
  if (error) {
    throw new Error(`Failed to read transcript cache: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{
    content_hash: string;
    transcript: string;
  }>;
  return new Map(rows.map((row) => [row.content_hash, row.transcript]));
}

// Best-effort write of one successful transcript. `ignoreDuplicates` makes a
// concurrent identical upload (same hash written twice) a no-op rather than an
// error — the value is content-addressed, so the rows are identical anyway.
export async function putCachedTranscript(
  client: SupabaseClient,
  contentHash: string,
  transcript: string,
): Promise<void> {
  const { error } = await client
    .from(AUDIO_TRANSCRIPT_CACHE_TABLE)
    .upsert(
      { content_hash: contentHash, transcript, char_count: transcript.length },
      { onConflict: 'content_hash', ignoreDuplicates: true },
    );
  if (error) {
    throw new Error(`Failed to write transcript cache: ${error.message}`);
  }
}
