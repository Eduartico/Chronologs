import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { statePath, snapshotsPath } from '../lib/paths.js';
import { invalidateProjections } from '../projections/cache.js';

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function readJSON(filepath, fallback) {
  if (!existsSync(filepath)) return fallback;
  return JSON.parse(readFileSync(filepath, 'utf-8'));
}

function writeJSON(filepath, data) {
  ensureDir(dirname(filepath));
  writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  invalidateProjections();
}

export function loadAssets() {
  return readJSON(statePath('assets.json'), []);
}

export function saveAssets(assets) {
  writeJSON(statePath('assets.json'), assets);
}

export function loadCategories() {
  return readJSON(statePath('categories.json'), []);
}

export function saveCategories(categories) {
  writeJSON(statePath('categories.json'), categories);
}

export function loadRules() {
  return readJSON(statePath('rules.json'), []);
}

export function saveRules(rules) {
  writeJSON(statePath('rules.json'), rules);
}

export function writeDailySnapshot(dateStr, data) {
  writeJSON(snapshotsPath(`${dateStr}.json`), data);
}

export function readDailySnapshot(dateStr) {
  return readJSON(snapshotsPath(`${dateStr}.json`), null);
}
