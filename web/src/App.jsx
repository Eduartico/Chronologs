import { useState, useEffect } from 'react';
import NotificationBell from './components/NotificationBell.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Transactions from './pages/Transactions.jsx';
import PendingReview from './pages/PendingReview.jsx';
import Investments from './pages/Investments.jsx';
import Categories from './pages/Categories.jsx';
import Insights from './pages/Insights.jsx';
import Connections from './pages/Connections.jsx';
import Rules from './pages/Rules.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '◫' },
  { id: 'transactions', label: 'Transactions', icon: '☰' },
  { id: 'pending', label: 'Pending Review', icon: '⚠' },
  { id: 'investments', label: 'Investments', icon: '◆' },
  { id: 'categories', label: 'Categories', icon: '⊞' },
  { id: 'insights', label: 'Insights', icon: '✦' },
  { id: 'rules', label: 'Rules', icon: '⚙' },
  { id: 'connections', label: 'Connections', icon: '⇄' },
  { id: 'settings', label: 'Settings', icon: '⚒' },
];

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    fetch('/api/transactions?status=pending')
      .then((r) => r.json())
      .then((data) => setPendingCount(data.length))
      .catch(() => {});
  }, [page]);

  const renderPage = () => {
    switch (page) {
      case 'dashboard':
        return <Dashboard />;
      case 'transactions':
        return <Transactions />;
      case 'pending':
        return <PendingReview onCountChange={setPendingCount} />;
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
      <nav className="sidebar">
        <div className="sidebar-logo">
          <img src="/chronologs-icon.png" alt="Chronologs" />
          <h1>Chronologs</h1>
          <NotificationBell />
        </div>
        {NAV.map((item) => (
          <a
            key={item.id}
            href="#"
            className={`sidebar-link ${page === item.id ? 'active' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              setPage(item.id);
            }}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
            {item.id === 'pending' && pendingCount > 0 && (
              <span className="badge badge-pending" style={{ marginLeft: 'auto' }}>
                {pendingCount}
              </span>
            )}
          </a>
        ))}
      </nav>
      <main className="main-content">{renderPage()}</main>
    </div>
  );
}