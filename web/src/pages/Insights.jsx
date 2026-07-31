import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';

function formatCurrency(val) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(val);
}

export default function Insights() {
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const data = await api.getInsights();
      setInsights(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="empty-state"><p>Loading...</p></div>;
  if (!insights) return <div className="empty-state"><h3>No insights yet</h3><p>More data is needed to generate insights.</p></div>;

  const { summary, topCategories, anomalies, recurring, breakdown, totalSpending } = insights;

  return (
    <div>
      <div className="page-header">
        <h2>Insights</h2>
        <button className="btn-ghost" onClick={loadData}>↻ Refresh</button>
      </div>

      {/* Summary cards */}
      {summary && summary.length > 0 && (
        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <h3 style={{ marginBottom: 16, fontSize: 14, color: 'var(--text-muted)' }}>
              Spending Summary
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {summary.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    padding: '10px 14px',
                    background: 'var(--bg-hover)',
                    borderRadius: 'var(--radius)',
                    fontSize: 13,
                    borderLeft: '3px solid var(--accent)',
                  }}
                >
                  {msg}
                </div>
              ))}
            </div>
          </div>

          {/* Top spending categories */}
          <div className="card">
            <h3 style={{ marginBottom: 16, fontSize: 14, color: 'var(--text-muted)' }}>
              Top Spending Categories
            </h3>
            {topCategories && topCategories.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {topCategories.map((cat, i) => (
                  <div
                    key={cat.category}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 0',
                      borderBottom: i < topCategories.length - 1 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <span style={{ fontSize: 13 }}>
                      <strong>{i + 1}.</strong> {cat.category}
                    </span>
                    <span className="amount-negative">{formatCurrency(cat.expense)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No spending data yet.</p>
            )}
          </div>
        </div>
      )}

      {/* Spending anomalies */}
      {anomalies && anomalies.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12, fontSize: 14, color: 'var(--accent-yellow)' }}>
            ⚠ Unusual Spending Detected
          </h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            Months where spending deviated significantly from the average
            ({formatCurrency(anomalies[0]?.mean || 0)}/mo)
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {anomalies.map((a) => (
              <div
                key={a.month}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'var(--bg-hover)',
                  borderRadius: 'var(--radius)',
                  fontSize: 13,
                }}
              >
                <span>
                  <strong>{a.month}</strong>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                    z-score: {a.zScore > 0 ? '+' : ''}{a.zScore.toFixed(1)}
                  </span>
                </span>
                <span className={a.expense > a.mean ? 'amount-negative' : 'amount-positive'}>
                  {formatCurrency(a.expense)}
                  {a.expense > a.mean ? ' ↑ above avg' : ' ↓ below avg'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recurring subscriptions */}
      {recurring && recurring.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12, fontSize: 14, color: 'var(--accent-purple)' }}>
            ⟳ Recurring Subscriptions Detected
          </h3>
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Merchant / Description</th>
                  <th>Occurrences</th>
                  <th>Avg Amount</th>
                  <th>Last Date</th>
                </tr>
              </thead>
              <tbody>
                {recurring.map((r) => (
                  <tr key={r.merchant}>
                    <td style={{ fontWeight: 500 }}>{r.merchant}</td>
                    <td>{r.count}</td>
                    <td className="amount-negative">{formatCurrency(r.avgAmount)}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {r.lastDate ? new Date(r.lastDate).toLocaleDateString('en-GB') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Category breakdown */}
      {breakdown && breakdown.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 12, fontSize: 14, color: 'var(--text-muted)' }}>
            Full Category Breakdown
          </h3>
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Expenses</th>
                  <th>Income</th>
                  <th>Count</th>
                  <th>% of Total</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((cat) => (
                  <tr key={cat.category}>
                    <td style={{ fontWeight: 500 }}>{cat.category}</td>
                    <td className="amount-negative">{formatCurrency(cat.expense)}</td>
                    <td className="amount-positive">{formatCurrency(cat.income)}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{cat.count}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div
                          style={{
                            flex: 1,
                            height: 4,
                            background: 'var(--bg-hover)',
                            borderRadius: 2,
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${totalSpending > 0 ? (cat.expense / totalSpending) * 100 : 0}%`,
                              background: 'var(--accent)',
                              borderRadius: 2,
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {totalSpending > 0 ? ((cat.expense / totalSpending) * 100).toFixed(1) : 0}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}