'use client';

// Poster text editor: one hand-written branch per post_type (5 fixed shapes are
// simpler and clearer in Marathi than a schema-driven generic form). scene_brief
// is never shown here — background changes go through the separate "चित्र बदला"
// feedback path, so a text edit here can never silently change the picture.

import { useState } from 'react';
import type { Copy } from '@dgipr/schemas';
import { STR } from '../lib/strings';

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="copy-field">
      <label>{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function ListEditor<T>({
  label,
  items,
  makeEmpty,
  renderRow,
  onChange,
}: {
  label: string;
  items: T[];
  makeEmpty: () => T;
  renderRow: (item: T, update: (next: T) => void) => React.ReactNode;
  onChange: (items: T[]) => void;
}) {
  return (
    <div className="copy-field">
      <label>{label}</label>
      <div className="copy-list">
        {items.map((item, index) => (
          <div className="copy-list-row" key={index}>
            <div style={{ flex: 1 }}>
              {renderRow(item, (next) => {
                const copy = items.slice();
                copy[index] = next;
                onChange(copy);
              })}
            </div>
            <button
              type="button"
              className="btn btn-remove"
              aria-label="काढा"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-small"
        style={{ marginTop: 8 }}
        onClick={() => onChange([...items, makeEmpty()])}
      >
        + जोडा
      </button>
    </div>
  );
}

type Bullet = { text: string; emphasis?: string[] | undefined };

function BulletListEditor({
  bullets,
  onChange,
}: {
  bullets: Bullet[];
  onChange: (bullets: Bullet[]) => void;
}) {
  return (
    <ListEditor<Bullet>
      label="मुद्दे"
      items={bullets}
      makeEmpty={() => ({ text: '' })}
      onChange={onChange}
      renderRow={(item, update) => (
        <input
          type="text"
          value={item.text}
          onChange={(e) => update({ ...item, text: e.target.value })}
        />
      )}
    />
  );
}

export function CopyEditForm({
  copy,
  onSave,
}: {
  copy: Copy;
  onSave: (copy: Copy) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Copy>(copy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Copy is a discriminated union, so keyof Copy only covers fields common to
  // every post_type (post_type, headline, scene_brief) — the per-type fields
  // below (kicker, bullets, stats, …) are patched loosely and re-validated by
  // CopySchema on the server when the edit is saved.
  const set = (fields: Record<string, unknown>) => {
    setDraft((prev) => ({ ...prev, ...fields }) as Copy);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : STR.genericError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="copy-form">
      {'kicker' in draft ? (
        <TextField
          label="किकर (लहान लेबल)"
          value={draft.kicker ?? ''}
          onChange={(v) => set({ kicker: v || undefined })}
        />
      ) : null}

      {draft.post_type !== 'quote' ? (
        <TextField
          label="शीर्षक"
          value={draft.headline ?? ''}
          onChange={(v) => set({ headline: v })}
        />
      ) : (
        <TextField
          label="शीर्षक (ऐच्छिक)"
          value={draft.headline ?? ''}
          onChange={(v) => set({ headline: v || undefined })}
        />
      )}

      {'subhead' in draft ? (
        <TextField
          label="उपशीर्षक"
          value={draft.subhead ?? ''}
          onChange={(v) => set({ subhead: v || undefined })}
        />
      ) : null}

      {draft.post_type === 'alert' && (
        <BulletListEditor
          bullets={draft.bullets}
          onChange={(bullets) => set({ bullets })}
        />
      )}
      {draft.post_type === 'info_bullets' && (
        <BulletListEditor
          bullets={draft.bullets}
          onChange={(bullets) => set({ bullets })}
        />
      )}

      {draft.post_type === 'campaign' && (
        <>
          <TextField
            label="तारीख"
            value={draft.schedule?.date ?? ''}
            onChange={(v) =>
              set({ schedule: { ...draft.schedule, date: v || undefined } })
            }
          />
          <TextField
            label="वेळ"
            value={draft.schedule?.time ?? ''}
            onChange={(v) =>
              set({ schedule: { ...draft.schedule, time: v || undefined } })
            }
          />
          <TextField
            label="लक्ष्य गट (audience)"
            value={draft.audience ?? ''}
            onChange={(v) => set({ audience: v || undefined })}
          />
          <TextField
            label="कृती (CTA)"
            value={draft.cta ?? ''}
            onChange={(v) => set({ cta: v || undefined })}
          />
          <ListEditor
            label="आकडेवारी"
            items={draft.stats ?? []}
            makeEmpty={() => ({ value: '', label: '', icon_hint: 'info' })}
            onChange={(stats) => set({ stats })}
            renderRow={(item, update) => (
              <div className="btn-row" style={{ gap: 8 }}>
                <input
                  type="text"
                  placeholder="आकडा"
                  value={item.value}
                  onChange={(e) => update({ ...item, value: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="लेबल"
                  value={item.label}
                  onChange={(e) => update({ ...item, label: e.target.value })}
                />
              </div>
            )}
          />
        </>
      )}

      {draft.post_type === 'quote' && (
        <>
          <TextField
            label="विषय लेबल"
            value={draft.topic_label ?? ''}
            onChange={(v) => set({ topic_label: v || undefined })}
          />
          <div className="copy-field">
            <label>अवतरण मजकूर</label>
            <textarea
              rows={3}
              value={draft.quote_text}
              onChange={(e) => set({ quote_text: e.target.value })}
            />
          </div>
          <TextField
            label="व्यक्तीचे नाव"
            value={draft.attribution?.name ?? ''}
            onChange={(v) =>
              set({ attribution: { ...draft.attribution, name: v || undefined } })
            }
          />
          <TextField
            label="पदनाम"
            value={draft.attribution?.title ?? ''}
            onChange={(v) =>
              set({
                attribution: { ...draft.attribution, title: v || undefined },
              })
            }
          />
          <ListEditor
            label="मुद्दे"
            items={draft.points ?? []}
            makeEmpty={() => ({ text: '', icon_hint: 'info' })}
            onChange={(points) => set({ points })}
            renderRow={(item, update) => (
              <input
                type="text"
                value={item.text}
                onChange={(e) => update({ ...item, text: e.target.value })}
              />
            )}
          />
        </>
      )}

      {draft.post_type === 'timeline' && (
        <>
          <TextField
            label="बाजू लेबल"
            value={draft.side_label ?? ''}
            onChange={(v) => set({ side_label: v || undefined })}
          />
          <TextField
            label="परिचय"
            value={draft.intro ?? ''}
            onChange={(v) => set({ intro: v || undefined })}
          />
          <ListEditor
            label="टप्पे"
            items={draft.milestones}
            makeEmpty={() => ({ date: '', text: '' })}
            onChange={(milestones) => set({ milestones })}
            renderRow={(item, update) => (
              <div className="btn-row" style={{ gap: 8 }}>
                <input
                  type="text"
                  placeholder="तारीख"
                  style={{ maxWidth: 140 }}
                  value={item.date}
                  onChange={(e) => update({ ...item, date: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="मजकूर"
                  value={item.text}
                  onChange={(e) => update({ ...item, text: e.target.value })}
                />
              </div>
            )}
          />
        </>
      )}

      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={saving}
        >
          {saving ? STR.rerendering : STR.rerender}
        </button>
      </div>
      {saved ? <p className="form-success">{STR.rerenderDone}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
