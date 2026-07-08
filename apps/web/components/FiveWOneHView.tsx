'use client';

// Read-only "at-a-glance" card of the 5W1H (कोण/काय/केव्हा/कुठे/का/कसे) the engine
// extracted from the note before drafting. Facts come only from the note, so any
// field the note didn't state is "" and shows a muted placeholder (never invented).

import type { GenerationDetail } from '@dgipr/schemas';
import { STR } from '../lib/strings';

const ROWS = [
  { key: 'who', label: STR.fiveWWho },
  { key: 'what', label: STR.fiveWWhat },
  { key: 'when', label: STR.fiveWWhen },
  { key: 'where', label: STR.fiveWWhere },
  { key: 'why', label: STR.fiveWWhy },
  { key: 'how', label: STR.fiveWHow },
] as const;

export function FiveWOneHView({ detail }: { detail: GenerationDetail }) {
  const fiveW = detail.fiveWOneH;
  if (!fiveW) return null;

  return (
    <section className="card">
      <h2>{STR.fiveWOneHTitle}</h2>
      <dl className="fivew-list">
        {ROWS.map(({ key, label }) => {
          const value = fiveW[key].trim();
          return (
            <div key={key} className="fivew-row">
              <dt>{label}</dt>
              <dd className={value ? undefined : 'hint'}>
                {value || STR.fiveWEmpty}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
