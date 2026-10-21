// शब्दकोश / टेम्पलेट: the library is not a run, but its one AI output is — the vision analysis
// cached on reference_images.layout_spec, which decides which notes a template can hold.

import { POSTERS_BUCKET, type ReferenceImageRow } from '@dgipr/database';
import {
  compact,
  storageMedia,
  traceId,
  type ReconstructedTrace,
} from '../trace.js';

export function buildReferenceTrace(
  row: ReferenceImageRow,
): ReconstructedTrace {
  const template = storageMedia(POSTERS_BUCKET, row.storagePath);
  const spec = row.layoutSpec;
  return {
    id: traceId('references', row.id),
    feature: 'references',
    rowId: row.id,
    name: `references · ${row.category} / ${row.subtype}`,
    startedAt: row.createdAt,
    endedAt: row.updatedAt,
    input: { template },
    output: spec
      ? { layoutSpec: spec }
      : { note: 'Not analysed: no layout_spec stored for this template.' },
    metadata: compact({
      feature: 'references',
      lane: row.category,
      reconstructed: true,
      status: spec ? 'analysed' : 'not-analysed',
      subtype: row.subtype,
      isActive: row.isActive,
      createdAt: row.createdAt,
      slotsLockedByOperator: spec?.slotsLockedByOperator,
    }),
    spans: [
      {
        key: 'analysis',
        name: 'template analysis (layout_spec)',
        type: 'llm',
        startedAt: row.updatedAt,
        input: { template },
        output: spec ?? { note: 'Not analysed.' },
      },
    ],
    notes: spec?.slotsLockedByOperator
      ? [
          'bulletSlots was set by the operator (size band), not by the vision pass.',
        ]
      : [],
  };
}
