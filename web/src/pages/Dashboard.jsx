import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import { api } from '../lib/api.js';
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
  cartesianDefaults,
} from '../components/charts/chartTheme.js';

const GRANULARITIES = [
  { id: 'month', label: 'Mensal' },
  { id: 'quarter', label: 'Trimestral' },
  { id: 'year', label: 'Anual' },
];

const PRESETS = [
  { id: '12m', label: 'Últimos 12 meses', months: 12 },
  { id: '24m', label: 'Últimos 24 meses', months: 24 },
  { id: 'ytd', label: 'Este ano', ytd: true },
  { id: 'all', label: 'Tudo' },
];

function isoMonthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function rangeFor(preset) {
  if (preset === 'all') return { from: '', to: '' };
  if (preset === 'ytd') return { from: `${new Date().getFullYear()}-01-01`, to: '' };
  const p = PRESETS.find((x) => x.id === preset);
  return { from: isoMonthsAgo(p?.months ?? 12), to: '' };
}

function eur(v) {
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(v || 0);
}

function Stat({ label, value, tone, hint }) {
  const color = tone === 'good' ? STATUS.good : tone === 'bad' ? STATUS.critical : INK.primary;
  return (
    <div className="card stat">
      <div className="stat-value" style={{ color }}>{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div style={{ fontSize: 11, color: INK.secondary, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState('12m');
  const [range, setRange] = useState(rangeFor('12m'));
  const [granularity, setGranularity] = useState('month');
  const [categories, setCategories] = useState([]);
  const [selectedCats, setSelectedCats] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await api.getAnalytics({
          from: range.from || undefined,
          to: range.to || undefined,
          granularity,
          categories: selectedCats.length ? selectedCats.join(',') : undefined,
        })
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, granularity, selectedCats]);

  useEffect(() => {
    load();
  }, [load]);

  function applyPreset(id) {
    setPreset(id);
    setRange(rangeFor(id));
  }

  const cashflow = data?.monthlyCashflow || [];
  const trend = data?.categoryTrend || { categories: [], rows: [] };
  const trendColor = useMemo(() => colorScale(trend.categories), [trend.categories]);

  const breakdown = useMemo(
    () =>
      capSeries(
        (data?.categoryBreakdown || [])
          .filter((c) => c.expense > 0)
          .map((c) => ({ name: c.category, value: c.expense })),
        { max: 8 }
      ),
    [data]
  );
  const breakdownColor = useMemo(() => colorScale(breakdown.map((b) => b.name)), [breakdown]);

  const totals = useMemo(() => {
    const income = cashflow.reduce((s, m) => s + m.income, 0);
    const expense = cashflow.reduce((s, m) => s + m.expense, 0);
    return {
      income,
      expense,
      net: income - expense,
      savings: income > 0 ? ((income - expense) / income) * 100 : null,
      avgExpense: cashflow.length ? expense / cashflow.length : 0,
    };
  }, [cashflow]);

  const periodWord = granularity === 'year' ? 'ano' : granularity === 'quarter' ? 'trimestre' : 'mês';

  if (error) {
    return (
      <div className="empty-state">
        <h3>Não foi possível carregar</h3>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Dashboard</h2>
          {data?.range && (
            <p style={{ color: INK.secondary, fontSize: 13, marginTop: 2 }}>
              {data.range.matched} de {data.range.total} transacções
              {data.range.earliest && ` · histórico desde ${data.range.earliest}`}
            </p>
          )}
        </div>
        <button className="btn-ghost" onClick={load}>↻ Actualizar</button>
      </div>

      {/* One control row above the charts drives every series on the page. */}
      <div className="filter-bar">
        <select value={preset} onChange={(e) => applyPreset(e.target.value)}>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <input
          type="date"
          value={range.from}
          onChange={(e) => {
            setRange({ ...range, from: e.target.value });
            setPreset('custom');
          }}
          title="De"
        />
        <input
          type="date"
          value={range.to}
          onChange={(e) => {
            setRange({ ...range, to: e.target.value });
            setPreset('custom');
          }}
          title="Até"
        />
        <select value={granularity} onChange={(e) => setGranularity(e.target.value)}>
          {GRANULARITIES.map((g) => (
            <option key={g.id} value={g.id}>{g.label}</option>
          ))}
        </select>
        <select
          value={selectedCats[0] || ''}
          onChange={(e) => setSelectedCats(e.target.value ? [e.target.value] : [])}
        >
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <Stat label="Receitas" value={eur(totals.income)} tone="good" />
        <Stat label="Despesas" value={eur(totals.expense)} tone="bad" hint={`${eur(totals.avgExpense)} por ${periodWord}`} />
        <Stat
          label="Saldo"
          value={eur(totals.net)}
          tone={totals.net >= 0 ? 'good' : 'bad'}
          hint={totals.savings != null ? `taxa de poupança ${totals.savings.toFixed(1)}%` : null}
        />
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <ChartCard title="Receitas e despesas" subtitle={`Por ${periodWord}`} loading={loading} empty={!cashflow.length} height={280}>
          <BarChart data={cashflow} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...cartesianDefaults.grid} />
            <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
            <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} width={54} />
            <Tooltip
              content={<ChartTooltip formatLabel={axisMonth} formatValue={tooltipMoney} />}
              cursor={{ fill: 'rgba(139,148,158,0.08)' }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="income" name="Receitas" fill={SERIES[2]} radius={[4, 4, 0, 0]} />
            <Bar dataKey="expense" name="Despesas" fill={SERIES[1]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Saldo acumulado" subtitle="Soma corrente do saldo de cada período" loading={loading} empty={!data?.cumulative?.length} height={280}>
          <AreaChart data={data?.cumulative || []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gCum" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.35} />
                <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid {...cartesianDefaults.grid} />
            <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
            <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} width={54} />
            <Tooltip content={<ChartTooltip formatLabel={axisMonth} formatValue={tooltipMoney} />} />
            <ReferenceLine y={0} stroke={INK.axis} />
            <Area
              type="monotone"
              dataKey="cumulative"
              name="Saldo acumulado"
              stroke={SERIES[0]}
              strokeWidth={2}
              fill="url(#gCum)"
            />
          </AreaChart>
        </ChartCard>
      </div>

      <div style={{ marginBottom: 16 }}>
        <ChartCard
          title="Despesa por categoria ao longo do tempo"
          subtitle="Área empilhada — mostra o que mudou, não só o total"
          loading={loading}
          empty={!trend.rows.length}
          height={300}
        >
          <AreaChart data={trend.rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...cartesianDefaults.grid} />
            <XAxis dataKey="period" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
            <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} width={54} />
            <Tooltip content={<ChartTooltip formatLabel={axisMonth} formatValue={tooltipMoney} total />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {trend.categories.map((cat) => (
              <Area
                key={cat}
                type="monotone"
                dataKey={cat}
                name={cat}
                stackId="spend"
                stroke={trendColor(cat)}
                fill={trendColor(cat)}
                fillOpacity={0.75}
                /* A 2px surface-coloured seam keeps adjacent bands legible when
                   their hues are close. */
                strokeWidth={2}
                strokeOpacity={1}
              />
            ))}
          </AreaChart>
        </ChartCard>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <ChartCard title="Repartição da despesa" subtitle="No período seleccionado" loading={loading} empty={!breakdown.length} height={280}>
          <PieChart>
            <Pie
              data={breakdown}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={104}
              dataKey="value"
              paddingAngle={2}
              stroke={INK.surface}
              strokeWidth={2}
            >
              {breakdown.map((b) => (
                <Cell key={b.name} fill={breakdownColor(b.name)} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip formatValue={tooltipMoney} />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ChartCard>

        <ChartCard title="Onde gastas mais" subtitle="Top 10 comerciantes" loading={loading} empty={!data?.topMerchants?.length} height={280}>
          <BarChart
            data={data?.topMerchants || []}
            layout="vertical"
            margin={{ top: 4, right: 12, left: 0, bottom: 0 }}
          >
            <CartesianGrid {...cartesianDefaults.grid} horizontal={false} vertical />
            <XAxis type="number" tickFormatter={axisMoney} {...cartesianDefaults.axis} />
            <YAxis
              type="category"
              dataKey="merchant"
              width={140}
              {...cartesianDefaults.axis}
              tickFormatter={(v) => (v.length > 20 ? v.slice(0, 20) + '…' : v)}
            />
            <Tooltip
              content={<ChartTooltip formatValue={tooltipMoney} />}
              cursor={{ fill: 'rgba(139,148,158,0.08)' }}
            />
            <Bar dataKey="total" name="Gasto" fill={SERIES[0]} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ChartCard>
      </div>

      <ChartCard
        title="Taxa de poupança"
        subtitle="Percentagem das receitas que sobrou em cada período"
        loading={loading}
        empty={!data?.savingsRate?.some((r) => r.rate != null)}
        emptyMessage="Sem receitas registadas neste período — a taxa de poupança precisa delas."
        height={220}
      >
        <LineChart data={data?.savingsRate || []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...cartesianDefaults.grid} />
          <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
          <YAxis tickFormatter={(v) => `${v}%`} {...cartesianDefaults.axis} width={44} />
          <Tooltip
            content={<ChartTooltip formatLabel={axisMonth} formatValue={(v) => `${v}%`} />}
          />
          <ReferenceLine y={0} stroke={INK.axis} />
          <Line
            type="monotone"
            dataKey="rate"
            name="Taxa de poupança"
            stroke={SERIES[2]}
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 0, fill: SERIES[2] }}
            activeDot={{ r: 5 }}
            connectNulls
          />
        </LineChart>
      </ChartCard>
    </div>
  );
}
