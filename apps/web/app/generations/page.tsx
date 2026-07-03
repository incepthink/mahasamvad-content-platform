'use client';

import { useEffect, useState } from 'react';
import type { GenerationSummary } from '@dgipr/schemas';
import { listGenerations } from '../../lib/api';
import { STR } from '../../lib/strings';
import { HistoryCard, HistoryEmpty } from '../../components/HistoryCard';

export default function HistoryPage() {
  const [items, setItems] = useState<GenerationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listGenerations()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : STR.genericError));
  }, []);

  return (
    <main className="page">
      <h1 className="page-title">{STR.historyTitle}</h1>
      {error ? <p className="form-error">{error}</p> : null}
      {items && items.length === 0 ? <HistoryEmpty /> : null}
      {items && items.length > 0 ? (
        <div className="history-grid">
          {items.map((item) => (
            <HistoryCard key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </main>
  );
}
