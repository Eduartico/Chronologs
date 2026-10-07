import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { df, weekdayNames, firstDayOfWeek } from '../lib/locale.js';
import { formatDate, formatDuration, formatRange } from '../lib/format.js';
import { api, errText } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import IconButton from '../components/ui/IconButton.jsx';
import RowActions from '../components/ui/RowActions.jsx';
import EditableField from '../components/ui/EditableField.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { DateRangeField } from '../components/ui/DateField.jsx';
import SortHeader from '../components/ui/SortHeader.jsx';
import Value from '../components/ui/Value.jsx';
import { useRowEditor } from '../lib/useRowEditor.js';
import { useSortableRows } from '../lib/useSortableRows.js';
import { useT } from '../i18n/index.js';

/**
 * Travel calendar.
 *
 * Trips are a first-class thing here rather than a tag, because they have to
 * answer two questions a tag cannot: which days count (including a forgiving
 * margin for the flight booked the night before), and what was spent while
 * away. Detection proposes; the user confirms.
 */

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthLabel(year, month) {
  return df({ month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month, 1)));
}

function isoOf(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Monday-first grid covering the whole month, padded with adjacent days. */
function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  // Same correction as lib/dateInput.js: the lead-in follows the locale's first
  // day rather than assuming Monday.
  const offset = (first.getUTCDay() - firstDayOfWeek() + 7) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [];

  const prevDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let i = offset - 1; i >= 0; i--) {
    cells.push({ day: prevDays - i, outside: true, iso: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, outside: false, iso: isoOf(year, month, d) });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: cells.length % 7, outside: true, iso: null });
  }
  return cells;
}

function formatMoney(value) {
  const num = Number(value) || 0;
  return `${num < 0 ? '−' : ''}€${Math.abs(num).toFixed(2)}`;
}

/** True while the dates cannot describe a trip anyone actually took. */
function badDates(draft) {
  return !draft?.startDate || !draft?.endDate || draft.endDate < draft.startDate;
}

/**
 * The identity line of a trip — name, country, dates — which is also where it
 * gets edited.
 *
 * Detection gets the country right and the edges roughly right; only the person
 * who went knows it was Tui and not just "Espanha", or that they arrived on the
 * Friday night. That correction used to open a four-field form underneath the
 * card, so the name you were reading and the name you were changing were two
 * different things in two places. Now the card's own line becomes writable.
 *
 * The dates are a pair, which is the whole point of `DateRangeField`: with a
 * start of 21/01/2025, the end only needs `25`.
 */
function TravelHeadline({ title, editing, draft, patch, meta }) {
  const { t } = useT();
  return (
    <div style={{ flex: 1, minWidth: 240 }}>
      <div className="travel-headline">
        <EditableField
          editing={editing}
          value={editing ? draft.name : title}
          onChange={(name) => patch({ name })}
          placeholder={t('travel.namePlaceholder')}
          width={230}
          autoFocus
        />
        {editing && (
          <EditableField
            editing
            value={draft.country}
            onChange={(country) => patch({ country: country.toUpperCase().slice(0, 2) })}
            placeholder="PT"
            width={58}
            title={t('travel.countryCode')}
          />
        )}
      </div>
      <div className="travel-meta">
        {editing ? (
          <>
            <DateRangeField
              from={draft.startDate}
              to={draft.endDate}
              onChange={({ from, to }) => patch({ startDate: from, endDate: to })}
            />
            <span className={badDates(draft) ? 'amount-negative' : 'muted'}>
              {badDates(draft)
                ? 'A data de fim não pode ser anterior ao início.'
                : formatDuration(draft.startDate, draft.endDate)}
            </span>
          </>
        ) : (
          meta
        )}
      </div>
    </div>
  );
}

/** A trip's country, in the reader's language.
    Trip *names* are user data and are never rewritten — but `country` is stored
    as an ISO code beside the name, so the column can be translated with no
    migration at all. Anything the catalogue does not know falls back to whatever
    name the server saved. */
function countryNameOf(trip, t) {
  const key = `country.${trip.country}`;
  const translated = t(key);
  return translated === key ? trip.countryName || trip.country : translated;
}

