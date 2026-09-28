'use client';

// The poster/caption edit assistant — a compact conversation that replaced the
// "AI ला सूचना द्या" fold. The officer says what they want in their own words; there are no
// target pills and no required phrasing. Each turn sends the whole conversation (plus what is
// marked on the poster) to POST /generations/:id/assist, which answers with a plan: act, ask
// ONE question, or just reply. An `act` plan is carried out here, action by action, through
// the caller's `onExecute` — which calls the SAME routes the fold used, so every guard and job
// behind them applies unchanged. The assistant decides; the existing workflows execute.
//
// The conversation is per run and per card, kept in localStorage so a reload keeps context.
// That is a convenience, never state of record: losing it costs history, nothing else.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MessageSquareText, SendHorizontal, Trash2 } from 'lucide-react';
import {
  EDIT_ASSISTANT_MAX_MESSAGES,
  EDIT_ASSISTANT_MESSAGE_MAX_CHARS,
  type EditAssistantAction,
  type EditAssistantMessage,
  type EditAssistantSurface,
  type PosterClearAction,
} from '@dgipr/schemas';
import { planEdit } from '../lib/api';
import { STR } from '../lib/strings';
import { errorMessage } from '../lib/errorMessage';
import { ComposeSafeTextarea, isComposingEvent } from './ComposeSafeInput';

type ChatTurn = EditAssistantMessage & {
  id: number;
  // An error is shown in the conversation but never sent back to the planner — it describes
  // this browser's request failing, not anything the officer or the assistant said.
  tone?: 'error';
};

export type EditChatMarks = Readonly<{
  markers: readonly Readonly<{ note: string }>[];
  clearRegions: readonly Readonly<{
    action: PosterClearAction;
    note: string;
  }>[];
}>;

const STORAGE_PREFIX = 'dgipr.edit-chat';

function storageKey(generationId: string, surface: EditAssistantSurface) {
  return `${STORAGE_PREFIX}.${generationId}.${surface}`;
}

function loadTurns(key: string): ChatTurn[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is ChatTurn =>
          typeof t === 'object' &&
          t !== null &&
          (t.role === 'user' || t.role === 'assistant') &&
          typeof t.text === 'string' &&
          typeof t.id === 'number',
      )
      .slice(-EDIT_ASSISTANT_MAX_MESSAGES * 2);
  } catch {
    return [];
  }
}

function saveTurns(key: string, turns: readonly ChatTurn[]) {
  try {
    if (turns.length === 0) localStorage.removeItem(key);
    else
      localStorage.setItem(
        key,
        JSON.stringify(turns.slice(-EDIT_ASSISTANT_MAX_MESSAGES * 2)),
      );
  } catch {
    /* storage blocked or full — the conversation still works for this page view */
  }
}

