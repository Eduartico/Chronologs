import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePersistentState } from './lib/usePersistentState.js';
import NotificationBell from './components/NotificationBell.jsx';
import Icon from './components/Icon.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Transactions from './pages/Transactions.jsx';
import PendingReview from './pages/PendingReview.jsx';
import Duplicates from './pages/Duplicates.jsx';
import Investments from './pages/Investments.jsx';
import Accounts from './pages/Accounts.jsx';
import Travel from './pages/Travel.jsx';
import Categories from './pages/Categories.jsx';
import Insights from './pages/Insights.jsx';
import Connections from './pages/Connections.jsx';
import Rules from './pages/Rules.jsx';
import Settings from './pages/Settings.jsx';

// Ordered by how often each screen is actually opened, not by how the app was
// built: the daily work is at the top, the occasional setup at the bottom.
// Settings is not in this list — it is not a daily destination, and gets its
// own gear icon in the footer instead of a twelfth line in the same list as
// Dashboard and Transactions.
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'transactions', label: 'Transacções', icon: 'transactions' },
  { id: 'pending', label: 'Por rever', icon: 'pending' },
  { id: 'insights', label: 'Análises', icon: 'insights' },
  { id: 'accounts', label: 'Contas', icon: 'accounts' },
  { id: 'investments', label: 'Activos', icon: 'investments' },
  { id: 'travel', label: 'Viagens', icon: 'travel' },
  { id: 'categories', label: 'Categorias', icon: 'categories' },
  { id: 'rules', label: 'Regras', icon: 'rules' },
  { id: 'duplicates', label: 'Duplicados', icon: 'duplicates' },
  { id: 'connections', label: 'Ligações', icon: 'connections' },
];

const COLLAPSED_KEY = 'chronologs.sidebar.collapsed';

export default function App() {
  const [page, setPage] = usePersistentState('app.page', 'dashboard');
  const [pendingCount, setPendingCount] = useState(0);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === 'true'
  );

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  // Badge counts are refreshed on every navigation: reviewing or merging on one
  // page changes what the other pages have left to do.
  const loadBadges = useCallback(() => {
    fetch('/api/transactions?status=pending')
      .then((r) => r.json())
      .then((data) => setPendingCount(Array.isArray(data) ? data.length : 0))
      .catch(() => {});
    fetch('/api/duplicates')
      .then((r) => r.json())
      .then((data) => setDuplicateCount(data?.groups?.length || 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadBadges();
  }, [page, loadBadges]);

  const badgeFor = (id) =>
    id === 'pending' ? pendingCount : id === 'duplicates' ? duplicateCount : 0;

  // "Por rever" with nothing pending and "Duplicados" with nothing suspect are
  // not places to go — they were two more lines of navigation for a queue that
  // is empty, competing with the ten that always have something in them. The
  // tab drops off the menu once its count hits zero, and comes back the moment
  // it doesn't. Whoever is *already* on that page when it empties stays there —
  // the empty-state screen ("está tudo categorizado") is exactly what should
  // show, not a sudden jump to Dashboard while mid-review.
  const visibleNav = useMemo(
    () =>
      NAV.filter((item) => {
        if (item.id === page) return true;
        if (item.id === 'pending') return pendingCount > 0;
        if (item.id === 'duplicates') return duplicateCount > 0;
        return true;
      }),
    [page, pendingCount, duplicateCount]
  );

  const renderPage = () => {
    switch (page) {
      case 'dashboard':
        return <Dashboard />;
      case 'transactions':
        return <Transactions />;
      case 'pending':
        return <PendingReview onCountChange={setPendingCount} />;
      case 'duplicates':
        return <Duplicates onCountChange={setDuplicateCount} />;
      case 'travel':
        return <Travel />;
      case 'accounts':
        return <Accounts />;
      case 'investments':
        return <Investments />;
      case 'categories':
        return <Categories />;
      case 'insights':
        return <Insights />;
      case 'rules':
        return <Rules />;
      case 'connections':
        return <Connections />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="layout">
      <nav className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        {/*
          One row for identity and chrome, one divider, then navigation. This
          used to be two rows each with its own border-bottom — the logo row,
          then a second "utility" row for the bell and the collapse toggle —
          which read as two thin lines stacked for no reason, with the bell
          stranded at the far left of the second one and the toggle stranded at
          the far right with nothing between them. Both controls now sit beside
          the wordmark they belong to.
        */}
        <div className="sidebar-logo">
          <img src="/chronologs-logo.png" alt="Chronologs" />
          {!collapsed && <h1>Chronologs</h1>}
          <NotificationBell />
          <button
            className="sidebar-toggle"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expandir menu' : 'Colapsar menu'}
          >
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={16} />
          </button>
        </div>

        <div className="sidebar-nav">
          {visibleNav.map((item) => {
            const count = badgeFor(item.id);
            return (
              <a
                key={item.id}
                href="#"
                className={`sidebar-link ${page === item.id ? 'active' : ''}`}
                title={collapsed ? item.label : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  setPage(item.id);
                }}
              >
                <Icon name={item.icon} size={20} />
                {!collapsed && <span className="sidebar-label">{item.label}</span>}
                {count > 0 &&
                  (collapsed ? (
                    <span className="sidebar-dot" />
                  ) : (
                    <span className="badge badge-pending" style={{ marginLeft: 'auto' }}>
                      {count}
                    </span>
                  ))}
              </a>
            );
          })}
        </div>

        {/* Settings is configuration, not a destination visited alongside
            Dashboard and Transactions — it sits apart, at the foot of the
            rail, so the daily list above it stays a list of daily places. */}
        <div className="sidebar-footer">
          <a
            href="#"
            className={`sidebar-link ${page === 'settings' ? 'active' : ''}`}
            title="Definições"
            onClick={(e) => {
              e.preventDefault();
              setPage('settings');
            }}
          >
            <Icon name="settings" size={20} />
            {!collapsed && <span className="sidebar-label">Definições</span>}
          </a>
        </div>
      </nav>
      <main className="main-content">{renderPage()}</main>
    </div>
  );
}
