import { useState, useEffect, useRef, useMemo } from 'react';
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
import { configureMoney, usd, usdSigned, pct } from '../lib/money.js';
import ChartCard from '../components/charts/ChartCard.jsx';
import ChartTooltip from '../components/charts/ChartTooltip.jsx';
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

const SORTS = {
  value: (a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0),
  pnl: (a, b) => (b.unrealizedPnl ?? 0) - (a.unrealizedPnl ?? 0),
  roi: (a, b) => (b.roi ?? -Infinity) - (a.roi ?? -Infinity),
  realized: (a, b) => b.realizedPnl - a.realizedPnl,
  name: (a, b) => a.name.localeCompare(b.name),
  qty: (a, b) => b.heldQty - a.heldQty,
};

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
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('positions');
  const [sort, setSort] = useState('value');
  const [search, setSearch] = useState('');
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

  const positions = useMemo(() => {
    if (!data) return [];
    let list = data.positions;
    if (hideSold) list = list.filter((p) => p.heldQty > 0);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return [...list].sort(SORTS[sort]);
  }, [data, sort, search, hideSold]);

  const allocation = useMemo(() => {
    if (!data) return [];
    const held = data.positions.filter((p) => p.heldQty > 0 && p.marketValue > 0);
    return capSeries(
      held.map((p) => ({ name: p.name, value: p.marketValue })),
      { max: 8 }
    );
  }, [data]);

  const allocationColor = useMemo(() => colorScale(allocation.map((a) => a.name)), [allocation]);

  if (loading) return <div className="empty-state"><p>A carregar…</p></div>;

  const s = data?.summary;
  const isEmpty = !s || s.items === 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Investimentos</h2>
          <p style={{ color: INK.secondary, fontSize: 13, marginTop: 2 }}>
            Carteira CS2 · {data?.transactionCount || 0} transacções
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

      {isEmpty ? (
        <div className="empty-state">
          <h3>Ainda não há investimentos</h3>
          <p>
            No Pricempire, abre o teu portfolio, carrega em <strong>Export</strong> e importa aqui o
            CSV. Os preços vêm em USD; o equivalente em euros usa a taxa definida em Settings.
          </p>
        </div>
      ) : (
        <>
          <div className="grid-3" style={{ marginBottom: 16 }}>
            <Stat label="Valor de mercado" value={usd(s.marketValue)} hint={`${s.unitsHeld} unidades em ${s.itemsHeld} itens`} />
            <Stat label="Custo do que tenho" value={usd(s.investedRemaining)} hint={`${usd(s.investedTotal, { withEur: false })} investidos no total`} />
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
              hint={`${usd(s.soldNet, { withEur: false })} recebidos de vendas`}
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
              <strong style={{ fontSize: 13 }}>⚠ {s.mismatches} itens vendidos acima do que foi comprado</strong>
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
              <AreaChart data={data.cashTimeline} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gSpent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...cartesianDefaults.grid} />
                <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={24} />
                <YAxis tickFormatter={(v) => axisMoney(v, 'USD')} {...cartesianDefaults.axis} width={54} />
                <Tooltip
                  content={<ChartTooltip formatLabel={axisMonth} formatValue={(v) => tooltipMoney(v, 'USD')} />}
                  cursor={{ stroke: INK.axis, strokeWidth: 1 }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: INK.secondary }} />
                <Area
                  type="monotone"
                  dataKey="cumulativeSpent"
                  name="Gasto acumulado"
                  stroke={SERIES[0]}
                  strokeWidth={2}
                  fill="url(#gSpent)"
                />
                <Area
                  type="monotone"
                  dataKey="cumulativeReceived"
                  name="Recebido acumulado"
                  stroke={SERIES[2]}
                  strokeWidth={2}
                  fill="none"
                />
              </AreaChart>
            </ChartCard>

            <ChartCard
              title="Alocação por item"
              subtitle="Valor de mercado das posições em carteira"
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
                <Tooltip content={<ChartTooltip formatValue={(v) => tooltipMoney(v, 'USD')} />} />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: INK.secondary }}
                  formatter={(v) => (v.length > 26 ? v.slice(0, 26) + '…' : v)}
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
              <BarChart data={data.byMarketplace} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...cartesianDefaults.grid} />
                <XAxis dataKey="marketplace" {...cartesianDefaults.axis} />
                <YAxis tickFormatter={(v) => axisMoney(v, 'USD')} {...cartesianDefaults.axis} width={54} />
                <Tooltip
                  content={<ChartTooltip formatValue={(v) => tooltipMoney(v, 'USD')} />}
                  cursor={{ fill: 'rgba(139,148,158,0.08)' }}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: INK.secondary }} />
                <Bar dataKey="spent" name="Gasto" fill={SERIES[1]} radius={[4, 4, 0, 0]} />
                <Bar dataKey="received" name="Recebido" fill={SERIES[2]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartCard>

            <ChartCard
              title="Valor de mercado da carteira"
              subtitle="Um ponto por importação"
              empty={(data.valueTimeline?.length || 0) < 2}
              emptyMessage="A curva começa a desenhar-se a partir da segunda importação — o CSV só traz o preço de hoje."
              height={240}
            >
              <AreaChart data={data.valueTimeline} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES[2]} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={SERIES[2]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...cartesianDefaults.grid} />
                <XAxis dataKey="date" tickFormatter={axisDate} {...cartesianDefaults.axis} />
                <YAxis tickFormatter={(v) => axisMoney(v, 'USD')} {...cartesianDefaults.axis} width={54} />
                <Tooltip content={<ChartTooltip formatValue={(v) => tooltipMoney(v, 'USD')} />} />
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
              <>
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="value">Valor de mercado</option>
                  <option value="pnl">Ganho não realizado</option>
                  <option value="roi">ROI</option>
                  <option value="realized">Ganho realizado</option>
                  <option value="qty">Quantidade</option>
                  <option value="name">Nome</option>
                </select>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={hideSold} onChange={(e) => setHideSold(e.target.checked)} />
                  Só o que tenho
                </label>
              </>
            )}
          </div>

          {tab === 'positions' ? (
            <div className="card" style={{ padding: 0, overflow: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style={{ textAlign: 'right' }}>Qtd</th>
                    <th style={{ textAlign: 'right' }}>Custo médio</th>
                    <th style={{ textAlign: 'right' }}>Preço actual</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                    <th style={{ textAlign: 'right' }}>Não realizado</th>
                    <th style={{ textAlign: 'right' }}>Realizado</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p.name}>
                      <td style={{ fontWeight: 500, maxWidth: 320 }}>
                        {p.name}
                        {p.quantityMismatch && (
                          <span title="Vendas acima das compras registadas" style={{ marginLeft: 6 }}>⚠</span>
                        )}
                        {p.floatValue != null && (
                          <div style={{ fontSize: 11, color: INK.secondary }}>
                            float {p.floatValue.toFixed(6)}
                            {p.paintSeed != null && ` · seed ${p.paintSeed}`}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>{p.heldQty}</td>
                      <td style={{ textAlign: 'right' }}>{usd(p.avgCost, { withEur: false })}</td>
                      <td style={{ textAlign: 'right' }}>
                        {p.marketPrice != null ? usd(p.marketPrice, { withEur: false }) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {p.marketValue != null ? usd(p.marketValue, { withEur: false }) : '—'}
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
                    <th>Data</th>
                    <th>Item</th>
                    <th>Tipo</th>
                    <th style={{ textAlign: 'right' }}>Qtd</th>
                    <th style={{ textAlign: 'right' }}>Preço unit.</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th>Marketplace</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions
                    .filter((t) => !search || t.name.toLowerCase().includes(search.toLowerCase()))
                    .slice(0, 500)
                    .map((t) => (
                      <tr key={t.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{t.date}</td>
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
                        <td style={{ textAlign: 'right' }}>{usd(t.unitPrice, { withEur: false })}</td>
                        <td style={{ textAlign: 'right' }}>
                          {usd(t.totalPrice, { withEur: false })}
                          {t.feePercentage > 0 && (
                            <span style={{ fontSize: 11, color: INK.secondary }}> −{t.feePercentage}%</span>
                          )}
                        </td>
                        <td style={{ color: INK.secondary }}>{t.marketplace || '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {transactions.length > 500 && (
                <p style={{ padding: 12, fontSize: 12, color: INK.secondary }}>
                  A mostrar as 500 mais recentes de {transactions.length}.
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
