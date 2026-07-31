import { existsSync, readFileSync, writeFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { statePath } from './paths.js';

const MAX_NOTIFICATIONS = 500;

function file() {
  return statePath('notifications.json');
}

export function listNotifications({ unread = false } = {}) {
  if (!existsSync(file())) return [];
  const all = JSON.parse(readFileSync(file(), 'utf-8'));
  return unread ? all.filter((n) => !n.read) : all;
}

function save(notifications) {
  writeFileSync(file(), JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS), null, 2), 'utf-8');
}

/**
 * type: 'info' | 'success' | 'warning' | 'error' | 'correlation'
 * data: free-form payload (counts, ids, link targets for the UI)
 */
export function notify(type, title, body = '', data = {}) {
  const notification = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    type,
    title,
    body,
    data,
    read: false,
  };
  save([notification, ...listNotifications()]);
  return notification;
}

export function markRead(id) {
  const all = listNotifications();
  const n = all.find((x) => x.id === id);
  if (!n) return false;
  n.read = true;
  save(all);
  return true;
}

export function markAllRead() {
  const all = listNotifications();
  for (const n of all) n.read = true;
  save(all);
  return all.length;
}