const emptyTravelDraft = () => ({ name: '', country: '', startDate: '', endDate: '', tagId: '' });

/**
 * The blank row at the foot of the table.
 *
 * Adding a trip used to open a separate card above the list, with its own
 * bordered inputs and its own Save button — a small form that looked nothing like
 * the thing it was making. This is a row: same cells, same columns, same widths.
 * What you fill in is what appears.
 */
function TravelAddRow({ draft, tags, onChange, onAdd, onClear, inputRef }) {
  const { t } = useT();
  const ready = Boolean(String(draft.name || '').trim()) && !badDates(draft);

  const keys = (e) => {
    if (e.key === 'Enter' && ready) onAdd();
    if (e.key === 'Escape') onClear();
  };

  return (
    <tr className="add-row">
      <td>
        <span className="autosize" data-value={draft.name || t('travel.addName')}>
          <input
            ref={inputRef}
            value={draft.name}
            placeholder={t('travel.addName')}
            onChange={(e) => onChange({ name: e.target.value })}
            onKeyDown={keys}
          />
        </span>
      </td>
      <td>
        <span className="autosize" data-value={draft.country || 'PT'}>
          <input
            value={draft.country}
            placeholder="PT"
            maxLength={2}
            onChange={(e) => onChange({ country: e.target.value.toUpperCase() })}
            onKeyDown={keys}
          />
        </span>
      </td>
      <td>
        <DateRangeField
          from={draft.startDate}
          to={draft.endDate}
          onChange={({ from, to }) => onChange({ startDate: from, endDate: to })}
        />
      </td>
      <td className="num">—</td>
      <td className="num">—</td>
      <td className="num">{t('format.days', { count: 2 })}</td>
      <td>
        <select value={draft.tagId ?? ''} onChange={(e) => onChange({ tagId: e.target.value })}>
          <option value="">{t('travel.noTag')}</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        <div className="row-actions">
          <IconButton icon="plus" tone="good" label={t('common.add')} disabled={!ready} onClick={onAdd} />
          <IconButton icon="close" label={t('common.cancel')} onClick={onClear} />
        </div>
      </td>
    </tr>
  );
}

/**
 * One of the two review lists under "check tagging": late charges after a trip,
 * and movements filed under the old "travel" category. Same shape, same two
 * answers — claim it for the trip named beside it, or say it has nothing to do
 * with a trip — so one component.
 */
function TravelReviewList({ title, help, items, total, reasonLabel, busy, onClaim, onDismiss }) {
  const { t } = useT();
  if (!total) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <h4 style={{ marginBottom: 4 }}>{t('travel.reviewCount', { title, count: total })}</h4>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{help}</p>
      {items.slice(0, 12).map((item) => (
        <div key={item.transaction.id} className="dup-row">
          <span style={{ minWidth: 84 }}>{formatDate(item.transaction.date)}</span>
          <span style={{ flex: 1 }}>{item.transaction.description}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {item.travelName ? `${item.travelName} · ${reasonLabel(item)}` : reasonLabel(item)}
          </span>
          <span style={{ minWidth: 74, textAlign: 'right' }}>{formatMoney(item.transaction.amount)}</span>
          {item.travelId && (
            <button
              className="btn-primary btn-sm"
              disabled={busy === item.transaction.id}
              onClick={() => onClaim(item.travelId, item.transaction.id)}
              title={t('travel.claimHint')}
            >
              {t('travel.claim')}
            </button>
          )}
          <IconButton
            icon="close"
            label={t('travel.dismiss')}
            disabled={busy === item.transaction.id}
            onClick={() => onDismiss(item.transaction.id)}
          />
        </div>
      ))}
      {total > 12 && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
          {t('travel.moreRows', { count: total - 12 })}
        </p>
      )}
    </div>
  );
}

