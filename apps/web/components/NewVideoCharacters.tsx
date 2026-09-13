'use client';

// The character & voice registry for /new-video-workflow (migration 0054) — this product's
// answer to Flow's saved "Ingredients".
//
// WHAT IT IS FOR, because the shape follows from it. Officers reported that characters and
// their voices drift "when chats are switched". A new chat in the Gemini app carries nothing
// over: consistency there comes from the user re-supplying the same portrait and the same
// description by hand. So the fix is a stored entry a FRESH conversation can be seeded from
// in one tap — which is why this list is department-wide and outlives any conversation, and
// why the picker is the same panel as the editor rather than a separate screen.
//
// Two things it deliberately is not. It is not a per-conversation setting: the cast is set on
// a conversation's first turn and fixed after it, because a character's portrait is attached
// on the turn that establishes them and stacking a new reference into the middle of an edit
// chain is a documented failure mode — so the panel explains that rather than greying a
// control out silently. And it is not a place to manage rendered videos: deleting a character
// removes them from future turns, never from a video already paid for.
//
// A portrait is uploaded through the SAME route a turn's reference picture uses, so the
// browser only ever hands the API an id it minted.

import { useCallback, useEffect, useId, useState } from 'react';
import { ImagePlus, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  NEW_VIDEO_CHARACTER_APPEARANCE_MAX_CHARS,
  NEW_VIDEO_CHARACTER_NAME_MAX_CHARS,
  NEW_VIDEO_CHARACTER_VOICE_MAX_CHARS,
  NEW_VIDEO_IMAGE_ACCEPT,
  NEW_VIDEO_MAX_CAST,
  type NewVideoCharacter,
} from '@dgipr/schemas';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { ErrorNotice } from './ErrorNotice';
import { FileName } from './FileName';
import {
  createNewVideoCharacter,
  deleteNewVideoCharacter,
  listNewVideoCharacters,
  updateNewVideoCharacter,
  uploadNewVideoImage,
} from '../lib/api';
import { errorMessage } from '../lib/errorMessage';
import { STR } from '../lib/strings';

type Draft = {
  id: string | null;
  name: string;
  appearance: string;
  voice: string;
  // The upload's own id, or null. `portraitUrl` is what the preview shows; on an edit it
  // starts as the stored one, and a cleared portrait is the two of them going to null
  // together — which is what the PATCH sends as an explicit `portraitImageId: null`.
  portraitImageId: string | null;
  portraitUrl: string | null;
  portraitTouched: boolean;
  portraitName: string;
};

const BLANK: Draft = {
  id: null,
  name: '',
  appearance: '',
  voice: '',
  portraitImageId: null,
  portraitUrl: null,
  portraitTouched: false,
  portraitName: '',
};

