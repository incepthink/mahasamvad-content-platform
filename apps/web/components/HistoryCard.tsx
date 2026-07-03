import Link from 'next/link';
import type { GenerationSummary } from '@dgipr/schemas';
import { formatDate, STR } from '../lib/strings';
import { StatusChip } from './StatusChip';

export function HistoryCard({ item }: { item: GenerationSummary }) {
  return (
    <Link href={`/generations/${item.id}`} className="history-card">
      {item.posterUrl ? (
        <img src={item.posterUrl} alt="" className="history-thumb" />
      ) : null}
      <div className="history-info">
        <StatusChip status={item.status} />
        <p className="history-headline">{item.headline ?? item.noteExcerpt}</p>
        <p className="history-excerpt">{item.noteExcerpt}</p>
        <p className="history-date">{formatDate(item.createdAt)}</p>
      </div>
    </Link>
  );
}

export function HistoryEmpty() {
  return (
    <div className="card">
      <p className="hint">{STR.historyEmpty}</p>
      <Link href="/" className="btn btn-primary" style={{ marginTop: 12, display: 'inline-block' }}>
        {STR.historyNew}
      </Link>
    </div>
  );
}
