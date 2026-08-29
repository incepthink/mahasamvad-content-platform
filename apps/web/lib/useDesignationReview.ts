'use client';

// The "व्यक्ती व पदनाम" card's state, as a hook.
//
// The card itself (`DesignationReview`) has always been shared — /dlo and the media room both
// render it — but the twenty lines of state behind it were not: each surface kept its own
// copy, and the two have to agree about one subtle rule or the feature silently stops working
// (see `patchDesignationEdit` below). The new /dlo lane is the third surface, so the state
// moves here rather than being copied a third time.
//
// WHAT DIFFERS PER SURFACE is only where the names come from, which is why that is the one
// thing injected: the old lane scans an assembled transcript, the new one asks the model to
// read the attached documents. Everything after that — the edits, the pre-tick, the "keep
// using this" flag, the extra rows, the verify button — is identical on both.

import { useCallback, useState } from 'react';
import type {
  KnownDesignation,
  NameDesignation,
  PreparedName,
  PrepareDesignationsResponse,
} from '@dgipr/schemas';
import { verifyPersonName } from './api';
import { errorMessage } from './errorMessage';
import {
  collectDesignations,
  type DesignationEdit,
  type DesignationExtra,
} from '../components/DesignationReview';

export type DesignationReviewState = Readonly<{
  names: readonly PreparedName[] | null;
  known: readonly KnownDesignation[];
  edits: Readonly<Record<string, DesignationEdit>>;
  extras: readonly DesignationExtra[];
  loading: boolean;
  error: string | null;
  verifying: readonly string[];
  verifyError: string | null;
  /** Fires the (PAID) lookup. Safe to call again — the caller decides when. */
  run: () => Promise<void>;
  editDesignation: (marathi: string, designation: string) => void;
  toggleRemember: (marathi: string, remember: boolean) => void;
  toggleAccepted: (marathi: string, accepted: boolean) => void;
  changeExtra: (index: number, patch: Partial<DesignationExtra>) => void;
  addExtra: () => void;
  verify: (marathi: string) => Promise<void>;
  /** The approved pairs, in the shape the generate request takes. */
  collect: () => NameDesignation[];
}>;

export function useDesignationReview(
  fetchNames: () => Promise<PrepareDesignationsResponse>,
): DesignationReviewState {
  const [names, setNames] = useState<readonly PreparedName[] | null>(null);
  const [known, setKnown] = useState<readonly KnownDesignation[]>([]);
  const [edits, setEdits] = useState<Record<string, DesignationEdit>>({});
  const [extras, setExtras] = useState<readonly DesignationExtra[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<readonly string[]>([]);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchNames();
      setNames(result.names);
      setKnown(result.knownDesignations);
    } catch (caught) {
      setError(errorMessage(caught));
      // An empty list rather than null, so the card renders "nobody found" with its
      // add-a-name row instead of sitting on a spinner. A failed lookup costs suggestions,
      // never the ability to name someone by hand.
      setNames([]);
    } finally {
      setLoading(false);
    }
  }, [fetchNames]);

  // Patch ONE field, preserving the rest. Rebuilding the object from the fields a setter
  // happens to know about silently drops the others — a real hazard for `accepted`, since
  // losing it would quietly un-approve a person the officer had already confirmed.
  const patch = (marathi: string, next: Partial<DesignationEdit>) => {
    setEdits((prev) => {
      const term = names?.find((entry) => entry.marathi === marathi);
      const current: DesignationEdit = prev[marathi] ?? {
        designation: term?.designation ?? '',
        remember: false,
        // Seeded from the row's own default, NOT `false`. A pre-ticked dictionary suggestion
        // has no edit entry until something is patched, so a `false` seed would un-accept it
        // the moment the officer merely retyped its पदनाम. Must stay in step with `valueFor`
        // in DesignationReview and with `collectDesignations`' `?? term.suggested`.
        accepted: term?.suggested ?? false,
      };
      return { ...prev, [marathi]: { ...current, ...next } };
    });
  };

  const verify = async (marathi: string) => {
    if (verifying.includes(marathi)) return;
    setVerifyError(null);
    setVerifying((prev) => [...prev, marathi]);
    try {
      await verifyPersonName({ name: marathi });
      // Flipped locally rather than re-fetched: a re-fetch would re-buy the lookup, and this
      // is the only field that changed.
      setNames((prev) =>
        prev
          ? prev.map((term) =>
              term.marathi === marathi
                ? { ...term, verified: true, inGlossary: true }
                : term,
            )
          : prev,
      );
    } catch (caught) {
      setVerifyError(errorMessage(caught));
    } finally {
      setVerifying((prev) => prev.filter((name) => name !== marathi));
    }
  };

  return {
    names,
    known,
    edits,
    extras,
    loading,
    error,
    verifying,
    verifyError,
    run,
    editDesignation: (marathi, designation) => patch(marathi, { designation }),
    toggleRemember: (marathi, remember) => patch(marathi, { remember }),
    toggleAccepted: (marathi, accepted) => patch(marathi, { accepted }),
    changeExtra: (index, next) =>
      setExtras((prev) =>
        prev.map((row, position) =>
          position === index ? { ...row, ...next } : row,
        ),
      ),
    addExtra: () =>
      setExtras((prev) => [
        ...prev,
        { name: '', designation: '', remember: false },
      ]),
    verify,
    collect: () => collectDesignations(names, edits, extras),
  };
}
