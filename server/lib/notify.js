import { existsSync, readFileSync, writeFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { statePath } from './paths.js';
import { english } from './httpError.js';

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
 * Record something worth telling the user about.
 *
 *   type: 'info' | 'success' | 'warning' | 'error' | 'correlation'
 *   key:  a translation key stem, e.g. 'notify.quotes.fetched' — the client
 *         renders `${key}.title` and `${key}.body`
 *   params: the numbers and names those two strings interpolate
 *   data: free-form payload (ids, link targets) the UI acts on
 *
 * The reason this takes a key rather than a sentence: notifications are written
 * to disk and read weeks later. When the text was composed here, it was frozen in
 * whatever language the server happened to use that day — half of them English,
 * half Portuguese — and no later translation could reach them.
 *
 * `title` and `body` are still stored, rendered in English, as a fallback for
 * anything reading notifications.json directly and for exports. The client
 * prefers the key when it is present. Rows written before this change have no
 * key and keep displaying exactly the sentence they stored, which is the only
 * honest thing to do with them.
 */
export function notify(type, key, params = {}, data = {}) {
  const notification = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    type,
    key,
    params,
    title: english(`${key}.title`, params),
    body: english(`${key}.body`, params),
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
