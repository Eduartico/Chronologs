import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useT } from '../i18n/index.js';
import { api, errText } from '../lib/api.js';
import { usePersistentState } from '../lib/usePersistentState.js';
import { formatDateTime } from '../lib/format.js';
import Icon from '../components/Icon.jsx';
import IconButton from '../components/ui/IconButton.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import Markdown from '../components/Markdown.jsx';

/**
 * The assistant.
 *
 * A conversation with the local model about the reader's own ledger. The
 * server runs the agent loop (see server/engines/assistant/agent.js); this
 * page's job is to show that loop honestly as it happens — which figures were
 * looked up, over which period, and what the model made of them — rather than
 * a bubble that appears after twenty seconds.
 *
 * Four things the screen insists on:
 *
 *  - **Evidence is visible.** Every tool call the model made sits above its
 *    answer as a chip, and opens to the arguments and the result. A number in
 *    the answer can always be traced to the lookup it came from, and a reader
 *    who distrusts the prose can read the JSON.
 *  - **Nothing is faked while waiting.** The chips appear as the calls are
 *    made, the text as it is generated. The stop button aborts the request,
 *    and an aborted turn is not saved — the model's half-sentence is not
 *    history.
 *  - **The model's limits are stated before the first question.** The page
 *    asks Ollama itself whether it is running, whether the chosen model is
 *    installed and whether it can call tools, and says so above the composer.
 *    A reader used to find out that Ollama was down by losing a question.
 *  - **A turn that failed is still the reader's.** The server saves a question
 *    only together with its answer, so a failed one stays on screen with Retry
 *    and Edit. Any question can be edited and re-sent, any answer retried, and
 *    any point of a conversation forked into a new one — the things every
 *    other chat window has taught people to expect.
 */

/** The period a lookup covered, for the chip — the one argument worth reading
    without opening it. */
function spanOf(args = {}) {
  if (args.month) return args.month;
  if (args.from || args.to) return `${args.from || '…'} → ${args.to || '…'}`;
  if (args.months) return `${args.months}m`;
  if (args.days) return `${args.days}d`;
  return null;
}

function Step({ step, pending }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const label = t(`assistant.tool.${step.name}`);
  const span = spanOf(step.arguments);
  const extra = step.arguments?.category || step.arguments?.text || null;
  return (
    <div className={`chat-step${pending ? ' pending' : ''}${open ? ' open' : ''}`}>
      <button type="button" className="chat-step-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name={pending ? 'hourglass' : step.result?.error ? 'alert' : 'check'} size={13} />
        <span className="chat-step-name">{label.startsWith('assistant.tool.') ? step.name : label}</span>
        {span && <span className="chat-step-span">{span}</span>}
        {extra && <span className="chat-step-span">{String(extra)}</span>}
        <Icon name={open ? 'chevronLeft' : 'chevronRight'} size={12} className="chat-step-caret" />
      </button>
      {open && (
        <div className="chat-step-body">
          <div className="chat-step-label">{t('assistant.toolArgs')}</div>
          <pre>{JSON.stringify(step.arguments ?? {}, null, 1)}</pre>
          <div className="chat-step-label">{t('assistant.toolResult')}</div>
          <pre>{pending ? '…' : JSON.stringify(step.result, null, 1)}</pre>
        </div>
      )}
    </div>
  );
}

/** Copy with a moment of "copied" on the glyph itself, rather than a toast. */
function CopyButton({ text }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    } catch {}
  };
  return <IconButton icon={done ? 'check' : 'copy'} size={13} label={done ? t('assistant.copied') : t('assistant.copy')} onClick={copy} />;
}

