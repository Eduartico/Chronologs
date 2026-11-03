import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useT } from '../i18n/index.js';
import { api, errText } from '../lib/api.js';
import { usePersistentState } from '../lib/usePersistentState.js';
import { useLlmStatus } from '../lib/useLlmStatus.js';
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
 * Three things the screen insists on:
 *
 *  - **Evidence is visible.** Every tool call the model made sits above its
 *    answer as a chip, and opens to the arguments and the result. A number in
 *    the answer can always be traced to the lookup it came from, and a reader
 *    who distrusts the prose can read the JSON.
 *  - **Nothing is faked while waiting.** The chips appear as the calls are
 *    made, the text as it is generated. The stop button aborts the request,
 *    and an aborted turn is not saved — the model's half-sentence is not
 *    history.
 *  - **The model's limits are stated.** A model with no tool support gets a
 *    note saying it answered from a fixed summary; every turn carries the
 *    standing reminder that a local model can be wrong.
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

function Message({ message, streaming }) {
  const { t } = useT();
  const [showThinking, setShowThinking] = useState(false);
  if (message.role === 'user') {
    return (
      <div className="chat-msg chat-msg-user">
        <div className="chat-bubble">{message.content}</div>
        {message.at && <div className="chat-meta">{formatDateTime(message.at)}</div>}
      </div>
    );
  }
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
        {message.at && !streaming && <div className="chat-meta">{formatDateTime(message.at)}</div>}
      </div>
    </div>
  );
}

export default function Assistant({ onOpenSettings }) {
  const { t } = useT();
  const llm = useLlmStatus();
  const [chats, setChats] = useState([]);
  const [chatId, setChatId] = usePersistentState('assistant.chat', null);
  const [chat, setChat] = useState(null);
  const [draft, setDraft] = usePersistentState('assistant.draft', '');
  const [live, setLive] = useState(null); // the assistant message being streamed
  const [suggestions, setSuggestions] = useState([]);
  const [starters, setStarters] = useState([]);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const abortRef = useRef(null);
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  const loadChats = useCallback(async () => {
    try {
      setChats(await api.listChats());
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  useEffect(() => {
    loadChats();
    api.getAssistantStarters().then((r) => setStarters(r.starters || [])).catch(() => setStarters([]));
  }, [loadChats]);

  useEffect(() => {
    if (!chatId) return setChat(null);
    let cancelled = false;
    api
      .getChat(chatId)
      .then((c) => !cancelled && setChat(c))
      .catch(() => !cancelled && setChatId(null));
    return () => {
      cancelled = true;
    };
  }, [chatId, setChatId]);

  // Keep the newest message in view as it streams.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat?.messages?.length, live?.content, live?.steps?.length]);

  const stop = () => abortRef.current?.abort();

  const send = async (text) => {
    const content = String(text ?? draft).trim();
    if (!content || live || !llm.ready) return;
    setError(null);
    setSuggestions([]);
    let id = chatId;
    try {
      if (!id) {
        const created = await api.createChat();
        id = created.id;
        setChatId(id);
        setChat(created);
      }
    } catch (e) {
      return setError(errText(e));
    }
    const at = new Date().toISOString();
    setChat((c) => (c ? { ...c, messages: [...c.messages, { role: 'user', content, at }] } : c));
    setDraft('');
    const controller = new AbortController();
    abortRef.current = controller;
    const pending = { role: 'assistant', content: '', thinking: '', steps: [], mode: 'tools' };
    setLive({ ...pending });
    try {
      await api.sendChatMessage(id, content, {
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
              setChat((c) => (c ? { ...c, title: ev.title || c.title, messages: [...c.messages, ev.message] } : c));
              setLive(null);
              loadChats();
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
      // A stopped turn leaves the question on screen; reloading tells the
      // truth about what was saved.
      if (controller.signal.aborted) api.getChat(id).then(setChat).catch(() => {});
    }
  };

  const remove = async (id) => {
    try {
      await api.deleteChat(id);
      if (id === chatId) setChatId(null);
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

  const messages = useMemo(() => chat?.messages || [], [chat]);
  const empty = messages.length === 0 && !live;

  return (
    <div className="chat-page">
      <aside className="chat-list card">
        <button type="button" className="btn-primary btn-sm chat-new" onClick={() => setChatId(null)}>
          <Icon name="plus" size={14} /> {t('assistant.newChat')}
        </button>
        {chats.length === 0 ? (
          <p className="muted chat-list-empty">{t('assistant.noChats')}</p>
        ) : (
          <ul className="chat-list-items">
            {chats.map((c) => (
              <li key={c.id} className={c.id === chatId ? 'active' : ''}>
                <button type="button" className="chat-list-item" onClick={() => setChatId(c.id)}>
                  <span className="chat-list-title">{c.title || t('assistant.untitled')}</span>
                  <span className="chat-list-when">{formatDateTime(c.updatedAt)}</span>
                </button>
                <IconButton icon="trash" size={13} tone="danger" label={t('assistant.deleteChat')} onClick={() => setConfirmDelete(c.id)} />
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="chat-main card">
        <header className="chat-head">
          <h2>
            <Icon name="chat" size={20} />
            {chat?.title || t('nav.assistant')}
          </h2>
          {llm.ready && <span className="chat-model muted">{t('assistant.model', { model: llm.model })}</span>}
        </header>

        {!llm.ready ? (
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
            {empty && (
              <div className="chat-welcome">
                <h3>{t('assistant.welcomeTitle')}</h3>
                <p className="hint">{t('assistant.welcome')}</p>
                <div className="chat-chips">
                  {starters.map((s, i) => (
                    <button key={i} type="button" className="chat-chip" onClick={() => send(t(s.key, s.params))}>
                      {t(s.key, s.params)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <Message key={`${m.at || i}-${i}`} message={m} />
            ))}
            {live && <Message message={live} streaming />}
            {!live && suggestions.length > 0 && (
              <div className="chat-followups">
                <span className="muted">{t('assistant.followUps')}</span>
                <div className="chat-chips">
                  {suggestions.map((s, i) => (
                    <button key={i} type="button" className="chat-chip" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

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
            disabled={!llm.ready}
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
            <button type="submit" className="btn-primary chat-send" disabled={!llm.ready || !draft.trim()}>
              <Icon name="send" size={14} /> {t('assistant.send')}
            </button>
          )}
        </form>
        <p className="chat-disclaimer muted">{t('assistant.disclaimer')}</p>
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
