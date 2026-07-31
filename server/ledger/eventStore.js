import { existsSync, appendFileSync, createReadStream, mkdirSync } from 'fs';
import { dirname } from 'path';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { ledgerPath } from '../lib/paths.js';
import { invalidateProjections } from '../projections/cache.js';

function ensureDir() {
  const dir = dirname(ledgerPath());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function hashPayload(payload) {
  const sorted = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(sorted).digest('hex').slice(0, 16);
}

export function createEvent(type, source, payload, linkedEntities = []) {
  const timestamp = new Date().toISOString();
  const id = uuidv4();
  const hash = hashPayload(payload);
  return {
    id,
    timestamp,
    type,
    source,
    payload,
    hash,
    linked_entities: linkedEntities,
  };
}

export function appendEvent(event) {
  ensureDir();
  const line = JSON.stringify(event) + '\n';
  appendFileSync(ledgerPath(), line, 'utf-8');
  invalidateProjections();
  return event;
}

export function deduplicateByHash(newEvent) {
  if (!existsSync(ledgerPath())) return Promise.resolve(true);
  const stream = createReadStream(ledgerPath(), { encoding: 'utf-8' });
  return new Promise((resolve) => {
    let found = false;
    let leftover = '';
    stream.on('data', (chunk) => {
      const lines = (leftover + chunk).split('\n');
      leftover = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.hash === newEvent.hash && ev.type === newEvent.type) {
            found = true;
            break;
          }
        } catch {}
      }
    });
    stream.on('end', () => {
      resolve(!found);
    });
    stream.on('error', () => resolve(true));
  });
}

export async function appendIfNew(event) {
  const isNew = await deduplicateByHash(event);
  if (isNew) {
    appendEvent(event);
  }
  return isNew;
}

/**
 * Batch counterpart to appendIfNew. Scanning the whole ledger per event turns a
 * bulk import into an O(n²) crawl, so a batch loads the hash index once and
 * keeps it current as it appends.
 */
export async function loadLedgerIndex() {
  const events = await replayEvents();
  const hashes = new Set(events.map((e) => `${e.type}:${e.hash}`));
  return { events, hashes };
}

export function appendIfNewIndexed(event, index) {
  const key = `${event.type}:${event.hash}`;
  if (index.hashes.has(key)) return false;
  index.hashes.add(key);
  appendEvent(event);
  return true;
}

export function replayEvents() {
  return new Promise((resolve, reject) => {
    if (!existsSync(ledgerPath())) {
      resolve([]);
      return;
    }
    const events = [];
    const stream = createReadStream(ledgerPath(), { encoding: 'utf-8' });
    let leftover = '';
    stream.on('data', (chunk) => {
      const lines = (leftover + chunk).split('\n');
      leftover = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line));
        } catch {}
      }
    });
    stream.on('end', () => {
      if (leftover.trim()) {
        try {
          events.push(JSON.parse(leftover));
        } catch {}
      }
      resolve(events);
    });
    stream.on('error', reject);
  });
}

export function eventsFilePath() {
  return ledgerPath();
}
