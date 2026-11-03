import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = mkdtempSync(join(tmpdir(), 'chronologs-chats-'));
process.env.CHRONOLOGS_DATA_DIR = DIR;
mkdirSync(join(DIR, 'state'), { recursive: true });

const { listChats, getChat, createChat, deleteChat, appendMessage, renameChat, titleFrom } = await import('./store.js');

test.after(() => rmSync(DIR, { recursive: true, force: true }));

test('a conversation is a file, titled by its first question', () => {
  const chat = createChat();
  assert.ok(existsSync(join(DIR, 'state', 'chats', `${chat.id}.json`)));
  assert.equal(chat.title, '');
  appendMessage(chat.id, { role: 'user', content: '  Why was   March so expensive?  ' });
  appendMessage(chat.id, { role: 'assistant', content: 'Rent.', steps: [{ name: 'period_overview', arguments: {}, result: { spent: 1 } }] });
  const stored = getChat(chat.id);
  assert.equal(stored.title, 'Why was March so expensive?');
  assert.equal(stored.messages.length, 2);
  assert.equal(stored.messages[1].steps[0].name, 'period_overview');
  assert.ok(stored.messages[0].at);
});

test('the list is newest first and carries no message bodies', async () => {
  const a = createChat();
  const b = createChat();
  appendMessage(a.id, { role: 'user', content: 'older' });
  // Timestamps are to the millisecond; two writes in the same one would tie.
  await new Promise((r) => setTimeout(r, 5));
  appendMessage(b.id, { role: 'user', content: 'newer' });
  const list = listChats();
  assert.equal(list[0].id, b.id);
  assert.equal(list[0].messages, 1);
  assert.equal(list[0].content, undefined);
});

test('rename, delete, and an id that is not a file name', () => {
  const chat = createChat();
  assert.equal(renameChat(chat.id, 'Budget talk').title, 'Budget talk');
  assert.equal(deleteChat(chat.id), true);
  assert.equal(getChat(chat.id), null);
  assert.equal(deleteChat(chat.id), false);
  assert.equal(getChat('../../settings'), null);
  assert.equal(deleteChat('../settings'), false);
  assert.ok(!readdirSync(join(DIR, 'state', 'chats')).some((f) => f.includes('..')));
});

test('titles are one line and bounded', () => {
  assert.equal(titleFrom('a'.repeat(100)).length, 58);
  assert.equal(titleFrom('line one\nline two'), 'line one line two');
});