export function EditChat({
  generationId,
  surface,
  marks,
  onExecute,
  hint,
  placeholder,
  starters = [],
  disabled = false,
}: {
  generationId: string;
  surface: EditAssistantSurface;
  // What is marked on the poster right now; sent so the plan can use and complete the marks.
  marks?: EditChatMarks | undefined;
  // Carry out one planned action. Throw to report it failed; the error is shown in the chat.
  onExecute: (action: EditAssistantAction) => Promise<void>;
  hint: string;
  placeholder: string;
  // Examples shown only while the conversation is empty — a start, never a menu of actions.
  starters?: readonly string[];
  disabled?: boolean;
}) {
  const key = storageKey(generationId, surface);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [working, setWorking] = useState(false);
  const nextId = useRef(1);
  const logRef = useRef<HTMLOListElement>(null);

  // Read after mount, never during render: the server has no localStorage, and a first render
  // that differs from the server's would be a hydration mismatch.
  useEffect(() => {
    const restored = loadTurns(key);
    nextId.current = restored.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    setTurns(restored);
  }, [key]);

  // Keep the newest turn in view without scrolling the page itself.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [turns, working]);

  const append = (additions: Omit<ChatTurn, 'id'>[]) => {
    setTurns((current) => {
      const next = [
        ...current,
        ...additions.map((t) => ({ ...t, id: nextId.current++ })),
      ];
      saveTurns(key, next);
      return next;
    });
  };

  const markCount =
    (marks?.markers.length ?? 0) + (marks?.clearRegions.length ?? 0);

  const send = async (text: string) => {
    const message = text.trim().slice(0, EDIT_ASSISTANT_MESSAGE_MAX_CHARS);
    if (!message || working || disabled) return;
    const userTurn: ChatTurn = {
      id: nextId.current++,
      role: 'user',
      text: message,
    };
    // The history the planner sees: this conversation without its error lines, newest kept.
    const history: EditAssistantMessage[] = [...turns, userTurn]
      .filter((t) => t.tone !== 'error')
      .map((t) => ({ role: t.role, text: t.text }))
      .slice(-EDIT_ASSISTANT_MAX_MESSAGES);
    setTurns((current) => {
      const next = [...current, userTurn];
      saveTurns(key, next);
      return next;
    });
    setDraft('');
    setWorking(true);
    try {
      const plan = await planEdit(generationId, {
        surface,
        messages: history,
        markers: (marks?.markers ?? []).map((m) => ({ note: m.note.trim() })),
        clearRegions: (marks?.clearRegions ?? []).map((c) => ({
          action: c.action,
          note: c.note.trim(),
        })),
      });
      append([{ role: 'assistant', text: plan.message }]);
      if (plan.kind === 'act') {
        // In order: caption work first (it runs beside a poster render), then the poster.
        // One failing does not stop the other — they are independent edits.
        for (const action of plan.actions) {
          try {
            await onExecute(action);
          } catch (error) {
            append([
              { role: 'assistant', text: errorMessage(error), tone: 'error' },
            ]);
          }
        }
      }
    } catch (error) {
      append([{ role: 'assistant', text: errorMessage(error), tone: 'error' }]);
    } finally {
      setWorking(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };

  const clear = () => {
    setTurns([]);
    saveTurns(key, []);
  };

  const blocked = working || disabled;

  return (
    <div className="edit-chat">
      <div className="edit-chat-head">
        <MessageSquareText size={17} strokeWidth={1.9} aria-hidden="true" />
        <span className="edit-chat-title">{STR.editChatTitle}</span>
        {turns.length > 0 ? (
          <button
            type="button"
            className="edit-chat-clear"
            title={STR.editChatClear}
            aria-label={STR.editChatClear}
            disabled={working}
            onClick={clear}
          >
            <Trash2 size={15} strokeWidth={1.9} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {turns.length > 0 || working ? (
        <ol
          className="edit-chat-log"
          ref={logRef}
          aria-live="polite"
          aria-label={STR.editChatTitle}
        >
          {turns.map((turn) => (
            <li
              key={turn.id}
              className={`edit-chat-turn is-${turn.role}${turn.tone === 'error' ? ' is-error' : ''}`}
            >
              {turn.text}
            </li>
          ))}
          {working ? (
            <li className="edit-chat-turn is-assistant is-thinking">
              <span className="spinner" aria-hidden="true" />
              {STR.editChatThinking}
            </li>
          ) : null}
        </ol>
      ) : (
        <>
          <p className="hint edit-chat-hint">{hint}</p>
          {starters.length > 0 ? (
            <div className="edit-chat-starters">
              {starters.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className="suggestion-chip"
                  disabled={blocked}
                  onClick={() => setDraft(starter)}
                >
                  {starter}
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}

      {markCount > 0 ? (
        <p className="hint edit-chat-marks">
          {STR.editChatMarksNote(markCount)}
        </p>
      ) : null}

      <form className="edit-chat-composer" onSubmit={onSubmit}>
        <ComposeSafeTextarea
          value={draft}
          onChange={setDraft}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line — but never while an IME is mid-word,
            // when Enter belongs to the keyboard.
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !isComposingEvent(event)
            ) {
              event.preventDefault();
              void send(draft);
            }
          }}
          placeholder={placeholder}
          aria-label={STR.editChatInputLabel}
          rows={2}
          maxLength={EDIT_ASSISTANT_MESSAGE_MAX_CHARS}
          disabled={blocked}
        />
        <button
          type="submit"
          className="edit-chat-send"
          title={STR.editChatSend}
          aria-label={STR.editChatSend}
          aria-busy={working}
          disabled={blocked || draft.trim().length === 0}
        >
          <SendHorizontal size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
