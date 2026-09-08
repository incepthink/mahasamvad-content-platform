'use client';

// "Use only this part of the recording" — the modal behind an audio card in the composer.
//
// WHAT IT IS FOR. A meeting recording is one file and the news is usually a few minutes of it.
// Until now the whole thing went to the transcriber, so an officer paid for two hours of speech
// to read four minutes of it and then had to find those four minutes inside the transcript. The
// window they pick here is carried with the upload and cut with ffmpeg before the recording
// reaches the provider (apps/api/src/jobs/audio-trim.ts) — the ORIGINAL is always what is
// archived, so a trim is a reading of the recording and never an edit to it.
//
// THE DIALOG OPENS BEFORE THE RECORDING HAS BEEN READ. Two things are needed to draw it and
// they cost wildly different amounts: the DURATION is free (an <audio> element reports it from
// a header) and the WAVEFORM needs the file decoded to PCM, which for a long recording is not
// worth attempting at all. So the duration is awaited, the waveform arrives later or not at
// all, and everything except the picture works either way. See lib/audioWaveform.ts.
//
// IT IS EDITED, THEN COMMITTED. The window lives in local state until "वापरा" is pressed, so
// Escape and the close button genuinely cancel — the composer's card is not quietly rewritten
// by a dialog somebody opened to look at. That is the one behavioural difference from
// MotionCropBox, which edits a value the page already owns.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Scissors } from 'lucide-react';
import {
  AUDIO_TRIM_MIN_SECONDS,
  formatTimecode,
  type AudioTrim,
} from '@dgipr/schemas';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FileName } from '@/components/FileName';
import {
  AudioTrimRange,
  clampWindow,
  type TrimWindow,
} from '@/components/common/AudioTrimRange';
import { readAudioDuration, readAudioPeaks } from '@/lib/audioWaveform';
import { STR } from '@/lib/strings';

