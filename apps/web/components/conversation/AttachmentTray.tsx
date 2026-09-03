'use client';

// What is attached, under the composer — shared by BOTH conversation surfaces (/chat and
// /new-video-workflow), like the rail and the workspace shell beside it. Neither page knows
// what the other attaches; everything surface-specific arrives as a prop.
//
// A PICTURE IS ITS OWN LABEL, which is the whole reason this exists. Both surfaces used to
// render a picked photograph as a chip — a 34px thumbnail, then `IMG_20260811_1032.jpg`
// trimmed to a stub, then the word "तयार" — so three quarters of the chip repeated in text
// what the officer could already see, while the part that actually identifies the file was
// the smallest thing on the row. So an item with a preview is drawn as a TILE: the picture
// at a size you can recognise a room or a person in, and nothing else. Its name and its
// state stay in the tooltip and in the accessibility tree, where they cost no space.
//
// PROGRESS IS A SPINNER OVER THE PICTURE, not a word beside it. An upload is a few seconds
// and its own tile is the only place the officer is looking; a failure keeps a word, because
// "this one did not work" is not something a dimmed thumbnail can say on its own.
//
// Anything a thumbnail CANNOT identify — a PDF, a recording, a link — stays a chip with its
// icon, its name and its state. That is not an inconsistency: a document's name is the only
// thing distinguishing it from the next document, and there is no picture to put in its place.

import { AlertTriangle, Paperclip, X, type LucideIcon } from 'lucide-react';
import { FileName } from '../FileName';

export type TrayAttachment = Readonly<{
  // Stable across renders and unique within one tray — a name is not, since two phone
  // photographs both arrive called IMG_0001.jpg.
  key: string;
  name: string;
  // A local object URL. Present ⇒ this item is drawn as a picture rather than as a chip.
  previewUrl?: string | undefined;
  // The chip's mark. Ignored by a tile, which shows the picture instead.
  icon?: LucideIcon | undefined;
  // Marathi: what is happening to this file. The chip's second line, and the tile's tooltip.
  status: string;
  busy?: boolean | undefined;
  ready?: boolean | undefined;
  failed?: boolean | undefined;
  removeLabel: string;
  onRemove: () => void;
}>;

export function AttachmentTray({
  items,
}: {
  items: readonly TrayAttachment[];
}) {
  if (items.length === 0) return null;

  return (
    <ul className="chat-tray">
      {items.map((item) =>
        item.previewUrl !== undefined ? (
          <TrayTile key={item.key} item={item} />
        ) : (
          <TrayChip key={item.key} item={item} />
        ),
      )}
    </ul>
  );
}

function TrayTile({ item }: { item: TrayAttachment }) {
  const { name, previewUrl, status, busy = false, failed = false } = item;

  return (
    <li
      className={`chat-tray-tile${failed ? ' is-failed' : ''}`}
      // Hover tells you which file this is and how it is doing, without either taking a
      // line of the composer.
      title={`${name} — ${status}`}
    >
      {/* A plain <img> over an object URL: the file is in this browser and has no remote
          URL, so next/image could only wrap it in a loader that cannot optimise it. The alt
          is empty because the visually-hidden line below carries the name AND the state —
          two labels for one tile would be read twice. */}
      <img src={previewUrl} alt="" className="chat-tray-image" />

      {busy ? (
        <span className="chat-tray-veil" aria-hidden="true">
          <span className="spinner" />
        </span>
      ) : null}
      {failed ? (
        <span className="chat-tray-veil is-failed" aria-hidden="true">
          <AlertTriangle size={20} />
        </span>
      ) : null}

      <span
        className="visually-hidden"
        // The line changes while an upload runs, so only a busy tile announces itself.
        {...(busy ? { 'aria-live': 'polite' as const } : {})}
      >
        {`${name} — ${status}`}
      </span>

      <button
        type="button"
        className="chat-tray-remove chat-tray-tile-remove"
        onClick={item.onRemove}
        // Named, because a tray of four thumbnails otherwise offers four buttons that read
        // identically to a screen reader.
        aria-label={`${item.removeLabel}: ${name}`}
        title={item.removeLabel}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

function TrayChip({ item }: { item: TrayAttachment }) {
  const {
    name,
    icon: Icon = Paperclip,
    status,
    ready = false,
    failed = false,
  } = item;

  // Status as text AND colour, never colour alone (see the top of globals.css).
  const tone = failed ? ' is-failed' : ready ? ' is-ready' : '';

  return (
    <li className={`chat-tray-item${tone}`}>
      <Icon size={16} aria-hidden="true" />
      <FileName name={name} className="chat-tray-name" max={28} />
      <span className="chat-tray-state">{status}</span>
      <button
        type="button"
        className="chat-tray-remove"
        onClick={item.onRemove}
        aria-label={item.removeLabel}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </li>
  );
}
