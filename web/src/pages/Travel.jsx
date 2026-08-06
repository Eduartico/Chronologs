import { useState, useEffect, useCallback, useMemo } from 'react';
import { formatDate, formatDuration, formatRange } from '../lib/format.js';
import { api } from '../lib/api.js';
import Icon from '../components/Icon.jsx';
import IconButton from '../components/ui/IconButton.jsx';
import RowActions from '../components/ui/RowActions.jsx';
import EditableField from '../components/ui/EditableField.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { DateRangeField } from '../components/ui/DateField.jsx';
import { useRowEditor } from '../lib/useRowEditor.js';

/**
 * Travel calendar.
 *
 * Trips are a first-class thing here rather than a tag, because they have to
 * answer two questions a tag cannot: which days count (including a forgiving
 * margin for the flight booked the night before), and what was spent while
 * away. Detection proposes; the user confirms.
 */

const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthLabel(year, month) {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString('pt-PT', {
    month: 'long',
    year: 'numeric',
  });
}

function isoOf(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Monday-first grid covering the whole month, padded with adjacent days. */
function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7;
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
  return (
    <div style={{ flex: 1, minWidth: 240 }}>
      <div className="travel-headline">
        <EditableField
          editing={editing}
          value={editing ? draft.name : title}
          onChange={(name) => patch({ name })}
          placeholder="Valência, Tui, fim-de-semana…"
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
            title="Código do país"
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
  const [showForm, setShowForm] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  // A trip takes its tagged transactions with it, so deleting one is worth
  // stopping for — the armed bin is for things that are cheap to redo.
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [draft, setDraft] = useState({ name: '', country: '', startDate: '', endDate: '' });

  // Rejected trips are kept, not deleted: they are what stops detection from
  // proposing the same non-trip again, and they have to be undoable.
  const active = travels.filter((t) => t.status !== 'rejected');
  const rejected = travels.filter((t) => t.status === 'rejected');

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
      showToast('Erro: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
        found.length === 0
          ? 'Nenhuma viagem nova detectada.'
          : `${found.length} viagem(ns) proposta(s) — confirma as que reconheces.`
      );
    } catch (err) {
      showToast('Erro: ' + err.message);
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
      showToast('Erro: ' + err.message);
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
      showToast('Erro: ' + err.message);
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
                      ...t,
                      category: marked ? 'uncategorized' : 'travel',
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
      showToast('Erro: ' + err.message);
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
      showToast('Erro: ' + err.message);
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
      setDraft({ name: '', country: '', startDate: '', endDate: '' });
      setShowForm(false);
      await load();
    } catch (err) {
      showToast('Erro: ' + err.message);
    }
  }

  async function removeTravel(id) {
    setBusy(id);
    try {
      await api.deleteTravel(id);
      if (openTravel?.travel?.id === id) setOpenTravel(null);
      await load();
    } catch (err) {
      showToast('Erro: ' + err.message);
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
      showToast('Erro: ' + err.message);
    } finally {
      setBusy(null);
    }
  }

  async function applyTravel(travel, options) {
    setBusy(travel.id);
    try {
      const r = await api.applyTravel(travel.id, options);
      showToast(
        `${r.categorized} categorizadas e ${r.tagged} marcadas de ${r.matched} na janela da viagem.`
      );
      await load();
      if (openTravel?.travel?.id === travel.id) await openDetails(travel);
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setBusy(null);
    }
  }

  async function loadAnomalies() {
    setBusy('anomalies');
    try {
      setAnomalies(await api.getTravelAnomalies());
    } catch (err) {
      showToast('Erro: ' + err.message);
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
          <h2>Viagens</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
            {travels.length} viagem(ns) registada(s) · abre uma viagem e marca à mão o que foi
            gasto nela — a janela de datas só propõe candidatos, não decide sozinha
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-ghost" onClick={loadAnomalies} disabled={busy === 'anomalies'}>
            Verificar etiquetagem
          </button>
          <button className="btn-ghost" onClick={detect} disabled={busy === 'detect'}>
            {busy === 'detect' ? 'A analisar…' : 'Detectar viagens'}
          </button>
          <button className="btn-primary" onClick={() => setShowForm((s) => !s)}>
            + Nova viagem
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              placeholder="Nome (ex.: Dublin com a Carol)"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              style={{ flex: 2, minWidth: 200 }}
              autoFocus
            />
            <input
              placeholder="País (ex.: IE)"
              value={draft.country}
              onChange={(e) => setDraft({ ...draft, country: e.target.value.toUpperCase() })}
              style={{ width: 110, minWidth: 0 }}
              maxLength={2}
            />
            <DateRangeField
              from={draft.startDate}
              to={draft.endDate}
              onChange={({ from, to }) => setDraft({ ...draft, startDate: from, endDate: to })}
              labels={{ from: 'Início', to: 'Fim' }}
            />
            {!badDates(draft) && (
              <span className="muted" style={{ fontSize: 12 }}>
                {formatDuration(draft.startDate, draft.endDate)}
              </span>
            )}
            <RowActions
              editing
              onSave={createManual}
              onCancel={() => setShowForm(false)}
            />
          </div>
        </div>
      )}

      {proposals.length > 0 && (
        <>
          <h3 className="section-title">
            <Icon name="travel" size={18} /> Viagens detectadas
          </h3>
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
                            label="Confirmar viagem"
                            onClick={() => confirmProposal(p)}
                          />
                          <IconButton
                            icon="pencil"
                            label="Corrigir antes de confirmar"
                            onClick={() => proposalEditor.start(p, draftOf(p))}
                          />
                          <IconButton
                            icon="close"
                            tone="danger"
                            label="Não foi viagem"
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
            <h3>Etiquetagem</h3>
            <button className="btn-ghost btn-sm" onClick={() => setAnomalies(null)}>Fechar</button>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
            <strong>{anomalies.missingTotal}</strong> transacções caem dentro de uma viagem mas não
            estão marcadas como tal, e <strong>{anomalies.strayTotal}</strong> estão marcadas como
            viagem fora de qualquer janela.
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
              … e mais {anomalies.missingTotal - 8}. Abre a viagem e usa "Marcar tudo na janela".
            </p>
          )}
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
          >
            Hoje
          </button>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
            Dias a azul = viagem · tracejado = margem
          </span>
        </div>

        <div className="calendar-grid">
          {WEEKDAYS.map((d) => (
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
        <div className="empty-state"><p>A carregar…</p></div>
      ) : active.length === 0 ? (
        <div className="empty-state">
          <h3>Ainda não há viagens</h3>
          <p>
            Carrega em <strong>Detectar viagens</strong> para procurar compras no estrangeiro no
            histórico, ou adiciona uma à mão.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {active.map((t) => {
            const editing = travelEditor.isEditing(t.id);
            return (
            <div key={t.id} className="card" style={{ opacity: busy === t.id ? 0.5 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <TravelHeadline
                  title={t.name}
                  editing={editing}
                  draft={travelEditor.draft}
                  patch={travelEditor.patch}
                  meta={
                    <>
                      {formatRange(t.startDate, t.endDate)} · {formatDuration(t.startDate, t.endDate)}
                      {t.countryName && ` · ${t.countryName}`} · {t.transactionCount} transacções na
                      janela · {formatMoney(t.total)}
                    </>
                  }
                />
                <RowActions
                  editing={editing}
                  busy={busy === t.id || travelEditor.busy}
                  deleteMode="modal"
                  onEdit={() => travelEditor.start(t, draftOf(t))}
                  onSave={travelEditor.commit}
                  onCancel={travelEditor.cancel}
                  onAskDelete={() => setConfirmDelete(t)}
                  extras={
                    !editing && (
                      <>
                        <IconButton
                          icon="transactions"
                          label="Ver transacções"
                          onClick={() => openDetails(t)}
                        />
                        <IconButton
                          icon="tag"
                          label="Marcar tudo na janela: categoriza como travel tudo o que está por classificar"
                          onClick={() => applyTravel(t, { category: 'travel', onlyUncategorized: true })}
                        />
                      </>
                    )
                  }
                />
              </div>

              {/*
                Margin and tag are settings, not readings. They used to be two
                live controls on every card — a number box and a dropdown per
                trip, sitting there being nothing most of the time. They belong
                to the edit state, with everything else that is writable.
              */}
              {editing && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Margem (dias):</span>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    value={travelEditor.draft?.forgivingDays ?? 2}
                    onChange={(e) => travelEditor.patch({ forgivingDays: e.target.value })}
                    style={{ width: 70, minWidth: 0 }}
                  />
                  <select
                    value={travelEditor.draft?.tagId ?? ''}
                    onChange={(e) => travelEditor.patch({ tagId: e.target.value })}
                  >
                    <option value="">Sem tag</option>
                    {tags.map((tag) => (
                      <option key={tag.id} value={tag.id}>{tag.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {!editing && (t.forgivingDays ?? 2) !== 2 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                  margem de {t.forgivingDays} dias
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete ? `Apagar a viagem "${confirmDelete.name}"?` : ''}
        impact={
          confirmDelete
            ? `${confirmDelete.transactionCount} transacções na janela deixam de estar ligadas a uma viagem e a tag da viagem é removida. O histórico das transacções mantém-se.`
            : ''
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
              {openTravel.transactions.length} transacções entre{' '}
              {openTravel.travel.window?.from} e {openTravel.travel.window?.to}
            </p>
            {/*
              Each row is decided on its own. "Marcar tudo na janela" is still
              there for the easy case, but a trip window also catches the rent
              and the gym direct debit that happened to fall that week — those
              have to be left alone one at a time.
            */}
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {openTravel.transactions.map((tx) => {
                const marked = tx.category === 'travel';
                return (
                  <div key={tx.id} className={`dup-row${marked ? ' row-marked' : ''}`}>
                    <span style={{ minWidth: 84 }}>{formatDate(tx.date)}</span>
                    <span style={{ flex: 1 }}>{tx.description}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{tx.category}</span>
                    <span style={{ minWidth: 74, textAlign: 'right' }}>{formatMoney(tx.amount)}</span>
                    <button
                      className={marked ? 'btn-ghost btn-sm' : 'btn-primary btn-sm'}
                      disabled={busy === tx.id}
                      onClick={() => toggleTravelTag(tx, marked)}
                      title={marked ? 'Deixar de contar como viagem' : 'Contar como viagem'}
                    >
                      {marked ? 'Retirar' : 'Marcar'}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setOpenTravel(null)}>Fechar</button>
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
                {rejected.map((t) => (
                  <tr key={t.id}>
                    <td>{t.countryName || t.country}</td>
                    <td className="muted">{formatRange(t.startDate, t.endDate)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <IconButton
                        icon="refresh"
                        disabled={busy === t.id}
                        onClick={() => removeTravel(t.id)}
                        label="Repor: deixa de estar recusada e volta a poder ser detectada"
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
