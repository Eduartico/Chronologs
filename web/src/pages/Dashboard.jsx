import { useState, useEffect, useMemo, useCallback } from 'react';
import { usePersistentState } from '../lib/usePersistentState.js';
import { formatDate } from '../lib/format.js';
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
import ChartTypeToggle from '../components/charts/ChartTypeToggle.jsx';
import { useSeriesToggle } from '../components/charts/useSeriesToggle.jsx';
import { DateRangeField } from '../components/ui/DateField.jsx';
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
  // Persist the *choice*, derive the range from it.
  //
  // These used to be the other way round: the range was persisted and the preset
  // was not, so coming back to the tab showed all-time charts under a label that
  // read "Últimos 12 meses" — and re-picking that same label fired no change
  // event, leaving no way to put it right. Whatever the control's active state
  // is read from is what has to survive the trip to another tab.
  const [preset, setPreset] = usePersistentState('dashboard.preset', '12m');
  const [customRange, setCustomRange] = usePersistentState('dashboard.customRange', {
    from: '',
    to: '',
  });
  const range = useMemo(
    () => (preset === 'custom' ? customRange : rangeFor(preset)),
    [preset, customRange]
  );
  const [granularity, setGranularity] = usePersistentState('dashboard.granularity', 'month');
  const [categories, setCategories] = useState([]);
  const [selectedCats, setSelectedCats] = usePersistentState('dashboard.categories', []);
  const [error, setError] = useState(null);

  // How each card draws its numbers. Income against expense reads better as two
  // lines than as pairs of bars — the year has a shape, and bars chop it into
  // twelve separate comparisons — so that is what it opens as.
  const [cashflowType, setCashflowType] = usePersistentState('dashboard.cashflowType', 'line');
  const [cumulativeType, setCumulativeType] = usePersistentState('dashboard.cumulativeType', 'area');
  const [breakdownType, setBreakdownType] = usePersistentState('dashboard.breakdownType', 'pie');

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

  /** Switches to a hand-picked range, seeded from whatever is on screen now. */
  function setCustomBound(bound, value) {
    setCustomRange({ ...range, [bound]: value });
    setPreset('custom');
  }

  const cashflow = data?.monthlyCashflow || [];
  const trend = data?.categoryTrend || { categories: [], rows: [] };
  const trendColor = useMemo(() => colorScale(trend.categories), [trend.categories]);

  const savingsRate = data?.savingsRate || [];
  const clampedMonths = savingsRate.filter((r) => r.clamped).length;

  // The legend is the filter, on every chart that has one.
  const trendFilter = useSeriesToggle('dashboard.hiddenCats', trend.categories);
  const cashflowFilter = useSeriesToggle('dashboard.hiddenCashflow', ['Receitas', 'Despesas']);

  const breakdownAll = useMemo(
    () =>
      capSeries(
        (data?.categoryBreakdown || [])
          .filter((c) => c.expense > 0)
          .map((c) => ({ name: c.category, value: c.expense })),
        { max: 8 }
      ),
    [data]
  );
  const breakdownColor = useMemo(() => colorScale(breakdownAll.map((b) => b.name)), [breakdownAll]);
  // A pie has no per-series `hide` prop — the slice has to be gone from the
  // data itself, so the toggle filters here rather than in the chart markup.
  const breakdownFilter = useSeriesToggle(
    'dashboard.hiddenBreakdown',
    breakdownAll.map((b) => b.name)
  );
  const breakdown = useMemo(
    () => breakdownAll.filter((b) => !breakdownFilter.hidden.has(b.name)),
    [breakdownAll, breakdownFilter.hidden]
  );

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
              {data.range.earliest && ` · histórico desde ${formatDate(data.range.earliest)}`}
            </p>
          )}
        </div>
        <button className="btn-ghost" onClick={load}>↻ Actualizar</button>
      </div>

      {/* One control row above the charts drives every series on the page. */}
      <div className="filter-bar">
        <select value={preset} onChange={(e) => setPreset(e.target.value)}>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
          {/* Named, so a hand-picked range never leaves the control blank. */}
          <option value="custom">Intervalo à escolha</option>
        </select>
        <DateRangeField
          from={range.from}
          to={range.to}
          onChange={({ from, to }) => {
            if (from !== range.from) setCustomBound('from', from);
            else setCustomBound('to', to);
          }}
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
        <ChartCard
          title="Receitas e despesas"
          subtitle={`Por ${periodWord} — clica na legenda para isolar uma série`}
          loading={loading}
          empty={!cashflow.length}
          height={280}
          controls={<ChartTypeToggle value={cashflowType} onChange={setCashflowType} options={['line', 'bar']} />}
        >
          {cashflowType === 'line' ? (
            <LineChart data={cashflow} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...cartesianDefaults.grid} />
              <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
              <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} width={54} />
              <Tooltip content={<ChartTooltip formatLabel={axisMonth} formatValue={tooltipMoney} />} />
              <Legend {...cashflowFilter.legendProps} />
              <Line
                type="monotone"
                dataKey="income"
                name="Receitas"
                stroke={SERIES[2]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                hide={cashflowFilter.hidden.has('Receitas')}
              />
              <Line
                type="monotone"
                dataKey="expense"
                name="Despesas"
                stroke={SERIES[1]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                hide={cashflowFilter.hidden.has('Despesas')}
              />
            </LineChart>
          ) : (
            <BarChart data={cashflow} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...cartesianDefaults.grid} />
              <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
              <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} width={54} />
              <Tooltip
                content={<ChartTooltip formatLabel={axisMonth} formatValue={tooltipMoney} />}
                cursor={{ fill: 'rgba(139,148,158,0.08)' }}
              />
              <Legend {...cashflowFilter.legendProps} />
              <Bar
                dataKey="income"
                name="Receitas"
                fill={SERIES[2]}
                radius={[4, 4, 0, 0]}
                hide={cashflowFilter.hidden.has('Receitas')}
              />
              <Bar
                dataKey="expense"
                name="Despesas"
                fill={SERIES[1]}
                radius={[4, 4, 0, 0]}
                hide={cashflowFilter.hidden.has('Despesas')}
              />
            </BarChart>
          )}
        </ChartCard>

        <ChartCard
          title="Saldo acumulado"
          subtitle="Soma corrente do saldo de cada período"
          loading={loading}
          empty={!data?.cumulative?.length}
          height={280}
          controls={
            <ChartTypeToggle value={cumulativeType} onChange={setCumulativeType} options={['area', 'line']} />
          }
        >
          {cumulativeType === 'area' ? (
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
          ) : (
            <LineChart data={data?.cumulative || []} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...cartesianDefaults.grid} />
              <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
              <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} width={54} />
              <Tooltip content={<ChartTooltip formatLabel={axisMonth} formatValue={tooltipMoney} />} />
              <ReferenceLine y={0} stroke={INK.axis} />
              <Line
                type="monotone"
                dataKey="cumulative"
                name="Saldo acumulado"
                stroke={SERIES[0]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          )}
        </ChartCard>
      </div>

      <div style={{ marginBottom: 16 }}>
        <ChartCard
          title="Despesa por categoria ao longo do tempo"
          subtitle={
            trendFilter.hidden.size
              ? `${trendFilter.hidden.size} categoria(s) escondida(s) — clica na legenda para repor`
              : 'Área empilhada — clica numa categoria da legenda para a esconder, duplo clique para a isolar'
          }
          loading={loading}
          empty={!trend.rows.length}
          height={300}
        >
          <AreaChart data={trend.rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...cartesianDefaults.grid} />
            <XAxis dataKey="period" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
            <YAxis tickFormatter={axisMoney} {...cartesianDefaults.axis} width={54} />
            <Tooltip content={<ChartTooltip formatLabel={axisMonth} formatValue={tooltipMoney} total />} />
            {/* The legend is the filter. On a stack of eight bands it is the
                first thing anyone tries to click, and doing nothing was the
                surprise. */}
            <Legend {...trendFilter.legendProps} />
            {trend.categories.map((cat) => (
              <Area
                key={cat}
                type="monotone"
                dataKey={cat}
                name={cat}
                stackId="spend"
                hide={trendFilter.hidden.has(cat)}
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
        <ChartCard
          title="Repartição da despesa"
          subtitle={
            breakdownFilter.hidden.size
              ? `${breakdownFilter.hidden.size} categoria(s) escondida(s) — clica na legenda para repor`
              : 'Clica numa categoria da legenda para a esconder, duplo clique para a isolar'
          }
          loading={loading}
          empty={!breakdown.length}
          height={280}
          controls={<ChartTypeToggle value={breakdownType} onChange={setBreakdownType} options={['pie', 'bar']} />}
        >
          {breakdownType === 'pie' ? (
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
              <Legend
                payload={breakdownAll.map((b) => ({
                  value: b.name,
                  type: 'circle',
                  color: breakdownColor(b.name),
                }))}
                {...breakdownFilter.legendProps}
              />
            </PieChart>
          ) : (
            /* Shares are easier to rank as bars and easier to judge as a
               circle, so the reader picks. */
            <BarChart
              data={breakdown}
              layout="vertical"
              margin={{ top: 4, right: 12, left: 0, bottom: 0 }}
            >
              <CartesianGrid {...cartesianDefaults.grid} horizontal={false} vertical />
              <XAxis type="number" tickFormatter={axisMoney} {...cartesianDefaults.axis} />
              <YAxis type="category" dataKey="name" width={110} {...cartesianDefaults.axis} />
              <Tooltip
                content={<ChartTooltip formatValue={tooltipMoney} />}
                cursor={{ fill: 'rgba(139,148,158,0.08)' }}
              />
              <Bar dataKey="value" name="Despesa" radius={[0, 4, 4, 0]}>
                {breakdown.map((b) => (
                  <Cell key={b.name} fill={breakdownColor(b.name)} />
                ))}
              </Bar>
            </BarChart>
          )}
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
        subtitle={
          clampedMonths
            ? `Percentagem das receitas que sobrou · ${clampedMonths} mês(es) abaixo de −100% desenhados no limite`
            : 'Percentagem das receitas que sobrou em cada período'
        }
        loading={loading}
        empty={!savingsRate.some((r) => r.rate != null)}
        emptyMessage="Sem receitas registadas neste período — a taxa de poupança precisa delas."
        height={220}
      >
        <LineChart data={savingsRate} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...cartesianDefaults.grid} />
          <XAxis dataKey="month" tickFormatter={axisMonth} {...cartesianDefaults.axis} minTickGap={20} />
          {/* Fixed to ±100%. One student month at −733% used to squash every
              other month into a flat line at the top of the chart. */}
          <YAxis
            domain={[-100, 100]}
            ticks={[-100, -50, 0, 50, 100]}
            tickFormatter={(v) => `${v}%`}
            {...cartesianDefaults.axis}
            width={44}
          />
          <Tooltip
            content={
              <ChartTooltip
                formatLabel={axisMonth}
                // The line is clamped; the number never is.
                formatValue={(v, entry) =>
                  entry?.payload?.clamped ? `${entry.payload.trueRate}%` : `${v}%`
                }
              />
            }
          />
          <ReferenceLine y={0} stroke={INK.axis} />
          <Line
            type="monotone"
            dataKey="rate"
            name="Taxa de poupança"
            stroke={SERIES[2]}
            strokeWidth={2}
            // A hollow dot marks a month drawn at the limit rather than at its
            // real value, so a clipped point never reads as an ordinary one.
            dot={(props) =>
              props.payload?.clamped ? (
                <circle
                  key={props.payload.month}
                  cx={props.cx}
                  cy={props.cy}
                  r={4}
                  fill={STATUS.critical}
                  stroke={SERIES[2]}
                  strokeWidth={2}
                />
              ) : (
                <circle key={props.payload.month} cx={props.cx} cy={props.cy} r={3} fill={SERIES[2]} />
              )
            }
            activeDot={{ r: 5 }}
            connectNulls
          />
        </LineChart>
      </ChartCard>
    </div>
  );
}
