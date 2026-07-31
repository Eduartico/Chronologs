import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api.js';

const TYPE_COLORS = {
  info: 'var(--accent)',
  success: 'var(--accent-green)',
  warning: 'var(--accent-yellow)',
  error: 'var(--accent-red)',
  correlation: 'var(--accent-purple)',
};

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const load = () => {
    api.getNotifications().then(setNotifications).catch(() => {});
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const unread = notifications.filter((n) => !n.read);

  const markRead = async (id) => {
    await api.markNotificationRead(id).catch(() => {});
    load();
  };

  const markAll = async () => {
    await api.markAllNotificationsRead().catch(() => {});
    load();
  };

  return (
    <div className="notification-bell" ref={ref}>
      <button
        className="bell-button"
        onClick={() => setOpen(!open)}
        title="Notifications"
      >
        <span>🔔</span>
        {unread.length > 0 && <span className="bell-badge">{unread.length}</span>}
      </button>
      {open && (
        <div className="bell-dropdown">
          <div className="bell-dropdown-header">
            <strong>Notifications</strong>
            {unread.length > 0 && (
              <button className="bell-mark-all" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 && (
            <div className="bell-empty">No notifications yet.</div>
          )}
          {notifications.slice(0, 30).map((n) => (
            <div
              key={n.id}
              className={`bell-item ${n.read ? 'read' : ''}`}
              onClick={() => !n.read && markRead(n.id)}
            >
              <span
                className="bell-item-dot"
                style={{ background: TYPE_COLORS[n.type] || 'var(--accent)' }}
              />
              <div className="bell-item-content">
                <div className="bell-item-title">{n.title}</div>
                {n.body && <div className="bell-item-body">{n.body}</div>}
                <div className="bell-item-time">
                  {new Date(n.timestamp).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
