import { useState, Fragment } from 'react';
import { useT } from '../i18n/index.js';
import { api, errText } from '../lib/api.js';
import { formatDate } from '../lib/format.js';
import { money as displayMoney, nativeOf } from '../lib/money.js';
import Icon from './Icon.jsx';
import IconButton from './ui/IconButton.jsx';

/**
 * ETF positions bought through ActivoBank.
 *
 * The cost shown is the euros that actually left the account, taken from the
 * statement line each order was matched to — the order receipt itself says
 * "Preço 0,00" because it was a market order. Where no statement line could be
 * matched, the row says so rather than quietly showing an estimate as fact.
 *
 * Market value needs an outside quote, which is the one thing the bank
 * documents cannot provide. It is opt-in, and everything here still works at
 * cost without it.
 */

/** Renders in the display currency; the tooltip keeps what the market quoted. */
function money(value, currency = 'EUR') {
  if (value == null) return '—';
  const text = displayMoney(value, { from: currency });
  const native = nativeOf(value, currency);
  return native ? <span title={native}>{text}</span> : text;
}

function Pnl({ value, roi }) {
  if (value == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <span style={{ color: value >= 0 ? 'var(--good)' : 'var(--bad)' }}>
      {displayMoney(value, { from: 'EUR', signed: true })}
      {roi != null && <span style={{ opacity: 0.7 }}> ({roi.toFixed(1)}%)</span>}
    </span>
  );
}

