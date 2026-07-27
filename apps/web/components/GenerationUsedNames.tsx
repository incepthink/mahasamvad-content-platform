'use client';

// Read-only person/designation summary for a generation detail page. Unlike the DLO
// authoring review, this never gates or changes a run: it analyzes the Marathi text that
// is actually on screen and reports each name exactly as it appears there.

import { useEffect, useMemo, useState } from 'react';
import type {
  Copy,
  GenerationDetail,
  PrepareDesignationsResponse,
} from '@dgipr/schemas';
import { prepareDesignations } from '../lib/api';
import { STR } from '../lib/strings';

type UsedName = Readonly<{
  name: string;
  designation: string | null;
}>;

function cacheKey(id: string, text: string): string {
  // Small deterministic FNV-1a hash. The generated text itself must not be copied into
  // sessionStorage keys; the hash is only an invalidation token, not a trust boundary.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `dgipr.used-names.${id}.${(hash >>> 0).toString(16)}`;
}

function cachedNames(value: string | null): UsedName[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      !parsed.every(
        (item) =>
          item &&
          typeof item === 'object' &&
          typeof (item as { name?: unknown }).name === 'string' &&
          (typeof (item as { designation?: unknown }).designation ===
            'string' ||
            (item as { designation?: unknown }).designation === null),
      )
    ) {
      return null;
    }
    return parsed as UsedName[];
  } catch {
    return null;
  }
}

function readCache(key: string): UsedName[] | null {
  try {
    return cachedNames(window.sessionStorage.getItem(key));
  } catch {
    return null;
  }
}

function writeCache(key: string, names: readonly UsedName[]): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(names));
  } catch {
    // Private/locked-down browser storage must not hide an otherwise valid result.
  }
}

const COPY_INTERNAL_KEYS = new Set([
  'post_type',
  'scene_brief',
  'icon_hint',
  'emphasis',
]);

// CopySchema contains both poster-visible Marathi and internal image guidance. Only the
// visible fields should count when we say a person was "used" in the generation.
function visibleCopyText(value: unknown, key = ''): string[] {
  if (COPY_INTERNAL_KEYS.has(key) || value == null) return [];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => visibleCopyText(item));
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([childKey, child]) => visibleCopyText(child, childKey),
    );
  }
  return [];
}

function generationText(detail: GenerationDetail): string {
  const parts = [
    detail.article?.trim() ?? '',
    ...visibleCopyText(detail.copy as Copy | null),
  ].filter(Boolean);
  return [...new Set(parts)].join('\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Titles may sit before an honorific ("मुख्यमंत्री श्री. अमुक") or after the name
// in compact attribution copy ("अमुक — मुख्यमंत्री"). Both are literal matches over
// the generated text; no title is inferred from the dictionary.
const HONORIFIC =
  '(?:(?:श्रीमती|श्री\\.?|डॉ\\.?|मा\\.?|ना\\.?|अ‍ॅड\\.?|अॅड\\.?)\\s+)*';

function usedDesignation(
  text: string,
  name: string,
  candidates: readonly string[],
  quoteAttribution: Readonly<{ name: string; title: string }> | null,
): string | null {
  if (quoteAttribution?.name === name && quoteAttribution.title) {
    return quoteAttribution.title;
  }

  const escapedName = escapeRegExp(name);
  for (const designation of [...new Set(candidates)]
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)) {
    const escapedDesignation = escapeRegExp(designation);
    const before = new RegExp(
      `${escapedDesignation}\\s+${HONORIFIC}${escapedName}`,
      'u',
    );
    const after = new RegExp(
      `${escapedName}\\s*(?:[-–—,:।]\\s*)?${escapedDesignation}`,
      'u',
    );
    if (before.test(text) || after.test(text)) return designation;
  }
  return null;
}

function toUsedNames(
  text: string,
  result: PrepareDesignationsResponse,
  quoteAttribution: Readonly<{ name: string; title: string }> | null,
): UsedName[] {
  const candidates = [
    ...result.mentionedDesignations,
    ...result.knownDesignations.map((item) => item.marathi),
    ...result.names.map((item) => item.designation),
  ];
  return result.names
    .map((item) => ({
      name: item.marathi,
      designation: usedDesignation(
        text,
        item.marathi,
        candidates,
        quoteAttribution,
      ),
    }))
    .sort((a, b) => text.indexOf(a.name) - text.indexOf(b.name));
}

export function GenerationUsedNames({ detail }: { detail: GenerationDetail }) {
  const text = useMemo(
    () => generationText(detail),
    [detail.article, detail.copy],
  );
  const quoteName =
    detail.copy?.post_type === 'quote'
      ? (detail.copy.attribution?.name?.trim() ?? '')
      : '';
  const quoteTitle =
    detail.copy?.post_type === 'quote'
      ? (detail.copy.attribution?.title?.trim() ?? '')
      : '';
  const [names, setNames] = useState<UsedName[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setNames(null);
    setUnavailable(false);

    if (text.trim().length < 20) {
      setNames([]);
      return () => {
        cancelled = true;
      };
    }

    const storageKey = cacheKey(detail.id, text);
    const cached = readCache(storageKey);
    if (cached) {
      setNames(cached);
      return () => {
        cancelled = true;
      };
    }

    void prepareDesignations({ text })
      .then((result) => {
        if (!cancelled) {
          const used = toUsedNames(
            text,
            result,
            quoteName && quoteTitle
              ? { name: quoteName, title: quoteTitle }
              : null,
          );
          setNames(used);
          writeCache(storageKey, used);
        }
      })
      .catch(() => {
        // Extraction is informational and must never turn a successful generation into
        // an error. The card remains transparent about the unavailable summary.
        if (!cancelled) {
          setNames([]);
          setUnavailable(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detail.id, quoteName, quoteTitle, text]);

  return (
    <section className="card used-names-card" aria-live="polite">
      <h2>{STR.usedNamesTitle}</h2>
      <p className="hint">{STR.usedNamesHint}</p>

      {names === null ? (
        <p className="hint">{STR.usedNamesLoading}</p>
      ) : unavailable ? (
        <p className="hint">{STR.usedNamesUnavailable}</p>
      ) : names.length === 0 ? (
        <p className="hint">{STR.usedNamesEmpty}</p>
      ) : (
        <div className="used-names-list">
          {names.map((item) => (
            <div className="used-name-row" key={item.name}>
              <div>
                <span className="used-name-label">{STR.designationsName}</span>
                <strong>{item.name}</strong>
              </div>
              <div>
                <span className="used-name-label">
                  {STR.designationsDesignation}
                </span>
                <span>{item.designation ?? STR.usedNamesNoDesignation}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