function UserMessage({ message, busy, failed, onEdit, onRetry }) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.content);
  const ref = useRef(null);

  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const submit = () => {
    const next = text.trim();
    if (!next) return;
    setEditing(false);
    onEdit(next);
  };

  if (editing) {
    return (
      <div className="chat-msg chat-msg-user">
        <div className="chat-edit">
          <textarea
            ref={ref}
            value={text}
            rows={Math.min(8, Math.max(2, text.split('\n').length))}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') {
                setEditing(false);
                setText(message.content);
              }
            }}
            aria-label={t('assistant.edit')}
          />
          <div className="chat-edit-actions">
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                setEditing(false);
                setText(message.content);
              }}
            >
              {t('common.cancel')}
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={submit} disabled={!text.trim() || busy}>
              <Icon name="send" size={13} /> {t('assistant.send')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`chat-msg chat-msg-user${failed ? ' failed' : ''}`}>
      <div className="chat-bubble">{message.content}</div>
      <div className="chat-actions">
        {message.at && !failed && <span className="chat-meta">{formatDateTime(message.at)}</span>}
        <CopyButton text={message.content} />
        {!busy && (
          <>
            <IconButton icon="pencil" size={13} label={t('assistant.edit')} onClick={() => setEditing(true)} />
            {failed && <IconButton icon="refresh" size={13} label={t('assistant.retry')} onClick={onRetry} />}
          </>
        )}
      </div>
    </div>
  );
}

