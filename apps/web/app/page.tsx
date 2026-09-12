'use client';

// Creative and Social — paste a FINISHED article (or attach the file it is in), then
// turn it into a poster (social, YouTube thumbnail or Banner) or into a caption alone.
// No article is written here: the pasted text is the sole source and is used as-is
// (providedArticle) on the poster path.
//
// This page is DELIBERATELY thin. Every rule about what a lane sends, hides or refuses
// lives in `components/media-room/useCreateForm.ts`; the four blocks below are markup:
//
//   NoteComposer   — the text, the file behind [+], the format, the two Creative
//                    opt-ins, and the submit that acts on them
//   ImagePromptBox — the officer's own image brief (Creative only, migration 0045)
//   TemplateSelect — the optional template pin (every lane that renders a poster)
//
// On the Creative lane the officer answers TWO INDEPENDENT questions and `designMode` is
// DERIVED from the pair rather than stored — which is what makes it impossible for the
// mode and the pin to disagree:
//
//   DESIGN  — the template picker. Empty (the default) means the API resolves no
//             reference at all and the image model designs the whole poster; pick one and
//             the poster follows it.
//   CONTENT — the "जसाच्या तसा मजकूर" checkbox beside the format. Unticked (the default)
//             has generatePosterCopy read the box as source material and write the
//             poster's words out of it; ticked prints exactly what is in the box.
//
//                   | content 'ai' | content 'verbatim'
//   ----------------+--------------+--------------------
//   no template     | 'fresh'      | 'fresh_verbatim'
//   a template      | 'adaptive'   | 'onbrand'
//
// Banner and YouTube ignore designMode entirely.

import { STR } from '../lib/strings';
import { ImagePromptBox } from '../components/media-room/ImagePromptBox';
import { MotionComposer } from '../components/media-room/MotionComposer';
import { NoteComposer } from '../components/media-room/NoteComposer';
import { TemplateSelect } from '../components/media-room/TemplateSelect';
import { useCreateForm } from '../components/media-room/useCreateForm';

