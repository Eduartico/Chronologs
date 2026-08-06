import { useState, useEffect, useRef, useMemo } from 'react';
import { formatDate } from '../lib/format.js';
import { usePersistentState } from '../lib/usePersistentState.js';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { api } from '../lib/api.js';
import { configureMoney, usd, usdSigned, pct, eur, convert } from '../lib/money.js';
import ChartCard from '../components/charts/ChartCard.jsx';
import { useSeriesToggle } from '../components/charts/useSeriesToggle.jsx';
import SecuritiesPanel from '../components/SecuritiesPanel.jsx';
import Icon from '../components/Icon.jsx';
import ChartTooltip from '../components/charts/ChartTooltip.jsx';
import SortHeader from '../components/ui/SortHeader.jsx';
import Switch from '../components/ui/Switch.jsx';
import { useSortableRows } from '../lib/useSortableRows.js';
import {
  SERIES,
  STATUS,
  INK,
  colorScale,
  capSeries,
  axisMoney,
  tooltipMoney,
  axisMonth,
  axisDate,
  cartesianDefaults,
} from '../components/charts/chartTheme.js';

// The "ordenar por…" dropdown that used to sit above this table listed the same
// six columns the table already prints across its own head. The columns do the
// job themselves now, and this is the description they sort by.
const POSITION_COLUMNS = [
  { key: 'name', label: 'Item', get: (p) => p.name },
  { key: 'qty', label: 'Qtd', align: 'right', get: (p) => p.heldQty },
  { key: 'avgCost', label: 'Custo médio', align: 'right', get: (p) => p.avgCost ?? 0 },
  { key: 'price', label: 'Preço actual', align: 'right', get: (p) => p.marketPrice ?? 0 },
  { key: 'value', label: 'Valor', align: 'right', get: (p) => p.marketValue ?? 0 },
  { key: 'pnl', label: 'Não realizado', align: 'right', get: (p) => p.unrealizedPnl ?? 0 },
  { key: 'realized', label: 'Realizado', align: 'right', get: (p) => p.realizedPnl ?? 0 },
];

const INVESTMENT_TX_COLUMNS = [
  { key: 'date', label: 'Data', get: (t) => t.date || '' },
  { key: 'name', label: 'Item', get: (t) => t.name },
  { key: 'type', label: 'Tipo', get: (t) => t.type },
  { key: 'quantity', label: 'Qtd', align: 'right', get: (t) => t.quantity },
  { key: 'unitPrice', label: 'Preço unit.', align: 'right', get: (t) => t.unitPrice ?? 0 },
  { key: 'totalPrice', label: 'Total', align: 'right', get: (t) => t.totalPrice ?? 0 },
  { key: 'marketplace', label: 'Marketplace', get: (t) => t.marketplace || '' },
];

const VAULT_COLUMNS = [
  { key: 'vault', label: 'Cofre', get: (v) => v.vault },
  { key: 'deposited', label: 'Guardado', align: 'right', get: (v) => v.deposited },
  { key: 'withdrawn', label: 'Retirado', align: 'right', get: (v) => v.withdrawn },
  { key: 'balance', label: 'Saldo', align: 'right', get: (v) => v.balance },
  { key: 'lastMovement', label: 'Último movimento', get: (v) => v.lastMovement || '' },
];