export function NewVideoCharacters({
  open,
  onOpenChange,
  selectedIds,
  onSelectedIdsChange,
  // The cast is fixed once the conversation has a video to edit. The registry itself stays
  // fully editable — an officer may be tidying it up while a conversation is under way.
  castLocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: readonly string[];
  onSelectedIdsChange: (ids: readonly string[]) => void;
  castLocked: boolean;
}) {
  const [characters, setCharacters] = useState<NewVideoCharacter[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // One panel can be mounted per page, but a fixed id would still tie a label to whichever
  // input rendered first if that ever stopped being true — the PageRangeSelector lesson.
  const fieldId = useId();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setCharacters(await listNewVideoCharacters());
      setListError(null);
    } catch (e) {
      setListError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetched when the panel opens rather than on mount: the registry is a list an officer asks
  // for, and every conversation page would otherwise fetch it whether or not it is used.
  useEffect(() => {
    if (!open) return;
    void refresh();
    setDraft(null);
    setFormError(null);
  }, [open, refresh]);

  const full = selectedIds.length >= NEW_VIDEO_MAX_CAST;

  const toggle = (id: string) => {
    if (castLocked) return;
    if (selectedIds.includes(id)) {
      onSelectedIdsChange(selectedIds.filter((current) => current !== id));
      return;
    }
    if (full) return;
    // Appended rather than inserted: the order a cast is picked in is the order its portraits
    // are attached in, so the list the officer sees is the list the model is handed.
    onSelectedIdsChange([...selectedIds, id]);
  };

  const pickPortrait = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setFormError(null);
    try {
      const uploaded = await uploadNewVideoImage(file);
      setDraft((current) =>
        current === null
          ? current
          : {
              ...current,
              portraitImageId: uploaded.id,
              portraitUrl: uploaded.url,
              portraitTouched: true,
              portraitName: uploaded.name,
            },
      );
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (draft === null) return;
    const name = draft.name.trim();
    if (name === '') {
      setFormError(STR.nvwCharacterNameRequired);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (draft.id === null) {
        const created = await createNewVideoCharacter({
          name,
          appearance: draft.appearance,
          voice: draft.voice,
          ...(draft.portraitImageId !== null
            ? { portraitImageId: draft.portraitImageId }
            : {}),
        });
        setCharacters((prev) => [created, ...prev]);
        // Picked straight away: an officer who has just described a character wants them in
        // the video they are about to ask for.
        if (!castLocked && selectedIds.length < NEW_VIDEO_MAX_CAST) {
          onSelectedIdsChange([...selectedIds, created.id]);
        }
      } else {
        const updated = await updateNewVideoCharacter(draft.id, {
          name,
          appearance: draft.appearance,
          voice: draft.voice,
          // Only sent when it actually changed. Omitting the field leaves the stored portrait
          // alone; sending null would DETACH it, which an edit to the voice must never do.
          ...(draft.portraitTouched
            ? { portraitImageId: draft.portraitImageId }
            : {}),
        });
        setCharacters((prev) =>
          prev.map((character) =>
            character.id === updated.id ? updated : character,
          ),
        );
      }
      setDraft(null);
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (character: NewVideoCharacter) => {
    if (!window.confirm(STR.nvwCharacterDeleteConfirm)) return;
    try {
      await deleteNewVideoCharacter(character.id);
      setCharacters((prev) =>
        prev.filter((current) => current.id !== character.id),
      );
      onSelectedIdsChange(
        selectedIds.filter((current) => current !== character.id),
      );
    } catch (e) {
      setListError(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="nvw-cast-dialog">
        <DialogHeader>
          <DialogTitle>{STR.nvwCharactersTitle}</DialogTitle>
          <DialogDescription>{STR.nvwCharactersIntro}</DialogDescription>
        </DialogHeader>

        {castLocked ? (
          <p className="info-callout">{STR.nvwCastLocked}</p>
        ) : null}

        {listError !== null ? (
          <ErrorNotice
            message={listError}
            fallback={STR.nvwCharactersFailed}
            onRetry={() => void refresh()}
          />
        ) : null}

        {loading && characters.length === 0 ? (
          <p className="chat-loading" role="status">
            <span className="spinner" aria-hidden="true" />
          </p>
        ) : null}

        {!loading && characters.length === 0 && listError === null ? (
          <p className="hint">{STR.nvwCharactersEmpty}</p>
        ) : null}

        {characters.length > 0 ? (
          <ul className="nvw-cast-list">
            {characters.map((character) => {
              const picked = selectedIds.includes(character.id);
              const pickDisabled = castLocked || (!picked && full);
              return (
                <li key={character.id} className="nvw-cast-row">
                  {/* A plain <img>, like every other remote image in this app: the source
                      is a runtime bucket URL, not a build-time asset. It is decoration
                      beside a name that is already text, so the alt is empty rather than
                      repeating that name to a screen reader. */}
                  {character.portraitUrl !== null ? (
                    <img
                      className="nvw-cast-portrait"
                      src={character.portraitUrl}
                      alt=""
                    />
                  ) : (
                    <span
                      className="nvw-cast-portrait is-empty"
                      aria-hidden="true"
                    />
                  )}

                  <div className="nvw-cast-body">
                    <p className="nvw-cast-name">{character.name}</p>
                    {character.appearance !== '' ? (
                      <p className="nvw-cast-line">{character.appearance}</p>
                    ) : null}
                    {character.voice !== '' ? (
                      <p className="nvw-cast-line">
                        <strong>{STR.nvwCharacterVoice}:</strong>{' '}
                        {character.voice}
                      </p>
                    ) : null}
                  </div>

                  <div className="nvw-cast-actions">
                    <label className="nvw-cast-pick">
                      <input
                        type="checkbox"
                        checked={picked}
                        disabled={pickDisabled}
                        onChange={() => toggle(character.id)}
                      />
                      <span>{STR.nvwCastPick}</span>
                    </label>
                    <button
                      type="button"
                      className="btn-ghost icon-btn"
                      title={STR.nvwCharacterEdit}
                      aria-label={`${STR.nvwCharacterEdit}: ${character.name}`}
                      onClick={() =>
                        setDraft({
                          id: character.id,
                          name: character.name,
                          appearance: character.appearance,
                          voice: character.voice,
                          portraitImageId: null,
                          portraitUrl: character.portraitUrl,
                          portraitTouched: false,
                          portraitName: '',
                        })
                      }
                    >
                      <Pencil size={17} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost icon-btn"
                      title={STR.nvwCharacterDelete}
                      aria-label={`${STR.nvwCharacterDelete}: ${character.name}`}
                      onClick={() => void remove(character)}
                    >
                      <Trash2 size={17} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        {!castLocked && full ? <p className="hint">{STR.nvwCastFull}</p> : null}

        {draft === null ? (
          <div className="nvw-cast-foot">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setFormError(null);
                setDraft(BLANK);
              }}
            >
              <Plus size={18} aria-hidden="true" />
              {STR.nvwCharacterAdd}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={() => onOpenChange(false)}
            >
              {STR.nvwCastDone}
            </button>
          </div>
        ) : (
          <div className="nvw-cast-form">
            <label className="field-label" htmlFor={`${fieldId}-name`}>
              {STR.nvwCharacterName}
            </label>
            <input
              id={`${fieldId}-name`}
              type="text"
              value={draft.name}
              maxLength={NEW_VIDEO_CHARACTER_NAME_MAX_CHARS}
              placeholder={STR.nvwCharacterNamePlaceholder}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />

            <label className="field-label" htmlFor={`${fieldId}-appearance`}>
              {STR.nvwCharacterAppearance}
            </label>
            <textarea
              id={`${fieldId}-appearance`}
              rows={2}
              value={draft.appearance}
              maxLength={NEW_VIDEO_CHARACTER_APPEARANCE_MAX_CHARS}
              placeholder={STR.nvwCharacterAppearancePlaceholder}
              onChange={(event) =>
                setDraft({ ...draft, appearance: event.target.value })
              }
            />

            <label className="field-label" htmlFor={`${fieldId}-voice`}>
              {STR.nvwCharacterVoice}
            </label>
            <textarea
              id={`${fieldId}-voice`}
              rows={2}
              value={draft.voice}
              maxLength={NEW_VIDEO_CHARACTER_VOICE_MAX_CHARS}
              placeholder={STR.nvwCharacterVoicePlaceholder}
              onChange={(event) =>
                setDraft({ ...draft, voice: event.target.value })
              }
            />
            <p className="hint">{STR.nvwCharacterVoiceHint}</p>

            <div>
              <p className="field-label">{STR.nvwCharacterPortrait}</p>
              <div className="nvw-cast-portrait-row">
                {draft.portraitUrl !== null ? (
                  <img
                    className="nvw-cast-portrait"
                    src={draft.portraitUrl}
                    alt=""
                  />
                ) : (
                  <span
                    className="nvw-cast-portrait is-empty"
                    aria-hidden="true"
                  />
                )}
                <label className="btn nvw-cast-upload">
                  {uploading ? (
                    <span className="spinner" aria-hidden="true" />
                  ) : (
                    <ImagePlus size={18} aria-hidden="true" />
                  )}
                  {STR.nvwCharacterPortraitAdd}
                  <input
                    type="file"
                    accept={NEW_VIDEO_IMAGE_ACCEPT}
                    hidden
                    onChange={(event) => {
                      void pickPortrait(event.target.files?.[0]);
                      event.target.value = '';
                    }}
                  />
                </label>
                {draft.portraitUrl !== null ? (
                  <button
                    type="button"
                    className="btn-ghost icon-btn"
                    title={STR.nvwCharacterPortraitRemove}
                    aria-label={STR.nvwCharacterPortraitRemove}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        portraitImageId: null,
                        portraitUrl: null,
                        portraitTouched: true,
                        portraitName: '',
                      })
                    }
                  >
                    <X size={17} aria-hidden="true" />
                  </button>
                ) : null}
                {draft.portraitName !== '' ? (
                  <FileName name={draft.portraitName} className="file-name" />
                ) : null}
              </div>
              <p className="hint">{STR.nvwCharacterPortraitHint}</p>
            </div>

            {formError !== null ? (
              <ErrorNotice
                message={formError}
                fallback={STR.nvwCharacterSaveFailed}
              />
            ) : null}

            <div className="nvw-cast-foot">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDraft(null);
                  setFormError(null);
                }}
              >
                {STR.nvwCharacterCancel}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-small"
                onClick={() => void save()}
                disabled={saving || uploading || draft.name.trim() === ''}
              >
                {saving ? STR.nvwCharacterSaving : STR.nvwCharacterSave}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