export function AudioTrimDialog({
  file,
  trim,
  open,
  onOpenChange,
  onApply,
}: {
  // Null while nothing is being trimmed. The dialog is mounted by the composer and told which
  // recording it is about, so opening it does not remount the media element every time.
  file: File | null;
  // The window already stored for this recording, if it has been trimmed before.
  trim: AudioTrim | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // `null` means "use the whole recording" — what the reset action commits.
  onApply: (trim: AudioTrim | null) => void;
}) {
  const [duration, setDuration] = useState<number | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [loading, setLoading] = useState(false);
  const [window_, setWindow] = useState<TrimWindow | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState<number | null>(null);

  const audio = useRef<HTMLAudioElement | null>(null);
  // STATE, not a ref: the <audio> element's src is rendered from it, and a ref assignment
  // would set the URL without ever telling React to put it on the element — playback would
  // then silently do nothing.
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);

  // Read the recording when the dialog opens on one. Everything is guarded by `cancelled`
  // rather than left to resolve into a closed dialog: a decode of a large file outlives the
  // officer changing their mind, and setting state after that would put one recording's
  // waveform under another's name.
  useEffect(() => {
    if (!open || file === null) return;
    let cancelled = false;
    const controller = new AbortController();

    setLoading(true);
    setDuration(null);
    setPeaks(null);
    setPlayhead(null);

    const url = URL.createObjectURL(file);
    setMediaUrl(url);

    void (async () => {
      const seconds = await readAudioDuration(file);
      if (cancelled) return;
      setDuration(seconds);
      setLoading(false);
      // Seed the handles: the stored window if there is one, otherwise the whole recording,
      // which is what the officer is currently getting and therefore the honest starting point.
      if (seconds !== null) {
        setWindow(
          clampWindow(
            trim === null
              ? { startSeconds: 0, endSeconds: seconds }
              : {
                  startSeconds: trim.startSeconds,
                  endSeconds: trim.endSeconds,
                },
            seconds,
          ),
        );
      }
      // The picture, after the slider is already usable — and best-effort, so a recording too
      // large to decode simply never gets one.
      const bars = await readAudioPeaks(file, controller.signal);
      if (!cancelled) setPeaks(bars);
    })();

    return () => {
      cancelled = true;
      controller.abort();
      URL.revokeObjectURL(url);
      setMediaUrl(null);
    };
    // `trim` is deliberately not a dependency: it SEEDS the handles when the dialog opens and
    // must not reset them under the officer's hand if the composer's copy changes meanwhile.
  }, [open, file]);

  // Stop playback whenever the dialog closes. Without this the recording keeps playing behind
  // a form the officer has moved on from, with no visible control to stop it.
  useEffect(() => {
    if (open) return;
    audio.current?.pause();
    setPlaying(false);
    setPlayhead(null);
  }, [open]);

  const durationKnown = duration !== null && duration > 0;
  // A recording shorter than the shortest selectable window has nothing to choose inside it.
  const trimmable = durationKnown && duration >= AUDIO_TRIM_MIN_SECONDS * 2;

  const selection = window_;
  const selectedSeconds = useMemo(
    () =>
      selection === null
        ? 0
        : Math.max(0, selection.endSeconds - selection.startSeconds),
    [selection],
  );
  // Whether "वापरा" would actually change anything — the whole recording selected is what the
  // officer already has, so committing it stores nothing and the button says so.
  const isWholeRecording =
    selection !== null &&
    duration !== null &&
    selection.startSeconds <= 0.05 &&
    selection.endSeconds >= duration - 0.05;

  const play = (): void => {
    const element = audio.current;
    if (element === null || selection === null) return;
    // Always start from the window's own beginning: the point of pressing play here is to hear
    // what was selected, not to resume wherever the last press left off.
    element.currentTime = selection.startSeconds;
    void element.play().catch(() => setPlaying(false));
  };

  const pause = (): void => {
    audio.current?.pause();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={STR.audioTrimClose}
        // The waveform is the widest thing in the product and benefits from every pixel.
        className="max-w-3xl"
        // Radix moves focus to the first focusable child, which here is a slider handle — so
        // an officer who opened this with the keyboard would be holding an edge of the window
        // before reading what the dialog is. Focus goes to the dialog itself instead.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{STR.audioTrimTitle}</DialogTitle>
          <DialogDescription>
            {file ? (
              <FileName name={file.name} className="font-medium" max={44} />
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            {STR.audioTrimReading}
          </p>
        ) : !trimmable ? (
          // Either the browser could not read the container at all, or the recording is too
          // short to have a part. Said plainly rather than shown as a broken slider.
          <p className="text-muted-foreground py-10 text-center text-sm">
            {durationKnown ? STR.audioTrimTooShort : STR.audioTrimUnreadable}
          </p>
        ) : selection === null || duration === null ? null : (
          <div className="flex flex-col gap-3">
            <AudioTrimRange
              value={selection}
              durationSeconds={duration}
              onChange={setWindow}
              peaks={peaks}
              playheadSeconds={playing ? playhead : null}
              onScrub={(seconds) => {
                if (audio.current !== null) audio.current.currentTime = seconds;
                setPlayhead(seconds);
              }}
            />

            {/* The ruler. Three fixed marks rather than a tick per minute: the numbers that
                matter are the two ENDS (so the officer knows what they are looking at) and
                the middle (so the scale reads as linear). More would compete with the
                timecodes below, which are the ones being edited. */}
            <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
              <span>{formatTimecode(0)}</span>
              <span>{formatTimecode(duration / 2)}</span>
              <span>{formatTimecode(duration)}</span>
            </div>

            {/* What is selected, in words. The two edges plus the LENGTH — the length is the
                number an officer is actually reasoning about ("about four minutes"), and it
                is the one thing neither handle shows. */}
            <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2">
              <div className="flex items-baseline gap-2 tabular-nums">
                <span className="text-base font-semibold">
                  {formatTimecode(selection.startSeconds)}
                </span>
                <span className="text-muted-foreground" aria-hidden="true">
                  &ndash;
                </span>
                <span className="text-base font-semibold">
                  {formatTimecode(selection.endSeconds)}
                </span>
              </div>
              <span className="text-muted-foreground text-sm">
                {STR.audioTrimSelected}{' '}
                <span className="text-foreground font-medium tabular-nums">
                  {formatTimecode(selectedSeconds)}
                </span>
                <span className="text-muted-foreground/80">
                  {' '}
                  / {formatTimecode(duration)}
                </span>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={playing ? pause : play}
              >
                {playing ? (
                  <Pause className="size-4" aria-hidden="true" />
                ) : (
                  <Play className="size-4" aria-hidden="true" />
                )}
                {playing ? STR.audioTrimPause : STR.audioTrimPlay}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isWholeRecording}
                onClick={() =>
                  setWindow({ startSeconds: 0, endSeconds: duration })
                }
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                {STR.audioTrimWhole}
              </Button>
              <p className="text-muted-foreground ms-auto hidden text-xs sm:block">
                {STR.audioTrimHint}
              </p>
            </div>

            {/* Playback drives the playhead and stops itself at the window's far edge, so
                pressing play auditions the SELECTION rather than the rest of the meeting. */}
            <audio
              ref={audio}
              src={mediaUrl ?? undefined}
              preload="metadata"
              className="sr-only"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onTimeUpdate={(event) => {
                const element = event.currentTarget;
                setPlayhead(element.currentTime);
                if (element.currentTime >= selection.endSeconds) {
                  element.pause();
                }
              }}
            />
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {STR.audioTrimCancel}
          </Button>
          <Button
            type="button"
            disabled={selection === null || !trimmable}
            onClick={() => {
              if (selection === null || duration === null) return;
              onApply(
                isWholeRecording
                  ? null
                  : {
                      startSeconds: selection.startSeconds,
                      endSeconds: selection.endSeconds,
                      durationSeconds: duration,
                    },
              );
              onOpenChange(false);
            }}
          >
            <Scissors className="size-4" aria-hidden="true" />
            {isWholeRecording ? STR.audioTrimUseWhole : STR.audioTrimApply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