function Stat({ label, value, tone, hint }) {
  const color =
    tone === 'good' ? STATUS.good : tone === 'bad' ? STATUS.critical : INK.primary;
  return (
    <div className="card stat">
      <div className="stat-value" style={{ color, fontSize: 20 }}>{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div style={{ fontSize: 11, color: INK.secondary, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function PnlCell({ value, roi }) {
  if (value == null) return <span style={{ color: INK.secondary }}>—</span>;
  return (
    <span style={{ color: value >= 0 ? STATUS.good : STATUS.critical }}>
      {usdSigned(value)}
      {roi != null && <span style={{ opacity: 0.7 }}> ({pct(roi)})</span>}
    </span>
  );
}

export default function Investments() {
  const [data, setData] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = usePersistentState('investments.tab', 'positions');
  const [search, setSearch] = usePersistentState('investments.search', '');
  const [hideSold, setHideSold] = useState(true);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState(null);
  const fileInput = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  };

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    api.getAccounts().then(setAccounts).catch(() => setAccounts(null));
    try {
      const [settings, inv, txs] = await Promise.all([
        api.getSettings().catch(() => null),
        api.getInvestments(),
        api.getInvestmentTransactions(),
      ]);
      if (settings) configureMoney(settings);
      setData(inv);
      setTransactions(txs);
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleImport(file) {
    if (!file) return;
    setImporting(true);
    try {
      const r = await api.importInvestmentCsv(file);
      showToast(
        `${r.new} novas transacções de ${r.parsed} linhas` +
          (r.duplicates ? ` · ${r.duplicates} já existiam` : '') +
          (r.unparsedLines ? ` · ${r.unparsedLines} linhas ignoradas` : '')
      );
      await load();
    } catch (err) {
      showToast('Erro: ' + err.message);
    } finally {
      setImporting(false);
    }
  }

  const filteredPositions = useMemo(() => {
    if (!data) return [];
    let list = data.positions;
    if (hideSold) list = list.filter((p) => p.heldQty > 0);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [data, search, hideSold]);

  const {
    rows: positions,
    sort: positionSort,
    toggleSort: togglePositionSort,
  } = useSortableRows(filteredPositions, POSITION_COLUMNS, 'investments.positionSort', {
    key: 'value',
    dir: 'desc',
  });

  const filteredInvestmentTxs = useMemo(
    () =>
      transactions.filter((t) => !search || t.name.toLowerCase().includes(search.toLowerCase())),
    [transactions, search]
  );
  const {
    rows: investmentTxs,
    sort: txSort,
    toggleSort: toggleTxSort,
  } = useSortableRows(filteredInvestmentTxs, INVESTMENT_TX_COLUMNS, 'investments.txSort', {
    key: 'date',
    dir: 'desc',
  });

  // Charts are drawn in the display currency, so the conversion happens here
  // rather than in every axis and tooltip formatter downstream.
  const allocationAll = useMemo(() => {
    if (!data) return [];
    const held = data.positions.filter((p) => p.heldQty > 0 && p.marketValue > 0);
    return capSeries(
      held.map((p) => ({ name: p.name, value: convert(p.marketValue, 'USD') })),
      { max: 8 }
    );
  }, [data]);
  // A pie has no per-series `hide` — the slice has to be gone from the data.
  const allocationFilter = useSeriesToggle(
    'investments.hiddenAllocation',
    allocationAll.map((a) => a.name)
  );
  const allocation = useMemo(
    () => allocationAll.filter((a) => !allocationFilter.hidden.has(a.name)),
    [allocationAll, allocationFilter.hidden]
  );

  const cashflowSeriesFilter = useSeriesToggle('investments.hiddenCashTimeline', [
    'cumulativeSpent',
    'cumulativeReceived',
  ]);
  const marketplaceFilter = useSeriesToggle('investments.hiddenMarketplace', ['spent', 'received']);

  const cashTimeline = useMemo(
    () =>
      (data?.cashTimeline || []).map((row) => ({
        ...row,
        cumulativeSpent: convert(row.cumulativeSpent, 'USD'),
        cumulativeReceived: convert(row.cumulativeReceived, 'USD'),
      })),
    [data]
  );

  const byMarketplace = useMemo(
    () =>
      (data?.byMarketplace || []).map((row) => ({
        ...row,
        spent: convert(row.spent, 'USD'),
        received: convert(row.received, 'USD'),
      })),
    [data]
  );

  const valueTimeline = useMemo(
    () => (data?.valueTimeline || []).map((row) => ({ ...row, value: convert(row.value, 'USD') })),
    [data]
  );

  const allocationColor = useMemo(() => colorScale(allocationAll.map((a) => a.name)), [allocationAll]);

  if (loading) return <div className="empty-state"><p>A carregar…</p></div>;

  const s = data?.summary;
  const isEmpty = !s || s.items === 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Activos</h2>
          <p style={{ color: INK.secondary, fontSize: 13, marginTop: 2 }}>
            {accounts?.vaults?.length || 0} cofres de poupança · {data?.securities?.positions?.length || 0}{' '}
            posições em bolsa · carteira CS2 com {data?.transactionCount || 0} transacções
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={fileInput}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              handleImport(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button className="btn-primary" onClick={() => fileInput.current?.click()} disabled={importing}>
            {importing ? 'A importar…' : '↑ Importar CSV do Pricempire'}
          </button>
          <button className="btn-ghost" onClick={load}>↻ Actualizar</button>
        </div>
      </div>

      {/* ETFs come from the bank's own documents and exist independently of the
          CS2 portfolio, so they render above the empty state rather than inside
          it — an empty skin portfolio must not hide them. */}
      <SavingsPanel accounts={accounts} />

      <SecuritiesPanel securities={data?.securities} onChanged={load} />

      <h3 className="section-title">CS2 (Pricempire)</h3>

      {isEmpty ? (
        <div className="empty-state">
          <h3>Ainda não há investimentos em CS2</h3>
          <p>
            No Pricempire, abre o teu portfolio, carrega em <strong>Export</strong> e importa aqui o
            CSV — ou usa <strong>Ressincronizar</strong> em Ligações para o fazer automaticamente.
            Os preços vêm em USD; o equivalente em euros usa a taxa definida em Definições.
          </p>
        </div>
      ) : (
        <>
          <div className="grid-3" style={{ marginBottom: 16 }}>
            <Stat label="Valor de mercado" value={usd(s.marketValue)} hint={`${s.unitsHeld} unidades em ${s.itemsHeld} itens`} />
            <Stat label="Custo do que tenho" value={usd(s.investedRemaining)} hint={`${usd(s.investedTotal)} investidos no total`} />
            <Stat
              label="Ganho não realizado"
              value={usdSigned(s.unrealizedPnl)}
              tone={s.unrealizedPnl >= 0 ? 'good' : 'bad'}
              hint={s.roi != null ? `ROI ${pct(s.roi)}` : null}
            />
          </div>
          <div className="grid-3" style={{ marginBottom: 24 }}>
            <Stat
              label="Ganho realizado"
              value={usdSigned(s.realizedPnl)}
              tone={s.realizedPnl >= 0 ? 'good' : 'bad'}
              hint={`${usd(s.soldNet)} recebidos de vendas`}
            />
            <Stat
              label="Resultado total"
              value={usdSigned(s.totalPnl)}
              tone={s.totalPnl >= 0 ? 'good' : 'bad'}
              hint="realizado + não realizado"
            />
            <Stat label="Taxas pagas" value={usd(s.fees)} hint="Steam 15% · CSFloat 2%" />
          </div>

          {s.mismatches > 0 && (
            <div
              className="card"
              style={{ marginBottom: 16, borderLeft: `3px solid ${STATUS.warning}` }}
            >
              <strong style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="alert" size={14} /> {s.mismatches} itens vendidos acima do que foi comprado
              </strong>
              <p style={{ color: INK.secondary, fontSize: 12, margin: '4px 0 0' }}>
                O export começa a meio do histórico, por isso há vendas sem a compra correspondente.
                O ganho realizado desses itens está sobrestimado — só conta o custo das unidades que
                aparecem no ficheiro.
              </p>
            </div>
          )}

          <div className="grid-2" style={{ marginBottom: 16 }}>
            <ChartCard
              title="Dinheiro investido ao longo do tempo"
              subtitle="Acumulado, líquido de taxas"
              empty={!data.cashTimeline?.length}
              height={260}
              footnote="Reconstruído a partir das transacções — o export não traz histórico de preços."
            >
              <AreaChart data={cashTimeline} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gSpent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...cartesianDefaults.grid} />
                <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={24} />
                <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} width={54} />
                <Tooltip
                  content={<ChartTooltip formatLabel={axisMonth} formatValue={tooltipMoney} />}
                  cursor={{ stroke: INK.axis, strokeWidth: 1 }}
                />
                <Legend {...cashflowSeriesFilter.legendProps} />
                <Area
                  type="monotone"
                  dataKey="cumulativeSpent"
                  name="Gasto acumulado"
                  hide={cashflowSeriesFilter.hidden.has('cumulativeSpent')}
                  stroke={SERIES[0]}
                  strokeWidth={2}
                  fill="url(#gSpent)"
                />
                <Area
                  type="monotone"
                  dataKey="cumulativeReceived"
                  name="Recebido acumulado"
                  hide={cashflowSeriesFilter.hidden.has('cumulativeReceived')}
                  stroke={SERIES[2]}
                  strokeWidth={2}
                  fill="none"
                />
              </AreaChart>
            </ChartCard>

            <ChartCard
              title="Alocação por item"
              subtitle={
                allocationFilter.hidden.size
                  ? `${allocationFilter.hidden.size} escondido(s) — clica na legenda para repor`
                  : 'Clica num item da legenda para o esconder, duplo clique para o isolar'
              }
              empty={allocation.length === 0}
              height={260}
            >
              <PieChart>
                <Pie
                  data={allocation}
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={100}
                  dataKey="value"
                  paddingAngle={2}
                  stroke={INK.surface}
                  strokeWidth={2}
                >
                  {allocation.map((a) => (
                    <Cell key={a.name} fill={allocationColor(a.name)} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip formatValue={tooltipMoney} />} />
                <Legend
                  payload={allocationAll.map((a) => ({
                    value: a.name,
                    type: 'circle',
                    color: allocationColor(a.name),
                  }))}
                  wrapperStyle={{ fontSize: 11, color: INK.secondary, cursor: 'pointer' }}
                  onClick={allocationFilter.legendProps.onClick}
                  onDoubleClick={allocationFilter.legendProps.onDoubleClick}
                  formatter={(v) => (
                    <span style={{ opacity: allocationFilter.hidden.has(v) ? 0.35 : 1 }}>
                      {v.length > 26 ? v.slice(0, 26) + '…' : v}
                    </span>
                  )}
                />
              </PieChart>
            </ChartCard>
          </div>

          <div className="grid-2" style={{ marginBottom: 16 }}>
            <ChartCard
              title="Por marketplace"
              subtitle="Gasto vs. recebido, líquido de taxas"
              empty={!data.byMarketplace?.length}
              height={240}
            >
              <BarChart data={byMarketplace} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...cartesianDefaults.grid} />
                <XAxis dataKey="marketplace" {...cartesianDefaults.axis} />
                <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} width={54} />
                <Tooltip
                  content={<ChartTooltip formatValue={tooltipMoney} />}
                  cursor={{ fill: 'rgba(139,148,158,0.08)' }}
                />
                <Legend {...marketplaceFilter.legendProps} />
                <Bar
                  dataKey="spent"
                  name="Gasto"
                  hide={marketplaceFilter.hidden.has('spent')}
                  fill={SERIES[1]}
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="received"
                  name="Recebido"
                  hide={marketplaceFilter.hidden.has('received')}
                  fill={SERIES[2]}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartCard>

            <ChartCard
              title="Valor de mercado da carteira"
              subtitle="Um ponto por importação"
              empty={(data.valueTimeline?.length || 0) < 2}
              emptyMessage="A curva começa a desenhar-se a partir da segunda importação — o CSV só traz o preço de hoje."
              height={240}
            >
              <AreaChart data={valueTimeline} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES[2]} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={SERIES[2]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...cartesianDefaults.grid} />
                <XAxis dataKey="date" tickFormatter={axisDate} {...cartesianDefaults.axis} />
                <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} width={54} />
                <Tooltip content={<ChartTooltip formatValue={tooltipMoney} />} />
                <Area
                  type="monotone"
                  dataKey="value"
                  name="Valor de mercado"
                  stroke={SERIES[2]}
                  strokeWidth={2}
                  fill="url(#gValue)"
                />
              </AreaChart>
            </ChartCard>
          </div>

          <div className="filter-bar">
            <select value={tab} onChange={(e) => setTab(e.target.value)}>
              <option value="positions">Posições</option>
              <option value="transactions">Transacções</option>
            </select>
            <input
              placeholder="Procurar item…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 220 }}
            />
            {tab === 'positions' && (
              <Switch checked={hideSold} onChange={setHideSold} label="Só o que tenho" />
            )}
          </div>

          {tab === 'positions' ? (
            <div className="card" style={{ padding: 0, overflow: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    {POSITION_COLUMNS.map((col) => (
                      <SortHeader
                        key={col.key}
                        column={col}
                        sort={positionSort}
                        onToggle={togglePositionSort}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p.name}>
                      <td style={{ fontWeight: 500, maxWidth: 320 }}>
                        {p.name}
                        {p.quantityMismatch && (
                          <span
                            title="Vendas acima das compras registadas"
                            style={{ marginLeft: 6, display: 'inline-flex', verticalAlign: 'middle' }}
                          >
                            <Icon name="alert" size={12} />
                          </span>
                        )}
                        {p.floatValue != null && (
                          <div style={{ fontSize: 11, color: INK.secondary }}>
                            float {p.floatValue.toFixed(6)}
                            {p.paintSeed != null && ` · seed ${p.paintSeed}`}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>{p.heldQty}</td>
                      <td style={{ textAlign: 'right' }}>{usd(p.avgCost)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {p.marketPrice != null ? usd(p.marketPrice) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {p.marketValue != null ? usd(p.marketValue) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <PnlCell value={p.unrealizedPnl} roi={p.roi} />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {p.soldQty > 0 ? <PnlCell value={p.realizedPnl} /> : <span style={{ color: INK.secondary }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    {INVESTMENT_TX_COLUMNS.map((col) => (
                      <SortHeader key={col.key} column={col} sort={txSort} onToggle={toggleTxSort} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {investmentTxs
                    .slice(0, 500)
                    .map((t) => (
                      <tr key={t.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(t.date)}</td>
                        <td style={{ maxWidth: 300 }}>{t.name}</td>
                        <td>
                          <span
                            className="badge"
                            style={{
                              background: t.type === 'buy' ? 'rgba(57,135,229,0.15)' : 'rgba(25,158,112,0.15)',
                              color: t.type === 'buy' ? SERIES[0] : STATUS.good,
                            }}
                          >
                            {t.type === 'buy' ? 'compra' : 'venda'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>{t.quantity}</td>
                        <td style={{ textAlign: 'right' }}>{usd(t.unitPrice)}</td>
                        <td style={{ textAlign: 'right' }}>
                          {usd(t.totalPrice)}
                          {t.feePercentage > 0 && (
                            <span style={{ fontSize: 11, color: INK.secondary }}> −{t.feePercentage}%</span>
                          )}
                        </td>
                        <td style={{ color: INK.secondary }}>{t.marketplace || '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {investmentTxs.length > 500 && (
                <p style={{ padding: 12, fontSize: 12, color: INK.secondary }}>
                  A mostrar 500 de {investmentTxs.length} pela ordem escolhida.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/**
 * Savings as an asset class.
 *
 * The €3.967 sitting in the PoupeUp vaults is as much an asset as an ETF
 * holding, and until internal transfers were understood it was invisible here —
 * it read as spending. It earns almost nothing, which is exactly why it belongs
 * next to the things that do: seeing them side by side is the point.
 */
function SavingsPanel({ accounts }) {
  const { rows: vaults, sort, toggleSort } = useSortableRows(
    accounts?.vaults || [],
    VAULT_COLUMNS,
    'investments.vaultSort',
    { key: 'balance', dir: 'desc' }
  );
  if (!accounts?.vaults?.length) return null;
  const { vaultTotal, reconciliation } = accounts;

  return (
    <>
      <h3 className="section-title">
        <Icon name="vault" size={17} /> Poupança
        <span className="section-title-aside">{eur(vaultTotal)}</span>
      </h3>
      <div className="card" style={{ padding: 0, overflow: 'auto', marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              {VAULT_COLUMNS.map((col) => (
                <SortHeader key={col.key} column={col} sort={sort} onToggle={toggleSort} />
              ))}
            </tr>
          </thead>
          <tbody>
            {vaults.map((v) => (
              <tr key={v.vault} className={v.short ? 'row-warn' : undefined}>
                <td>
                  {v.vault}
                  {v.unnamed && <span className="tag">sem nome</span>}
                </td>
                <td className="num amount-positive">{eur(v.deposited)}</td>
                <td className="num amount-negative">{eur(v.withdrawn)}</td>
                <td className="num">
                  <strong>{eur(v.balance)}</strong>
                </td>
                <td className="muted">{formatDate(v.lastMovement)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {reconciliation && !reconciliation.balanced && (
        <p className="hint">
          O extracto da conta poupança diz {eur(reconciliation.statementBalance)} a{' '}
          {formatDate(reconciliation.statementDate)}; os movimentos explicam{' '}
          {eur(reconciliation.computed)}. A diferença de {eur(reconciliation.unaccounted)} é o que a
          conta já tinha antes do primeiro extracto ingerido. Repartição por cofre em{' '}
          <strong>Contas</strong>.
        </p>
      )}
    </>
  );
}
