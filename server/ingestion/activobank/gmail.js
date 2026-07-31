import { existsSync, readFileSync, writeFileSync } from 'fs';
import { google } from 'googleapis';
import { getOAuthClient, hasToken } from '../../lib/googleAuth.js';
import { statePath } from '../../lib/paths.js';

const QUERY = 'from:activobank.pt';

function syncFile() {
  return statePath('gmail-sync.json');
}

export function loadSyncState() {
  if (!existsSync(syncFile())) return { lastSyncAt: null, processedMessageIds: [] };
  return JSON.parse(readFileSync(syncFile(), 'utf-8'));
}

export function saveSyncState(state) {
  writeFileSync(syncFile(), JSON.stringify(state, null, 2), 'utf-8');
}

function header(message, name) {
  const h = (message.payload?.headers || []).find(
    (x) => x.name.toLowerCase() === name.toLowerCase()
  );
  return h ? h.value : '';
}

function decodeBase64Url(data) {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

const ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  aacute: 'á', agrave: 'à', atilde: 'ã', acirc: 'â',
  eacute: 'é', egrave: 'è', ecirc: 'ê',
  iacute: 'í', oacute: 'ó', otilde: 'õ', ocirc: 'ô',
  uacute: 'ú', ccedil: 'ç', ordm: 'º', ordf: 'ª', euro: '€',
};

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([A-Za-z]+);/g, (match, name) => {
      const lower = name.toLowerCase();
      if (ENTITIES[lower] == null) return match;
      const char = ENTITIES[lower];
      // Preserve the case the entity asked for (&Aacute; -> Á).
      return /^[A-Z]/.test(name) ? char.toUpperCase() : char;
    });
}

function stripHtml(html) {
  return decodeEntities(
    html
      // Style and script bodies are not text — dropping them keeps the stored
      // body readable and stops CSS from being mistaken for content.
      .replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Walk MIME parts collecting body text and attachment references.
function walkParts(part, out) {
  if (!part) return;
  if (part.filename && part.body?.attachmentId) {
    out.attachments.push({ filename: part.filename, attachmentId: part.body.attachmentId });
  } else if (part.mimeType === 'text/plain' && part.body?.data) {
    out.text += decodeBase64Url(part.body.data).toString('utf-8') + '\n';
  } else if (part.mimeType === 'text/html' && part.body?.data && !out.text) {
    out.html = stripHtml(decodeBase64Url(part.body.data).toString('utf-8'));
  }
  for (const child of part.parts || []) walkParts(child, out);
}

/**
 * Fetches every ActivoBank email not yet processed, with full body text and
 * downloaded attachments. Returns [{messageId, subject, date, body, attachments}].
 */
export async function fetchActivobankEmails() {
  if (!hasToken()) throw new Error('Google account not connected');
  const gmail = google.gmail({ version: 'v1', auth: getOAuthClient() });
  const processed = new Set(loadSyncState().processedMessageIds);

  const messageIds = [];
  let pageToken;
  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: QUERY,
      maxResults: 100,
      pageToken,
    });
    for (const m of res.data.messages || []) {
      if (!processed.has(m.id)) messageIds.push(m.id);
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  const emails = [];
  for (const id of messageIds) {
    const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    const message = res.data;
    const out = { text: '', html: '', attachments: [] };
    walkParts(message.payload, out);

    const attachments = [];
    for (const att of out.attachments) {
      const attRes = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: id,
        id: att.attachmentId,
      });
      attachments.push({
        filename: att.filename,
        buffer: decodeBase64Url(attRes.data.data),
      });
    }

    emails.push({
      messageId: id,
      subject: header(message, 'Subject'),
      date: new Date(parseInt(message.internalDate)).toISOString(),
      body: out.text || out.html,
      attachments,
    });
  }

  return emails;
}

export function markProcessed(messageIds) {
  const state = loadSyncState();
  state.processedMessageIds = [...new Set([...state.processedMessageIds, ...messageIds])];
  state.lastSyncAt = new Date().toISOString();
  saveSyncState(state);
}