function AssistantMessage({ message, streaming, busy, onRetry, onFork }) {
  const { t } = useT();
  const [showThinking, setShowThinking] = useState(false);
  const steps = message.steps || [];
  return (
    <div className="chat-msg chat-msg-assistant">
      <div className="chat-avatar" aria-hidden="true">
        <Icon name="sparkles" size={15} />
      </div>
      <div className="chat-body">
        {steps.length > 0 && (
          <div className="chat-steps">
            {steps.map((s, i) => (
              <Step key={i} step={s} pending={streaming && s.result === undefined} />
            ))}
          </div>
        )}
        {message.thinking && (
          <div className="chat-thinking">
            <button type="button" className="chat-link" onClick={() => setShowThinking((v) => !v)}>
              <Icon name="brain" size={12} /> {t('assistant.thinking')}
            </button>
            {showThinking && <pre>{message.thinking}</pre>}
          </div>
        )}
        {message.content ? (
          <Markdown text={message.content} />
        ) : streaming ? (
          <p className="chat-working">
            <span className="chat-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {t('assistant.working')}
          </p>
        ) : null}
        {message.mode === 'grounded' && <p className="chat-note">{t('assistant.groundedNote')}</p>}
        {message.mode === 'final' && <p className="chat-note">{t('assistant.modeFinal')}</p>}
        {!streaming && (
          <div className="chat-actions">
            {message.content && <CopyButton text={message.content} />}
            {!busy && (
              <>
                <IconButton icon="refresh" size={13} label={t('assistant.retry')} onClick={onRetry} />
                <IconButton icon="fork" size={13} label={t('assistant.fork')} onClick={onFork} />
              </>
            )}
            {message.at && <span className="chat-meta">{formatDateTime(message.at)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * What stands between the reader and a working turn, worst first. Not an
 * empty state: the conversations stay readable while Ollama is down.
 */
function ConnectionBanner({ status, checking, onCheck, onOpenSettings }) {
  const { t } = useT();
  const c = status?.connection;
  if (!status?.configured || !c) return null;
  let tone;
  let text;
  if (!c.reachable) {
    tone = 'bad';
    text = t('assistant.offline', { url: status.baseUrl });
  } else if (c.installed === false) {
    tone = 'bad';
    text = t('assistant.notInstalled', { model: status.model });
  } else if (c.tools === false) {
    tone = 'warn';
    text = t('assistant.noTools', { model: status.model });
    if (c.toolModels?.length) text = `${text} ${t('assistant.noToolsSuggest', { models: c.toolModels.slice(0, 4).join(', ') })}`;
  } else {
    return null;
  }
  return (
    <div className={`chat-banner chat-banner-${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon name="alert" size={15} />
      <span className="chat-banner-text">{text}</span>
      {tone === 'bad' && !c.reachable ? (
        <button type="button" className="btn-ghost btn-sm" onClick={onCheck} disabled={checking}>
          <Icon name="refresh" size={13} /> {checking ? t('assistant.checking') : t('assistant.checkAgain')}
        </button>
      ) : (
        <button type="button" className="btn-ghost btn-sm" onClick={onOpenSettings}>
          {t('assistant.openSettings')}
        </button>
      )}
    </div>
  );
}

export default function Assistant({ onOpenSettings }) {
  const { t } = useT();
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [chats, setChats] = useState([]);
  const [chatId, setChatId] = usePersistentState('assistant.chat', null);
  const [chat, setChat] = useState(null);
  const [draft, setDraft] = usePersistentState('assistant.draft', '');
  const [listOpen, setListOpen] = usePersistentState('assistant.listOpen', true);
  const [live, setLive] = useState(null); // the assistant message being streamed
  // The turn being sent: its question, and the index it replaces when it is an
  // edit or a retry. Kept after a failure so it can be retried or edited.
  const [pendingTurn, setPendingTurn] = useState(null);
  const [failed, setFailed] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [starters, setStarters] = useState([]);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const abortRef = useRef(null);
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await api.getAssistantStatus());
    } catch {
      setStatus((s) => s || { configured: false, ready: false });
    } finally {
      setChecking(false);
    }
  }, []);

  const loadChats = useCallback(async () => {
    try {
      setChats(await api.listChats());
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  useEffect(() => {
    check();
    loadChats();
    api.getAssistantStarters().then((r) => setStarters(r.starters || [])).catch(() => setStarters([]));
  }, [check, loadChats]);

  // A conversation this page just created is already in state; fetching it
  // back would race the turn being streamed into it.
  const createdRef = useRef(null);
  useEffect(() => {
    if (!chatId) return setChat(null);
    if (chatId === createdRef.current) return;
    let cancelled = false;
    api
      .getChat(chatId)
      .then((c) => !cancelled && setChat(c))
      .catch(() => !cancelled && setChatId(null));
    return () => {
      cancelled = true;
    };
  }, [chatId, setChatId]);

  const messages = useMemo(() => chat?.messages || [], [chat]);
  // What the thread shows: the saved messages, cut where a pending edit or
  // retry will replace them, then the question in flight.
  const shown = useMemo(
    () => (pendingTurn ? messages.slice(0, pendingTurn.from ?? messages.length) : messages),
    [messages, pendingTurn],
  );

  // Keep the newest message in view as it streams.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, pendingTurn, live?.content, live?.steps?.length]);

  const ready = !!status?.ready;
  const busy = !!live;

  const stop = () => abortRef.current?.abort();

  const send = async (text, from) => {
    const content = String(text ?? draft).trim();
    if (!content || live || !ready) return;
    setError(null);
    setFailed(false);
    setSuggestions([]);
    let id = chatId;
    try {
      if (!id) {
        const created = await api.createChat();
        id = created.id;
        createdRef.current = id;
        setChatId(id);
        setChat(created);
        // Listed at once, so a turn that fails leaves a conversation the reader
        // can see, return to and delete — not one that exists only on disk.
        loadChats();
      }
    } catch (e) {
      return setError(errText(e));
    }
    setPendingTurn({ content, from: Number.isInteger(from) ? from : undefined });
    if (text == null) setDraft('');
    const controller = new AbortController();
    abortRef.current = controller;
    const pending = { role: 'assistant', content: '', thinking: '', steps: [], mode: 'tools' };
    setLive({ ...pending });
    let finished = false;
    try {
      await api.sendChatMessage(id, content, {
        from: Number.isInteger(from) ? from : undefined,
        signal: controller.signal,
        onEvent: (ev) => {
          switch (ev.type) {
            case 'mode':
              pending.mode = ev.mode;
              break;
            case 'tool_call':
              pending.steps = [...pending.steps, { name: ev.name, arguments: ev.arguments }];
              break;
            case 'tool_result': {
              const idx = pending.steps.findIndex((s) => s.name === ev.name && s.result === undefined);
              if (idx >= 0) pending.steps = pending.steps.map((s, i) => (i === idx ? { ...s, result: ev.result } : s));
              break;
            }
            case 'delta':
              if (ev.text) pending.content += ev.text;
              if (ev.thinking) pending.thinking += ev.thinking;
              break;
            case 'done':
              finished = true;
              if (ev.chat) setChat(ev.chat);
              setPendingTurn(null);
              setLive(null);
              loadChats();
              // Settings may have changed the model since the page opened.
              check();
              return;
            case 'suggestions':
              setSuggestions(ev.suggestions || []);
              return;
            case 'error':
              setError(t(ev.key, { detail: ev.detail }));
              setLive(null);
              return;
            default:
              return;
          }
          setLive({ ...pending });
        },
      });
    } catch (e) {
      if (e?.name !== 'AbortError') setError(errText(e));
    } finally {
      abortRef.current = null;
      setLive((l) => (l ? null : l));
      if (!finished) {
        if (controller.signal.aborted) {
          // Stopped on purpose: nothing was saved, so the question goes back
          // into the composer rather than vanishing.
          setPendingTurn(null);
          if (text == null) setDraft(content);
        } else {
          setFailed(true);
          // The likeliest reason is Ollama going away; the banner should say so.
          check();
        }
      }
    }
  };

  const retryPending = () => pendingTurn && send(pendingTurn.content, pendingTurn.from);

  const selectChat = (id) => {
    if (live) return;
    createdRef.current = null;
    setPendingTurn(null);
    setFailed(false);
    setError(null);
    setSuggestions([]);
    setChatId(id);
  };

  const fork = async (index) => {
    if (!chatId) return;
    try {
      const forked = await api.forkChat(chatId, index);
      await loadChats();
      selectChat(forked.id);
    } catch (e) {
      setError(errText(e));
    }
  };

  const newChat = () => {
    selectChat(null);
    setDraft('');
    inputRef.current?.focus();
  };

  const remove = async (id) => {
    try {
      await api.deleteChat(id);
      if (id === chatId) selectChat(null);
      await loadChats();
    } catch (e) {
      setError(errText(e));
    } finally {
      setConfirmDelete(null);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const empty = shown.length === 0 && !pendingTurn;
  const configured = status ? status.configured : true;

  return (
    <div className={`chat-page${listOpen ? '' : ' list-hidden'}`}>
      {listOpen && (
        <aside className="chat-list" aria-label={t('assistant.conversations')}>
          <div className="chat-list-head">
            <button type="button" className="btn-primary btn-sm chat-new" onClick={newChat}>
              <Icon name="plus" size={14} /> {t('assistant.newChat')}
            </button>
            <IconButton icon="sidebar" size={15} label={t('assistant.hideList')} onClick={() => setListOpen(false)} />
          </div>
          {chats.length === 0 ? (
            <p className="muted chat-list-empty">{t('assistant.noChats')}</p>
          ) : (
            <ul className="chat-list-items">
              {chats.map((c) => (
                <li key={c.id} className={c.id === chatId ? 'active' : ''}>
                  <button type="button" className="chat-list-item" onClick={() => selectChat(c.id)}>
                    <span className="chat-list-title">{c.title || t('assistant.untitled')}</span>
                    <span className="chat-list-when">{formatDateTime(c.updatedAt)}</span>
                  </button>
                  <IconButton icon="trash" size={13} tone="danger" label={t('assistant.deleteChat')} onClick={() => setConfirmDelete(c.id)} />
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}

      <section className="chat-main">
        <header className="chat-head">
          {!listOpen && (
            <IconButton icon="sidebar" size={15} label={t('assistant.showList')} onClick={() => setListOpen(true)} />
          )}
          <h2>{chat?.title || t('nav.assistant')}</h2>
          {!listOpen && <IconButton icon="plus" size={15} label={t('assistant.newChat')} onClick={newChat} />}
          {status?.model && <span className="chat-model muted">{t('assistant.model', { model: status.model })}</span>}
        </header>

        {!configured ? (
          <div className="empty-state chat-empty">
            <Icon name="brain" size={36} />
            <h3>{t('assistant.notReadyTitle')}</h3>
            <p>{t('assistant.notReady')}</p>
            <button type="button" className="btn-primary" onClick={onOpenSettings}>
              {t('assistant.openSettings')}
            </button>
          </div>
        ) : (
          <div className="chat-thread" ref={threadRef}>
            <div className="chat-column">
              {empty && (
                <div className="chat-welcome">
                  <h3>{t('assistant.welcomeTitle')}</h3>
                  <p className="hint">{t('assistant.welcome')}</p>
                  <div className="chat-chips">
                    {starters.map((s, i) => (
                      <button key={i} type="button" className="chat-chip" disabled={!ready} onClick={() => send(t(s.key, s.params))}>
                        {t(s.key, s.params)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {shown.map((m, i) =>
                m.role === 'user' ? (
                  <UserMessage
                    key={`${m.at || i}-${i}`}
                    message={m}
                    busy={busy || !ready}
                    onEdit={(next) => send(next, i)}
                  />
                ) : (
                  <AssistantMessage
                    key={`${m.at || i}-${i}`}
                    message={m}
                    busy={busy || !ready}
                    onRetry={() => {
                      const q = shown[i - 1];
                      if (q?.role === 'user') send(q.content, i - 1);
                    }}
                    onFork={() => fork(i)}
                  />
                ),
              )}
              {pendingTurn && (
                <UserMessage
                  key={`pending-${pendingTurn.content}`}
                  message={{ role: 'user', content: pendingTurn.content }}
                  busy={busy || !ready}
                  failed={failed}
                  onEdit={(next) => send(next, pendingTurn.from)}
                  onRetry={retryPending}
                />
              )}
              {live && <AssistantMessage message={live} streaming />}
              {failed && <p className="chat-failed muted">{t('assistant.notSent')}</p>}
              {!live && !pendingTurn && suggestions.length > 0 && (
                <div className="chat-followups">
                  <span className="muted">{t('assistant.followUps')}</span>
                  <div className="chat-chips">
                    {suggestions.map((s, i) => (
                      <button key={i} type="button" className="chat-chip" disabled={!ready} onClick={() => send(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {configured && (
          <div className="chat-foot">
            <ConnectionBanner status={status} checking={checking} onCheck={check} onOpenSettings={onOpenSettings} />
            {error && (
              <div className="chat-error" role="alert">
                <Icon name="alert" size={14} /> {error}
              </div>
            )}
            <form
              className="chat-composer"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <textarea
                ref={inputRef}
                rows={2}
                value={draft}
                placeholder={t('assistant.placeholder')}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                aria-label={t('assistant.placeholder')}
              />
              {live ? (
                <button type="button" className="btn-ghost chat-send" onClick={stop}>
                  <Icon name="stopSquare" size={14} /> {t('assistant.stop')}
                </button>
              ) : (
                <button type="submit" className="btn-primary chat-send" disabled={!ready || !draft.trim()}>
                  <Icon name="send" size={14} /> {t('assistant.send')}
                </button>
              )}
            </form>
            <p className="chat-disclaimer muted">{t('assistant.disclaimer')}</p>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!confirmDelete}
        title={t('assistant.deleteChat')}
        impact={t('assistant.confirmDelete')}
        confirmLabel={t('common.delete')}
        onConfirm={() => remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
