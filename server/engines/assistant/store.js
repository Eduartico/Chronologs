/**
 * Conversations on disk.
 *
 * One JSON file per conversation under `state/chats/`, not events in the
 * ledger: the ledger is a record of money, and a question about it is not a
 * movement. Nothing here is ever replayed into a projection, so the files can be
 * deleted freely — which is also what the delete button does.
 *
 * A message is `{ role, content, at }`; an assistant message additionally
 * carries `steps` — the tool calls it made and what came back, kept so the
 * screen can show the evidence behind an answer after a reload, and so the
 * model sees its own earlier calls when the conversation continues.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { statePath } from '../../lib/paths.js';

const DIR = () => statePath('chats');
const fileOf = (id) => join(DIR(), `${id}.json`);
const SAFE_ID = /^[a-z0-9-]{8,64}$/;

function ensureDir() {
  if (!existsSync(DIR())) mkdirSync(DIR(), { recursive: true });
}

function read(id) {
  if (!SAFE_ID.test(id)) return null;
  const file = fileOf(id);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function write(chat) {
  ensureDir();
  writeFileSync(fileOf(chat.id), JSON.stringify(chat, null, 2), 'utf-8');
  return chat;
}

/** The first question, trimmed to one line — what the list shows. */
export function titleFrom(text) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

export function listChats() {
  ensureDir();
  return readdirSync(DIR())
    .filter((f) => f.endsWith('.json'))
    .map((f) => read(f.replace(/\.json$/, '')))
    .filter(Boolean)
    .map(({ id, title, createdAt, updatedAt, messages }) => ({
      id,
      title,
      createdAt,
      updatedAt,
      messages: messages.length,
    }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function getChat(id) {
  return read(id);
}

export function createChat() {
  const now = new Date().toISOString();
  return write({ id: randomUUID(), title: '', createdAt: now, updatedAt: now, messages: [] });
}

export function deleteChat(id) {
  if (!SAFE_ID.test(id)) return false;
  const file = fileOf(id);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

export function appendMessage(id, message) {
  const chat = read(id);
  if (!chat) return null;
  const now = new Date().toISOString();
  chat.messages.push({ at: now, ...message });
  chat.updatedAt = now;
  if (!chat.title && message.role === 'user') chat.title = titleFrom(message.content);
  return write(chat);
}

export function renameChat(id, title) {
  const chat = read(id);
  if (!chat) return null;
  chat.title = titleFrom(title);
  return write(chat);
}
