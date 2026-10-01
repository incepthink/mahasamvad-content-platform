'use client';

// The slim head /learn's pages carry. The badge is permanent on purpose: a practice screen that looks
// exactly like the real one must never be mistaken for it.

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { LEARN } from '../../lib/strings';

export function LearnBadge() {
  return <span className="learn-badge">{LEARN.practiceBadge}</span>;
}

export function LearnBackLink() {
  return (
    <Link href="/" className="btn btn-small learn-back">
      <ArrowLeft size={16} aria-hidden="true" />
      {LEARN.backToWork}
    </Link>
  );
}