export default function Travel() {
  const [travels, setTravels] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [anomalies, setAnomalies] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [tags, setTags] = useState([]);
  const [openTravel, setOpenTravel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [showRejected, setShowRejected] = useState(false);
  // A trip takes its tagged transactions with it, so deleting one is worth
  // stopping for — the armed bin is for things that are cheap to redo.
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [draft, setDraft] = useState(emptyTravelDraft);
  const addNameRef = useRef(null);
  const { t } = useT();

  // Rejected trips are kept, not deleted: they are what stops detection from
  // proposing the same non-trip again, and they have to be undoable.
  const active = travels.filter((tr) => tr.status !== 'rejected');
  const rejected = travels.filter((tr) => tr.status === 'rejected');

  const travelColumns = useMemo(
    () => [
      // `table-fixed` divides the declared widths and gives the remainder to the
      // one column without one — so the trip name, which is the longest text and
      // the thing being read, is the column left unmeasured.
      { key: 'name', label: t('travel.column.name'), get: (r) => r.name },
      { key: 'country', label: t('travel.column.country'), get: (r) => countryNameOf(r, t), width: 120 },
      { key: 'dates', label: t('travel.column.dates'), get: (r) => r.startDate, width: 200 },
      { key: 'count', label: t('travel.column.transactions'), align: 'right', get: (r) => r.transactionCount, width: 100 },
      { key: 'total', label: t('travel.column.total'), align: 'right', get: (r) => r.total, width: 110 },
      { key: 'margin', label: t('travel.column.margin'), align: 'right', get: (r) => r.forgivingDays ?? 2, width: 90 },
      { key: 'tag', label: t('travel.column.tag'), get: (r) => r.tagId, width: 130 },
      // Four buttons, not two: this row carries "view movements" and "tag the
      // whole window" alongside edit and delete.
      { key: 'actions', label: '', sortable: false, width: 176 },
    ],
    [t],
  );

  const { rows: sortedTravels, sort, toggleSort } = useSortableRows(active, travelColumns, 'travel.sort', {
    key: 'dates',
    dir: 'desc',
  });

  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, tagList] = await Promise.all([api.getTravels(), api.getTags()]);
      setTravels(list);
      setTags(tagList);
    } catch (err) {
      showToast(errText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The review lists open on their own when there is something on them — a
  // charge that posted after a trip is exactly the thing nobody goes looking
  // for. With nothing to review the page looks as it always did.
  useEffect(() => {
    api
      .getTravelAnomalies()
      .then((result) => {
        if (result?.lateTotal || result?.legacyTotal) setAnomalies(result);
      })
      .catch(() => {});
  }, []);

  // The calendar shades days that had spending, so a trip's shape is visible
  // even before it is confirmed.
  useEffect(() => {
    const from = isoOf(cursor.year, cursor.month, 1);
    const to = isoOf(cursor.year, cursor.month, 31);
    api
      .getTransactions({ startDate: from, endDate: to })
      .then(setTransactions)
      .catch(() => setTransactions([]));
  }, [cursor]);

  const spendByDay = useMemo(() => {
    const map = new Map();
    for (const tx of transactions) {
      const d = String(tx.date).slice(0, 10);
      const amount = Number(tx.amount) || 0;
      if (amount >= 0) continue;
      map.set(d, (map.get(d) || 0) + Math.abs(amount));
    }
    return map;
  }, [transactions]);

  const travelForDay = useCallback(
    (iso) => {
      if (!iso) return null;
      for (const t of travels) {
        if (t.status === 'rejected') continue;
        if (iso >= t.startDate && iso <= t.endDate) return { travel: t, margin: false };
        if (t.window && iso >= t.window.from && iso <= t.window.to) return { travel: t, margin: true };
      }
      return null;
    },
    [travels]
  );

  async function detect() {
    setBusy('detect');
    try {
      const { proposals: found } = await api.detectTravels();
      setProposals(found);
      showToast(
        found.length === 0 ? t('travel.detectedNone') : t('travel.detectedSome', { count: found.length })
      );
    } catch (err) {
      showToast(errText(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Saves a proposal, using whatever the user edited rather than what detection
   * guessed. A day trip read as three days is corrected here, before it becomes
   * a trip on file.
   */
  async function confirmProposal(p, overrides = {}) {
    setBusy(p.id);
    try {
      const travel = { ...p, ...overrides };
      await api.createTravel({
        name: travel.name,
        country: travel.country,
        startDate: travel.startDate,
        endDate: travel.endDate,
        status: 'confirmed',
        createdFrom: 'detected',
      });
      setProposals((prev) => prev.filter((x) => x.id !== p.id));
      showToast(`Viagem "${travel.name}" adicionada.`);
      await load();
    } catch (err) {
      showToast(errText(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * "Not a trip" has to be written down, not just hidden.
   *
   * Dropping the proposal from local state was why Morocco kept coming back on
   * every detection run. A rejection is stored as a trip with `rejected`
   * status, which detection then treats as settled — and which stays listed so
   * it can be undone.
   */
  async function rejectProposal(p) {
    setBusy(p.id);
    try {
      await api.createTravel({
        name: p.name,
        country: p.country,
        startDate: p.startDate,
        endDate: p.endDate,
        status: 'rejected',
        createdFrom: 'detected',
      });
      setProposals((prev) => prev.filter((x) => x.id !== p.id));
      showToast(`"${p.countryName || p.country}" recusada — não volta a ser sugerida.`);
      await load();
    } catch (err) {
      showToast(errText(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Puts a single transaction in or out of the trip.
   *
   * This is the only thing that attaches a trip to a transaction. The dates
   * merely decide what gets listed here — a week away also contains the rent and
   * the Spotify bill, and neither became travel spending because the owner
   * happened to be abroad. Taking one out sends the category back to
   * `uncategorized` rather than guessing what it was before.
   */
  async function toggleTravelTag(tx, marked) {
    if (!openTravel) return;
    setBusy(tx.id);
    try {
      await api.markTravelTransaction(openTravel.travel.id, tx.id, !marked);
      setOpenTravel((prev) =>
        prev
          ? {
              ...prev,
              transactions: prev.transactions.map((t) =>
                t.id === tx.id
                  ? {
                      // The tag, and only the tag. The category used to move with
                      // it and that is exactly what made a trip unreadable: the
                      // hotel stopped being housing the moment the trip claimed
                      // it, and unclaiming it left nothing behind at all.
                      ...t,
                      tags: marked
                        ? (t.tags || []).filter((id) => id !== prev.travel.tagId)
                        : [...new Set([...(t.tags || []), prev.travel.tagId].filter(Boolean))],
                    }
                  : t
              ),
            }
          : prev
      );
      await load();
    } catch (err) {
      showToast(errText(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveTravel(id, patch) {
    if (badDates(patch)) {
      showToast('A data de fim não pode ser anterior ao início.');
      throw new Error('datas inválidas');
    }
    setBusy(id);
    try {
      await api.updateTravel(id, {
        name: patch.name,
        country: patch.country,
        startDate: patch.startDate,
        endDate: patch.endDate,
        forgivingDays: Number(patch.forgivingDays) || 0,
        tagId: patch.tagId || null,
      });
      await load();
    } catch (err) {
      showToast(errText(err));
    } finally {
      setBusy(null);
    }
  }

  async function createManual() {
    if (!draft.startDate || !draft.endDate) {
      showToast('Indica as datas de início e fim.');
      return;
    }
    try {
      await api.createTravel({ ...draft, status: 'confirmed' });
      setDraft(emptyTravelDraft());
      await load();
    } catch (err) {
      showToast(errText(err));
    }
  }

  async function removeTravel(id) {
    setBusy(id);
    try {
      await api.deleteTravel(id);
      if (openTravel?.travel?.id === id) setOpenTravel(null);
      await load();
    } catch (err) {
      showToast(errText(err));
    } finally {
      setBusy(null);
    }
  }

  async function openDetails(travel) {
    setBusy(travel.id);
    try {
      const list = await api.getTravelTransactions(travel.id);
      setOpenTravel({ travel, transactions: list });
    } catch (err) {
      showToast(errText(err));
    } finally {
      setBusy(null);
    }
  }

  async function applyTravel(travel, options) {
    setBusy(travel.id);
    try {
      const r = await api.applyTravel(travel.id, options);
      // No "categorized" count any more: claiming a window no longer touches a
      // single category. The sentence was also the last hardcoded Portuguese
      // string on this page.
      showToast(t('travel.claimed', { tagged: r.tagged, matched: r.matched }));
      await load();
      if (openTravel?.travel?.id === travel.id) await openDetails(travel);
    } catch (err) {
      showToast(errText(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Claims one movement for a trip straight from the review lists below, without
   * opening the trip — the late charge and the old "travel" flight both arrive
   * with the trip already named.
   */
  async function claimFor(travelId, txId) {
    setBusy(txId);
    try {
      await api.markTravelTransaction(travelId, txId, true);
      await Promise.all([load(), loadAnomalies()]);
    } catch (err) {
      showToast(errText(err));
    } finally {
      setBusy(null);
    }
  }

  /** "Nothing to do with a trip": off the review lists for good, untouched. */
  async function dismiss(txId) {
    setBusy(txId);
    try {
      await api.dismissFromTravel([txId]);
      await loadAnomalies();
    } catch (err) {
      showToast(errText(err));
    } finally {
      setBusy(null);
    }
  }

  async function loadAnomalies() {
    setBusy('anomalies');
    try {
      setAnomalies(await api.getTravelAnomalies());
    } catch (err) {
      showToast(errText(err));
    } finally {
      setBusy(null);
    }
  }

  // Two rows of the same shape: a proposal is corrected and confirmed in one
  // gesture, a saved trip is corrected and updated. Same editor, different verb.
  const proposalEditor = useRowEditor({
    onSave: (id, draft) => {
      const p = proposals.find((x) => x.id === id);
      if (!p) return undefined;
      if (badDates(draft)) {
        showToast('A data de fim não pode ser anterior ao início.');
        throw new Error('datas inválidas');
      }
      return confirmProposal(p, draft);
    },
  });
  const travelEditor = useRowEditor({ onSave: saveTravel });

  const draftOf = (item) => ({
    name: item.name || item.countryName || '',
    country: item.country || '',
    startDate: String(item.startDate || '').slice(0, 10),
    endDate: String(item.endDate || '').slice(0, 10),
    forgivingDays: item.forgivingDays ?? 2,
    tagId: item.tagId || '',
  });

  const cells = monthGrid(cursor.year, cursor.month);
  const today = todayIso();

  function shiftMonth(delta) {
    setCursor(({ year, month }) => {
      const d = new Date(Date.UTC(year, month + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>{t('nav.travel')}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
            {t('travel.pageHelp', { count: travels.length })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-ghost" onClick={loadAnomalies} disabled={busy === 'anomalies'}>{t('travel.checkTagging')}</button>
          <button className="btn-ghost" onClick={detect} disabled={busy === 'detect'}>
            {busy === 'detect' ? t('travel.detecting') : t('travel.detect')}
          </button>
          {/* Kept, as asked — but it no longer opens a separate form. It puts
              the caret in the table's own add row, which is where a new trip is
              actually written. */}
          <button
            className="btn-primary"
            onClick={() => {
              addNameRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              addNameRef.current?.focus();
            }}
          >
            + {t('travel.new')}
          </button>
        </div>
      </div>

      {proposals.length > 0 && (
        <>
          <h3 className="section-title">
            <Icon name="travel" size={18} />{t('travel.proposals')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
            {proposals.map((p) => {
              const editing = proposalEditor.isEditing(p.id);
              return (
                <div key={p.id} className="card" style={{ opacity: busy === p.id ? 0.5 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                    <TravelHeadline
                      title={p.countryName || p.country}
                      editing={editing}
                      draft={proposalEditor.draft}
                      patch={proposalEditor.patch}
                      meta={
                        <>
                          {formatRange(p.startDate, p.endDate)} · {p.transactionCount} compras no
                          local · {formatMoney(p.total)}
                        </>
                      }
                    />
                    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                      {editing ? (
                        <RowActions
                          editing
                          busy={proposalEditor.busy}
                          onSave={proposalEditor.commit}
                          onCancel={proposalEditor.cancel}
                        />
                      ) : (
                        <>
                          <IconButton
                            icon="check"
                            tone="good"
                            label={t('travel.confirmTrip')}
                            onClick={() => confirmProposal(p)}
                          />
                          <IconButton
                            icon="pencil"
                            label={t('travel.fixBeforeConfirm')}
                            onClick={() => proposalEditor.start(p, draftOf(p))}
                          />
                          <IconButton
                            icon="close"
                            tone="danger"
                            label={t('travel.notATrip')}
                            onClick={() => rejectProposal(p)}
                          />
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                    {p.sample.map((s) => s.description).join(' · ')}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {anomalies && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>{t('travel.tagging')}</h3>
            <button className="btn-ghost btn-sm" onClick={() => setAnomalies(null)}>{t('common.close')}</button>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
            {/* `t`, not `tx`: this component already binds `tx` as the name of a
                transaction in three places, and shadowing the translator with
                it is the mistake `web/src/lib/i18nScope.test.js` exists to
                catch. The two counts read fine without bold. */}
            {t('travel.taggingSummary', {
              missing: anomalies.missingTotal,
              stray: anomalies.strayTotal,
            })}
          </p>
          {anomalies.missing.slice(0, 8).map((m) => (
            <div key={m.transaction.id} className="dup-row">
              <span style={{ minWidth: 84 }}>{formatDate(m.transaction.date)}</span>
              <span style={{ flex: 1 }}>{m.transaction.description}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{m.travelName}</span>
              <span>{formatMoney(m.transaction.amount)}</span>
            </div>
          ))}
          {anomalies.missingTotal > 8 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              {t('travel.moreMissing', { count: anomalies.missingTotal - 8 })}
            </p>
          )}
          <TravelReviewList
            title={t('travel.late.title')}
            help={t('travel.late.help')}
            items={anomalies.late || []}
            total={anomalies.lateTotal || 0}
            reasonLabel={(item) => t(`travel.late.reason.${item.reason}`)}
            busy={busy}
            onClaim={claimFor}
            onDismiss={dismiss}
          />
          <TravelReviewList
            title={t('travel.legacy.title')}
            help={t('travel.legacy.help')}
            items={anomalies.legacy || []}
            total={anomalies.legacyTotal || 0}
            reasonLabel={(item) => (item.reason ? t(`travel.legacy.reason.${item.reason}`) : t('travel.legacy.noGuess'))}
            busy={busy}
            onClaim={claimFor}
            onDismiss={dismiss}
          />
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button className="btn-ghost btn-sm" onClick={() => shiftMonth(-1)}>
            <Icon name="chevronLeft" size={15} />
          </button>
          <strong style={{ minWidth: 170, textAlign: 'center', textTransform: 'capitalize' }}>
            {monthLabel(cursor.year, cursor.month)}
          </strong>
          <button className="btn-ghost btn-sm" onClick={() => shiftMonth(1)}>
            <Icon name="chevronRight" size={15} />
          </button>
          <button
            className="btn-ghost btn-sm"
            onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}
          >{t('calendar.today')}</button>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{t('travel.calendarLegend')}</span>
        </div>

        <div className="calendar-grid">
          {weekdayNames('short').map((d) => (
            <div key={d} className="calendar-head">{d}</div>
          ))}
          {cells.map((cell, i) => {
            const hit = travelForDay(cell.iso);
            const spend = cell.iso ? spendByDay.get(cell.iso) : null;
            return (
              <div
                key={i}
                className={[
                  'calendar-day',
                  cell.outside ? 'outside' : '',
                  cell.iso === today ? 'today' : '',
                  hit && !hit.margin ? 'in-travel' : '',
                  hit && hit.margin ? 'in-margin' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={hit ? hit.travel.name : undefined}
              >
                <span>{cell.day}</span>
                {spend > 0 && <span className="day-total">{Math.round(spend)}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="empty-state">
          <p>{t('common.loading')}</p>
        </div>
      ) : (
        /*
         * Trips as a table.
         *
         * This was the last list in the app still built out of cards, and it read
         * as a different product from every other page: a trip's dates, its
         * movement count and its total were three sizes of text inside a box
         * rather than three columns you could sort. Cards also had nowhere to put
         * "margin" and "tag" except a second row that unfolded on edit.
         *
         * Same primitives as Categories and Transactions — useSortableRows,
         * useRowEditor, EditableField, RowActions, and a real `.add-row` at the
         * foot. The "+ Nova viagem" button stays and now simply puts the caret in
         * that row: two ways in, one place where the work happens.
         */
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="table-fixed">
            <thead>
              <tr>
                {travelColumns.map((col) => (
                  <SortHeader key={col.key} column={col} sort={sort} onToggle={toggleSort} />
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedTravels.map((tr) => {
                const editing = travelEditor.isEditing(tr.id);
                const d = travelEditor.draft || {};
                return (
                  <tr
                    key={tr.id}
                    className={editing ? 'is-editing' : undefined}
                    style={{ opacity: busy === tr.id ? 0.5 : 1 }}
                  >
                    <td>
                      <EditableField
                        editing={editing}
                        value={editing ? d.name : tr.name}
                        onChange={(name) => travelEditor.patch({ name })}
                        onStartEdit={() => travelEditor.start(tr, draftOf(tr))}
                        onCommit={travelEditor.commit}
                        onCancel={travelEditor.cancel}
                        placeholder={t('travel.addName')}
                        autoFocus
                      />
                    </td>
                    <td>
                      {editing ? (
                        <EditableField
                          editing
                          value={d.country}
                          onChange={(country) => travelEditor.patch({ country: country.toUpperCase().slice(0, 2) })}
                          placeholder="PT"
                          width={58}
                        />
                      ) : (
                        countryNameOf(tr, t)
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <div>
                          <DateRangeField
                            from={d.startDate}
                            to={d.endDate}
                            onChange={({ from, to }) => travelEditor.patch({ startDate: from, endDate: to })}
                          />
                          {badDates(d) && <span className="amount-negative">{t('travel.badDates')}</span>}
                        </div>
                      ) : (
                        <>
                          {formatRange(tr.startDate, tr.endDate)}
                          <div className="muted" style={{ fontSize: 12 }}>
                            {formatDuration(tr.startDate, tr.endDate)}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="num">
                      {tr.transactionCount}
                      {/* What is still undecided on the trip's own screen, late
                          tail included — the charge that posted after coming
                          home is the one this exists to surface. */}
                      {tr.toReview > 0 && (
                        <div className="muted" style={{ fontSize: 11 }}>
                          {t('travel.toReview', { count: tr.toReview })}
                        </div>
                      )}
                    </td>
                    <td className="num">
                      {/* Travel spend is an expense, not a loss — `symbol="none"`
                          keeps it out of the gain/loss colour scheme entirely. */}
                      <Value amount={tr.total} symbol="none" />
                    </td>
                    <td className="num">
                      {editing ? (
                        <EditableField
                          editing
                          as="number"
                          value={d.forgivingDays ?? 2}
                          onChange={(forgivingDays) => travelEditor.patch({ forgivingDays })}
                          width={56}
                          title={t('travel.marginHelp')}
                        />
                      ) : (
                        t('format.days', { count: tr.forgivingDays ?? 2 })
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <select value={d.tagId ?? ''} onChange={(e) => travelEditor.patch({ tagId: e.target.value })}>
                          <option value="">{t('travel.noTag')}</option>
                          {tags.map((tag) => (
                            <option key={tag.id} value={tag.id}>
                              {tag.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        tags.find((tag) => tag.id === tr.tagId)?.name || <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <RowActions
                        editing={editing}
                        busy={busy === tr.id || travelEditor.busy}
                        deleteMode="modal"
                        onEdit={() => travelEditor.start(tr, draftOf(tr))}
                        onSave={travelEditor.commit}
                        onCancel={travelEditor.cancel}
                        onAskDelete={() => setConfirmDelete(tr)}
                        extras={
                          !editing && (
                            <>
                              <IconButton
                                icon="transactions"
                                label={t('travel.viewTransactions')}
                                onClick={() => openDetails(tr)}
                              />
                              <IconButton
                                icon="tag"
                                label={t('travel.tagWindow')}
                                onClick={() => applyTravel(tr)}
                              />
                            </>
                          )
                        }
                      />
                    </td>
                  </tr>
                );
              })}

              <TravelAddRow
                draft={draft}
                tags={tags}
                inputRef={addNameRef}
                onChange={(patch) => setDraft({ ...draft, ...patch })}
                onAdd={createManual}
                onClear={() => setDraft(emptyTravelDraft())}
              />
            </tbody>
          </table>
          {sortedTravels.length === 0 && (
            <p className="hint" style={{ padding: 'var(--sp-4)' }}>
              {t('travel.empty')}
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete ? t('travel.confirmDelete', { name: confirmDelete.name }) : ''}
        impact={
          confirmDelete ? t('travel.deleteImpact', { count: confirmDelete.transactionCount }) : ''
        }
        busy={busy === confirmDelete?.id}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const id = confirmDelete.id;
          setConfirmDelete(null);
          await removeTravel(id);
        }}
      />

      {openTravel && (
        <div className="modal-overlay" onClick={() => setOpenTravel(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{openTravel.travel.name}</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              {/* Dates through `formatDate`, never inline: this read
                  "2026-08-22" on a page where every other date is dd/mm/aaaa. */}
              {t('travel.modalRange', {
                count: openTravel.transactions.length,
                from: formatDate((openTravel.travel.reviewWindow || openTravel.travel.window)?.from),
                to: formatDate((openTravel.travel.reviewWindow || openTravel.travel.window)?.to),
              })}
            </p>
            {/*
              Each row is decided on its own. "Marcar tudo na janela" is still
              there for the easy case, but a trip window also catches the rent
              and the gym direct debit that happened to fall that week — those
              have to be left alone one at a time.
            */}
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {openTravel.transactions.map((tx) => {
                // Claimed by *this* trip, read off the tag. It used to be
                // `tx.category === 'travel'`, which could not tell one trip from
                // another and could not survive a transaction keeping its real
                // category.
                const marked = (tx.tags || []).includes(openTravel.travel.tagId);
                return (
                  <div key={tx.id} className={`dup-row${marked ? ' row-marked' : ''}`}>
                    <span style={{ minWidth: 84 }}>{formatDate(tx.date)}</span>
                    <span style={{ flex: 1 }}>
                      {tx.description}
                      {/* After the trip: offered because charges abroad post
                          late, and labelled so it is never mistaken for a day of
                          the trip. The reason, when there is one, says why this
                          one looks like it belongs. */}
                      {tx.afterTrip && (
                        <span
                          className={`tag${tx.lateReason ? ' tag-accent' : ''}`}
                          style={{ marginLeft: 6, whiteSpace: 'nowrap', display: 'inline-block' }}
                          title={tx.lateReason ? t(`travel.late.reason.${tx.lateReason}`) : undefined}
                        >
                          {tx.lateReason ? t('travel.afterTripLikely') : t('travel.afterTrip')}
                        </span>
                      )}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{tx.category}</span>
                    <span style={{ minWidth: 74, textAlign: 'right' }}>{formatMoney(tx.amount)}</span>
                    <button
                      className={marked ? 'btn-ghost btn-sm' : 'btn-primary btn-sm'}
                      disabled={busy === tx.id}
                      onClick={() => toggleTravelTag(tx, marked)}
                      title={marked ? t('travel.unclaimHint') : t('travel.claimHint')}
                    >
                      {marked ? t('travel.unclaim') : t('travel.claim')}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setOpenTravel(null)}>{t('common.close')}</button>
            </div>
          </div>
        </div>
      )}

      {/*
        The limbo. A rejected trip is not deleted, because deleting it would let
        detection propose it all over again — which is exactly what used to
        happen. Listing them makes the suppression visible and reversible.
      */}
      {rejected.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <button className="btn-ghost btn-sm" onClick={() => setShowRejected((v) => !v)}>
            <Icon name={showRejected ? 'chevronLeft' : 'chevronRight'} size={14} />
            {rejected.length} proposta(s) recusada(s)
          </button>
          {showRejected && (
            <table style={{ marginTop: 12 }}>
              <tbody>
                {rejected.map((tr) => (
                  <tr key={tr.id}>
                    <td>{tr.countryName || tr.country}</td>
                    <td className="muted">{formatRange(tr.startDate, tr.endDate)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <IconButton
                        icon="refresh"
                        disabled={busy === tr.id}
                        onClick={() => removeTravel(tr.id)}
                        label={t('travel.unreject')}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
