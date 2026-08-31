'use client';

/**
 * The optional template pin, below the two boxes and above the pinned action.
 *
 * It is the shared `ReferencePicker` in its `disclosure` variant — the same gallery
 * every other create surface uses, folded shut behind one row, so the library, its
 * search and its size bands are not re-implemented here.
 *
 * Keyed by the picker's category so switching format remounts it against the right
 * library. The pin state itself is cleared by the form's effect on [format], so
 * switching away and back cannot leave a stale one behind either.
 *
 * NOT rendered on the caption-only lane: that run renders no poster, so there is
 * nothing for a template to shape. The page decides that; this component is only ever
 * given a lane that has one.
 */

import ReferencePicker, {
  type ReferenceSelection,
} from '@/components/ReferencePicker';
import type { ReferenceCategory } from '@dgipr/schemas';
import { FormCard } from '@/components/common/FormCard';
import { STR } from '@/lib/strings';

export function TemplateSelect({
  category,
  value,
  onChange,
  isSocial,
}: {
  category: ReferenceCategory;
  value: ReferenceSelection | null;
  onChange: (selection: ReferenceSelection | null) => void;
  isSocial: boolean;
}) {
  return (
    <FormCard>
      <ReferencePicker
        key={category}
        category={category}
        brand="dgipr"
        variant="disclosure"
        value={value}
        onChange={onChange}
        {...(isSocial
          ? {
              // On the Creative lane an empty selection means NO template is used and
              // the poster is designed from scratch — the opposite of the default
              // wording, which promises the platform will pick one. Banner and YouTube
              // still auto-select, so they keep it.
              noneLabel: STR.refPickerDisclosureNoneSocial,
              noneHint: STR.refPickerDisclosureHintSocial,
            }
          : {})}
      />
    </FormCard>
  );
}
