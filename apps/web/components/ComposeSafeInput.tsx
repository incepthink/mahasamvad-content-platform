'use client';

// A text box whose text belongs to the DOM, not to React.
//
// WHY THIS EXISTS. A controlled input (`value` + `onChange`) makes React the owner of the
// text: after every change event React writes its own copy of the string back onto the DOM
// node. With one key press per character and a human pause between them that round trip
// always wins the race. Marathi typing is not that shape.
//
// An InScript keyboard (ISM V6, or Windows' own Marathi layout) assembles a character in
// STAGES and delivers them through the Windows Text Services Framework, which Chrome surfaces
// to the page as a COMPOSITION: compositionstart -> compositionupdate... -> compositionend,
// with `input` events carrying `isComposing: true`. React deliberately suppresses `onChange`
// for those (ChangeEventPlugin tracks isComposing), so our state never advances — and then
// React's restoreControlledState writes the STALE value back over the node, erasing the
// character the officer just typed. Reported from the field as "I pressed ब and nothing
// appeared", with a character count higher than the visible text because partial commits
// survive. Upstream: facebook/react#8683, #27135, #18971, #955.
//
// THE FIX. Render `defaultValue`, never `value`. React then writes the node exactly once, on
// mount, and after that the browser owns the text — so there is nothing for React to erase,
// composing or not, fast or slow. We only report OUT (onChange), and only write back IN when
// the caller genuinely replaces the value from elsewhere (a restored draft, an OCR re-read, a
// cleared composer). That write is guarded twice: it is skipped for any value we ourselves
// reported, and it never interrupts a composition in flight.
//
// The props are the controlled ones on purpose — `value` + `onChange(next: string)` — so a
// call site converts by changing the tag name and nothing else. `value` means "the text this
// field should hold if something other than typing changed it", which is what every caller
// here was already passing.
//
// Also exported: `isComposingEvent`, for key handlers. A composing IME uses Enter to COMMIT
// the word, so any "Enter submits" handler must ignore that keystroke or it fires mid-word.

import {
  useCallback,
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type CompositionEvent,
  type KeyboardEvent,
} from 'react';

/** True while an IME is mid-word, when Enter/Escape belong to the keyboard, not to us. */
export function isComposingEvent(event: KeyboardEvent<HTMLElement>): boolean {
  // React's SyntheticEvent does not carry isComposing; the native event does. Keydown 229 is
  // the legacy signal browsers send for "this key is the IME's", and Safari still relies on it.
  const native = event.nativeEvent as globalThis.KeyboardEvent;
  return native.isComposing || native.keyCode === 229;
}

type Handlers<T> = {
  value: string;
  onChange: (next: string) => void;
  // Explicitly `| undefined`: the workspace runs exactOptionalPropertyTypes, so a caller
  // spreading an absent handler through would not otherwise assign.
  onCompositionStart?: ((event: CompositionEvent<T>) => void) | undefined;
  onCompositionEnd?: ((event: CompositionEvent<T>) => void) | undefined;
};

/**
 * The shared behaviour: hand back the props that make an element uncontrolled and
 * composition-safe. Kept as a hook so <textarea> and <input> cannot drift apart.
 */
function useComposeSafe<T extends HTMLTextAreaElement | HTMLInputElement>({
  value,
  onChange,
  onCompositionStart,
  onCompositionEnd,
}: Handlers<T>) {
  const ref = useRef<T>(null);
  const composing = useRef(false);
  // The last string we handed to the caller. Anything else arriving on `value` came from
  // somewhere other than this keyboard, and is the only case worth touching the DOM for.
  const reported = useRef(value);
  // defaultValue is read once, at mount; keeping the mount value in a ref stops a later
  // re-render from re-seeding the node through React's own defaultValue handling.
  const initial = useRef(value);

  const report = useCallback(
    (next: string) => {
      reported.current = next;
      onChange(next);
    },
    [onChange],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Our own text coming back around: writing it would be a no-op at best and a caret jump
    // at worst.
    if (value === reported.current) return;
    // Never overwrite a half-assembled character. The composition will report its own final
    // text on compositionend, and the caller's value is stale by definition while it runs.
    if (composing.current) return;
    reported.current = value;
    el.value = value;
  }, [value]);

  return {
    ref,
    defaultValue: initial.current,
    onChange: (event: { target: T }) => {
      // Chrome fires `input` with isComposing:true throughout a composition. Reporting those
      // intermediate strings is harmless (we never write back), and it keeps character
      // counters live while the officer types.
      report(event.target.value);
    },
    onCompositionStart: (event: CompositionEvent<T>) => {
      composing.current = true;
      onCompositionStart?.(event);
    },
    onCompositionEnd: (event: CompositionEvent<T>) => {
      composing.current = false;
      // Safari fires compositionend AFTER the final input event, Chrome before it. Reporting
      // here covers the browsers that would otherwise leave the last character unreported.
      report(event.currentTarget.value);
      onCompositionEnd?.(event);
    },
  };
}

type TextareaProps = Omit<
  ComponentPropsWithoutRef<'textarea'>,
  'value' | 'defaultValue' | 'onChange'
> & {
  value: string;
  onChange: (next: string) => void;
};

export function ComposeSafeTextarea({
  value,
  onChange,
  onCompositionStart,
  onCompositionEnd,
  ...rest
}: TextareaProps) {
  const safe = useComposeSafe<HTMLTextAreaElement>({
    value,
    onChange,
    onCompositionStart,
    onCompositionEnd,
  });
  return <textarea {...rest} {...safe} />;
}

type InputProps = Omit<
  ComponentPropsWithoutRef<'input'>,
  'value' | 'defaultValue' | 'onChange'
> & {
  value: string;
  onChange: (next: string) => void;
};

export function ComposeSafeInput({
  value,
  onChange,
  onCompositionStart,
  onCompositionEnd,
  ...rest
}: InputProps) {
  const safe = useComposeSafe<HTMLInputElement>({
    value,
    onChange,
    onCompositionStart,
    onCompositionEnd,
  });
  return <input {...rest} {...safe} />;
}
