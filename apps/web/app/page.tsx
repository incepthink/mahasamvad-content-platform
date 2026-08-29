'use client';

// Creative and Social — paste a FINISHED article (or attach the file it is in), then
// turn it into a poster (social, YouTube thumbnail or Banner) or into a caption alone.
// No article is written here: the pasted text is the sole source and is used as-is
// (providedArticle) on the poster path.
//
// This page is DELIBERATELY thin. Every rule about what a lane sends, hides or refuses
// lives in `components/media-room/useCreateForm.ts`; the four blocks below are markup:
//
//   NoteComposer   — the text, the file behind [+], the format, the two Creative opt-ins
//   ImagePromptBox — the officer's own image brief (Creative only, migration 0045)
//   TemplateSelect — the optional template pin (every lane that renders a poster)
//   GenerateBar    — the one action, pinned to the foot of the viewport
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
import { GenerateBar } from '../components/common/GenerateBar';
import { ImagePromptBox } from '../components/media-room/ImagePromptBox';
import { NoteComposer } from '../components/media-room/NoteComposer';
import { TemplateSelect } from '../components/media-room/TemplateSelect';
import { useCreateForm } from '../components/media-room/useCreateForm';

export default function NewGenerationPage() {
  const form = useCreateForm();

  return (
    // .mr-create-page reserves room at the foot of the page — and of the site footer
    // below it — for the pinned action bar, which is out of flow and would otherwise sit
    // over the last block and over the credit line.
    <main className="page mr-create-page">
      <header className="page-head">
        <div className="page-head-text">
          <h1 className="page-title">{STR.mediaRoomTitle}</h1>
          <p className="page-sub">{STR.mediaRoomIntro}</p>
        </div>
      </header>

      <div className="flex flex-col gap-5">
        <NoteComposer form={form} />

        {form.isSocial ? <ImagePromptBox form={form} /> : null}

        {/* The caption-only lane renders no poster, so there is nothing for a template
            to shape and the picker is not shown at all. */}
        {!form.isCaption ? (
          <TemplateSelect
            category={form.pickerCategory}
            value={form.reference}
            onChange={form.setReference}
            isSocial={form.isSocial}
          />
        ) : null}
      </div>

      <GenerateBar
        label={form.submitLabel}
        busy={form.submitBusy}
        canSubmit={form.canSubmit}
        onSubmit={() => void form.startSubmit()}
        error={form.error}
        socialBusy={form.hasActiveSocialTask}
        articleBusy={form.hasActiveArticleTask}
      />
    </main>
  );
}