export default function SecuritiesPanel({ securities, onChanged }) {
  const { t } = useT();
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [priceDraft, setPriceDraft] = useState({});

  if (!securities) return null;

  const { positions = [], summary, quotesEnabled } = securities;

  if (positions.length === 0) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <h3>{t('securities.title')}</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6 }}>
          Nenhuma ordem de bolsa encontrada. Os comprovativos de operação chegam por email do
          ActivoBank — carrega em <strong>{t('securities.reprocess')}</strong> em Ligações
          para os voltar a ler.
        </p>
      </div>
    );
  }

  async function refreshQuotes() {
    setBusy('quotes');
    setMessage(null);
    try {
      const r = await api.refreshQuotes(true);
      setMessage(
        `${r.fetched} de ${r.requested} cotações actualizadas` +
          (r.failed?.length ? ` · sem cotação: ${r.failed.join(', ')}` : '')
      );
      onChanged?.();
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(null);
    }
  }

  async function relink() {
    setBusy('link');
    try {
      const r = await api.linkSecurities();
      setMessage(`${r.matched} ordens ligadas ao extrato.`);
      onChanged?.();
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveManualPrice(position) {
    const value = parseFloat(priceDraft[position.name]);
    if (!Number.isFinite(value)) return;
    setBusy(position.name);
    try {
      await api.setSecurityPrice(position.symbol || position.name, value, position.currency);
      setPriceDraft((prev) => ({ ...prev, [position.name]: '' }));
      onChanged?.();
    } catch (err) {
      setMessage(errText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ marginBottom: 24 }}>
      {/*
        A `section-title` like every other panel on the site. It used to be an
        <h3 stretched with flex:1 and two buttons floating off its right edge,
        which sat at a different height from the headings above and below it.
      */}
      <div className="section-title">
        <Icon name="investments" size={17} /> {t('securities.title')}
        <span className="section-title-aside">
          {summary.positions} posições · {money(summary.invested)} investidos
          {summary.fees > 0 && <> · {money(summary.fees)} em comissões</>}
        </span>
        <IconButton
          icon="link"
          label={t('securities.relinkHelp')}
          onClick={relink}
          disabled={busy === 'link'}
        />
        <IconButton
          icon="refresh"
          label={busy === 'quotes' ? 'A obter cotações…' : 'Actualizar cotações'}
          onClick={refreshQuotes}
          disabled={busy === 'quotes'}
        />
      </div>

      {!quotesEnabled && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          As cotações online estão desligadas em Definições — os valores abaixo são o custo real
          pago. Podes actualizar à mão em cada posição, ou activar a busca automática.
        </p>
      )}
      {summary.unpriced > 0 && summary.marketValue != null && (
        <p style={{ fontSize: 12, color: 'var(--warn)', marginBottom: 10 }}>
          {summary.unpriced} posição(ões) sem cotação — o valor de mercado abaixo não as inclui.
        </p>
      )}
      {message && <p style={{ fontSize: 13, marginBottom: 10 }}>{message}</p>}

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <div className="card stat">
          <div className="stat-value" style={{ fontSize: 20 }}>{money(summary.invested)}</div>
          <div className="stat-label">{t('securities.invested')}</div>
        </div>
        <div className="card stat">
          <div className="stat-value" style={{ fontSize: 20 }}>{money(summary.marketValue)}</div>
          <div className="stat-label">{t('securities.marketValue')}</div>
        </div>
        <div className="card stat">
          <div
            className="stat-value"
            style={{
              fontSize: 20,
              color:
                summary.pnl == null
                  ? 'var(--text)'
                  : summary.pnl >= 0
                    ? 'var(--good)'
                    : 'var(--bad)',
            }}
          >
            {summary.pnl == null ? '—' : money(summary.pnl)}
          </div>
          <div className="stat-label">{t('securities.unrealised')}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>{t('securities.security')}</th>
              <th>{t('securities.symbol')}</th>
              <th style={{ textAlign: 'right' }}>{t('securities.quantity')}</th>
              <th style={{ textAlign: 'right' }}>{t('securities.averageCost')}</th>
              <th style={{ textAlign: 'right' }}>{t('securities.invested')}</th>
              <th style={{ textAlign: 'right' }}>{t('securities.quote')}</th>
              <th style={{ textAlign: 'right' }}>{t('securities.value')}</th>
              <th style={{ textAlign: 'right' }}>P&L</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <Fragment key={p.name}>
                <tr>
                  <td>
                    {p.name}
                    {p.estimatedCost && (
                      <span
                        className="evidence strong"
                        style={{ marginLeft: 6 }}
                        title="Alguma ordem não foi ligada a um débito do extrato — o custo dessa parte é estimado pela cotação"
                      >{t('securities.estimatedCost')}</span>
                    )}
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{p.symbol || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{p.quantity}</td>
                  <td style={{ textAlign: 'right' }}>{money(p.avgCost)}</td>
                  <td style={{ textAlign: 'right' }}>{money(p.invested)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {p.marketPrice != null ? (
                      <span title={p.priceDate ? `Cotação de ${formatDate(p.priceDate)}` : undefined}>
                        {money(p.marketPrice)}
                      </span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <input
                          type="number"
                          step="0.01"
                          placeholder={t('securities.price')}
                          value={priceDraft[p.name] || ''}
                          onChange={(e) =>
                            setPriceDraft((prev) => ({ ...prev, [p.name]: e.target.value }))
                          }
                          style={{ width: 88, minWidth: 0, padding: '2px 6px' }}
                        />
                        <button
                          className="btn-ghost btn-sm"
                          onClick={() => saveManualPrice(p)}
                          disabled={busy === p.name}
                        >
                          ok
                        </button>
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>{money(p.marketValue)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Pnl value={p.pnl} roi={p.roi} />
                  </td>
                  <td>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => setExpanded(expanded === p.name ? null : p.name)}
                    >
                      {p.orders.length} ordens
                    </button>
                  </td>
                </tr>
                {expanded === p.name && (
                  <tr>
                    <td colSpan={9} style={{ background: 'var(--surface-2)' }}>
                      {p.orders.map((o, i) => (
                        <div key={i} className="dup-row" style={{ fontSize: 12 }}>
                          <span style={{ minWidth: 84 }}>{formatDate(o.date)}</span>
                          <span style={{ minWidth: 50 }}>{o.side === 'buy' ? 'compra' : 'venda'}</span>
                          <span style={{ minWidth: 50 }}>{o.quantity}x</span>
                          <span style={{ minWidth: 90 }}>@ {money(o.quote)}</span>
                          <span style={{ flex: 1 }}>{money(o.cost)}</span>
                          {o.linked ? (
                            <span className="evidence">
                              <Icon name="link" size={11} />{t('securities.linkedToStatement')}</span>
                          ) : (
                            <span className="evidence strong">{t('securities.noMatchingDebit')}</span>
                          )}
                        </div>
                      ))}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
