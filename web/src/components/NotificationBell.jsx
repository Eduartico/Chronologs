import { useState, useEffect, useRef } from 'react';

import { api } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import Icon from './Icon.jsx';
import Popover from './ui/Popover.jsx';
import { useT } from '../i18n/index.js';

const TYPE_COLORS = {
  info: 'var(--accent)',
  success: 'var(--good)',
  warning: 'var(--warn)',
  error: 'var(--bad)',
  correlation: 'var(--info)',
};

/**
 * The notification list.
 *
 * The panel used to be `position: absolute; right: 0; width: 320px`, anchored to the
 * bell. The bell lives in the sidebar header, and the sidebar is 260px wide — so a
 * 320px panel pinned to its right edge started at roughly −84px, and about a
 * quarter of it was off the left of the screen. Collapsed, the rail is 68px and
 * almost the whole panel was gone.
 *
 * The fix is not a nudge to `right`, because there is no offset that is correct at
 * both sidebar widths and at every window size. It is `Popover`, the same primitive
 * the category and subcategory pickers use: it renders into a portal on `document.
 * body`, measures before paint, and clamps the left edge into the viewport. That
 * clamp is precisely what was missing here, and it already existed six files away.
 */
export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const { t } = useT();

  const load = () => {
    api.getNotifications().then(setNotifications).catch(() => {});
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
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

  /**
   * A notification's text.
   *
   * Rows written since the schema change carry `{key, params}` and are rendered in
   * whatever language is active now. Rows written before it carry the literal
   * sentence the server composed at the time, and there is no way to translate
   * those after the fact — so they keep displaying exactly what they stored.
   */
  const textOf = (n, part) => (n.key ? t(`${n.key}.${part}`, n.params || {}) : n[part]);

  return (
    <>
      <button
        ref={anchor}
        className="bell-button"
        onClick={() => setOpen((o) => !o)}
        title={t('bell.title')}
        aria-label={unread.length ? t('bell.unread', { count: unread.length }) : t('bell.open')}
        aria-expanded={open}
      >
        <Icon name="bell" size={19} />
        {unread.length > 0 && <span className="bell-badge">{unread.length}</span>}
      </button>

      <Popover anchorRef={anchor} open={open} onClose={() => setOpen(false)} align="start" width={320}>
        <div className="bell-dropdown">
          <div className="bell-dropdown-header">
            <strong>{t('bell.title')}</strong>
            {unread.length > 0 && (
              <button className="bell-mark-all" onClick={markAll}>
                {t('bell.markAllRead')}
              </button>
            )}
          </div>
          {notifications.length === 0 && <div className="bell-empty">{t('bell.empty')}</div>}
          {notifications.slice(0, 30).map((n) => (
            <div
              key={n.id}
              className={`bell-item ${n.read ? 'read' : ''}`}
              onClick={() => !n.read && markRead(n.id)}
            >
              <span className="bell-item-dot" style={{ background: TYPE_COLORS[n.type] || 'var(--accent)' }} />
              <div className="bell-item-content">
                <div className="bell-item-title">{textOf(n, 'title')}</div>
                {(n.key || n.body) && <div className="bell-item-body">{textOf(n, 'body')}</div>}
                <div className="bell-item-time">{formatDateTime(n.timestamp)}</div>
              </div>
            </div>
          ))}
        </div>
      </Popover>
    </>
  );
}