export default function NewGenerationPage() {
  const form = useCreateForm();

  return (
    // No foot clearance: the submit is in the composer card (see NoteComposer), so
    // nothing is pinned over the last block or over the credit line any more.
    <main className="page home-glass-page">
      {/* A route-local palette trial. Styled JSX removes these global overrides when
          this page unmounts, so the rest of the product keeps its established theme. */}
      <style jsx global>{`
        :root {
          --bg: #ffffff;
          --bg-accent: #f7f7f8;
          --text: #19171d;
          --muted: #625d6c;
          --card: rgba(255, 255, 255, 0.58);
          --surface: #f7f7f8;
          --border: rgba(25, 23, 29, 0.14);
          --border-strong: rgba(25, 23, 29, 0.3);
          --shadow-sm: 0 1px 2px rgba(25, 23, 29, 0.08);
          --shadow-md:
            0 1px 2px rgba(25, 23, 29, 0.07), 0 4px 14px rgba(25, 23, 29, 0.1);
          --shadow-lg:
            0 2px 4px rgba(25, 23, 29, 0.08), 0 12px 32px rgba(25, 23, 29, 0.14);
          --shadow: var(--shadow-md);

          --accent: #9b78e7;
          --accent-dark: #5e3a9a;
          --accent-soft: #eee7fb;
          --accent-tint: #faf8ff;
          --ring: rgba(155, 120, 231, 0.42);

          --background: #ffffff;
          --foreground: #19171d;
          --card-bg: rgba(255, 255, 255, 0.58);
          --card-foreground: #19171d;
          --popover: #ffffff;
          --popover-foreground: #19171d;
          --primary: #9b78e7;
          --primary-foreground: #ffffff;
          --secondary: #eee7fb;
          --secondary-foreground: #19171d;
          --muted-bg: #f4f4f5;
          --muted-foreground: #625d6c;
          --accent-bg: #eee7fb;
          --accent-foreground: #5e3a9a;
          --border-color: rgba(25, 23, 29, 0.14);
          --input: rgba(25, 23, 29, 0.3);
          --ring-color: rgba(155, 120, 231, 0.42);
        }

        html {
          background: #ffffff;
          background-image: none;
        }

        .home-video-background {
          position: fixed;
          inset-block: 0;
          inset-inline: var(--sidebar-w, 0) 0;
          z-index: -1;
          width: calc(100vw - var(--sidebar-w, 0px));
          height: 100vh;
          object-fit: cover;
          pointer-events: none;
        }

        @media (prefers-reduced-motion: reduce) {
          .home-video-background {
            display: none;
          }
        }

        .sidebar {
          background: #19181b;
          border-right-color: #19181b;
          box-shadow: 1px 0 0 rgba(25, 23, 29, 0.18);
        }

        .sidebar-head {
          border-bottom-color: rgba(255, 255, 255, 0.12);
        }

        .sidebar-logo .site-logo {
          filter: brightness(0) invert(1);
        }

        .sidebar-collapse {
          border-color: rgba(255, 255, 255, 0.16);
          background: rgba(255, 255, 255, 0.08);
          color: rgba(255, 255, 255, 0.72);
        }

        .sidebar-collapse:hover,
        .sidebar-link:hover,
        .sidebar .tasks-button:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
        }

        .sidebar-link,
        .sidebar .tasks-button,
        .sidebar-link svg,
        .sidebar .tasks-button svg {
          color: rgba(255, 255, 255, 0.72);
        }

        .sidebar-link.active {
          background: rgba(255, 255, 255, 0.12);
          color: #ffffff;
          box-shadow: inset 3px 0 0 #9b78e7;
        }

        .sidebar-link.active svg,
        .sidebar-link:hover svg,
        .sidebar .tasks-button:hover svg {
          color: #b99af2;
        }

        .site-footer {
          background: #19181b;
        }

        .home-glass-page .page-head,
        .home-glass-page section.bg-card {
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.68),
            rgba(255, 255, 255, 0.42)
          );
          border: 1px solid rgba(255, 255, 255, 0.62);
          box-shadow:
            0 18px 45px rgba(34, 22, 57, 0.16),
            inset 0 1px 0 rgba(255, 255, 255, 0.72);
          -webkit-backdrop-filter: blur(20px) saturate(145%);
          backdrop-filter: blur(20px) saturate(145%);
        }

        .home-glass-page .page-head {
          padding: 20px;
          border-radius: 18px;
        }

        /* A chip or an opt-in reads as part of the glass, so its edge is the light one. */
        .home-glass-page label.border {
          border-color: rgba(255, 255, 255, 0.58);
          background: rgba(255, 255, 255, 0.3);
        }

        /* A FIELD is not: the light edge disappears against the white card, and a text box
           with no visible edge reads as prose rather than as the thing to type in. Every
           field on the page takes the dark line — this used to be scoped to
           .mr-note-composer, which is why the AI प्रॉम्प्ट box looked borderless beside a
           bordered note box. */
        .home-glass-page textarea,
        .home-glass-page input[type='text'] {
          border-color: rgba(25, 23, 29, 0.58);
          background: rgba(255, 255, 255, 0.3);
        }

        /* The template fold is a field too — it holds the answer to the card's question —
           so its row takes the same line rather than the fainter --input one. Border only:
           the background stays the button's, or its hover would have nothing left to do. */
        .home-glass-page .ref-picker-disclosure-head {
          border-color: rgba(25, 23, 29, 0.58);
        }

        .home-glass-page [data-slot='button'][data-variant='outline'] {
          border-color: rgba(255, 255, 255, 0.58);
          background: rgba(255, 255, 255, 0.38);
        }

        .home-glass-page [data-slot='button'][data-variant='outline'] svg {
          color: var(--accent-dark);
        }

        .home-glass-page [data-slot='button'][data-variant='outline']:hover {
          border-color: rgba(155, 120, 231, 0.46);
          background: rgba(238, 231, 251, 0.72);
        }

        .home-glass-page .mr-note-composer button:not(.mr-submit-button) {
          border-color: rgba(25, 23, 29, 0.72);
          background: rgba(25, 23, 29, 0.82);
          color: #ffffff;
        }

        .home-glass-page .mr-note-composer button:not(.mr-submit-button) svg {
          color: #ffffff;
        }

        .home-glass-page .mr-note-composer button:not(.mr-submit-button):hover {
          border-color: rgba(25, 23, 29, 0.82);
          background: rgba(25, 23, 29, 0.72);
          color: #ffffff;
        }

        .home-glass-page .mr-note-composer .mr-check-option {
          border-color: rgba(25, 23, 29, 0.72);
          background: rgba(25, 23, 29, 0.82);
          color: #ffffff;
        }

        .home-glass-page .mr-note-composer .mr-check-option:hover,
        .home-glass-page .mr-note-composer .mr-check-option:has(input:checked) {
          border-color: rgba(25, 23, 29, 0.82);
          background: rgba(25, 23, 29, 0.72);
          color: #ffffff;
        }

        .mr-submit-flow {
          background-image: linear-gradient(
            100deg,
            #6f49b6 0%,
            #9b78e7 24%,
            #b99af2 46%,
            #9b78e7 68%,
            #6f49b6 100%
          );
          box-shadow:
            var(--shadow-md),
            0 6px 22px rgba(79, 43, 141, 0.28);
        }
      `}</style>
      <video
        className="home-video-background"
        src="/backgrounds/background-1.mov"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
        tabIndex={-1}
      />
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{STR.mediaRoomTitle}</h1>
          <p className="page-sub">{STR.mediaRoomIntro}</p>
        </div>
      </header>

      <div className="flex flex-col gap-5">
        {/* THE SOURCE IS A PICTURE ON ONE LANE ONLY. डायनॅमिक पोस्टर starts from a finished
            poster the officer already has, so the composer that asks for text is replaced
            outright rather than left there to be ignored. Both cards carry the format
            control and the submit, so the lane can always be left again. */}
        {form.isDynamicPoster ? (
          <MotionComposer form={form} />
        ) : (
          <NoteComposer form={form} />
        )}

        {form.isSocial ? <ImagePromptBox form={form} /> : null}

        {/* The caption-only lane renders no poster, and डायनॅमिक पोस्टर animates one the
            officer supplies — so neither has anything for a template to shape and the
            picker is not shown at all. */}
        {!form.isCaption && !form.isDynamicPoster ? (
          <TemplateSelect
            category={form.pickerCategory}
            value={form.reference}
            onChange={form.setReference}
            isSocial={form.isSocial}
          />
        ) : null}
      </div>
    </main>
  );
}
