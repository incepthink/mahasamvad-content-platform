'use client';

// /learn — the practice lessons. Reached by URL only (like /preferences and /activity). Two
// lessons today, one per main lane; the page says more are coming rather than pretending a
// catalogue exists.

import Link from 'next/link';
import { GraduationCap, type LucideIcon, Newspaper } from 'lucide-react';
import { PageShell } from '../../components/common/PageShell';
import { LearnBackLink, LearnBadge } from '../../components/learn/LearnHead';
import { LEARN } from '../../lib/strings';

export default function LearnIndexPage() {
  return (
    <PageShell
      background="creative"
      title={LEARN.indexTitle}
      statusChip={<LearnBadge />}
      actions={<LearnBackLink />}
    >
      <p className="hint learn-index-intro">{LEARN.indexIntro}</p>
      <LessonCard
        icon={GraduationCap}
        title={LEARN.creativeLessonTitle}
        meta={LEARN.creativeLessonMeta}
        desc={LEARN.creativeLessonDesc}
        href="/learn/creative?fresh=1"
      />
      <LessonCard
        icon={Newspaper}
        title={LEARN.dloLessonTitle}
        meta={LEARN.dloLessonMeta}
        desc={LEARN.dloLessonDesc}
        href="/learn/dlo?fresh=1"
      />
      <p className="hint learn-more-soon">{LEARN.moreLessonsSoon}</p>
    </PageShell>
  );
}

function LessonCard({
  icon: Icon,
  title,
  meta,
  desc,
  href,
}: {
  icon: LucideIcon;
  title: string;
  meta: string;
  desc: string;
  href: string;
}) {
  return (
    <section className="card learn-lesson-card">
      <Icon className="learn-lesson-icon" size={28} aria-hidden="true" />
      <div className="learn-lesson-text">
        <h2>
          {title} <span className="learn-lesson-meta">({meta})</span>
        </h2>
        <p className="hint">{desc}</p>
      </div>
      <Link href={href} className="btn btn-primary">
        {LEARN.lessonStart}
      </Link>
    </section>
  );
}
