import { existsSync, readFileSync, writeFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { statePath } from './paths.js';

function file() {
  return statePath('tags.json');
}

export function loadTags() {
  if (!existsSync(file())) return [];
  return JSON.parse(readFileSync(file(), 'utf-8'));
}

function save(tags) {
  writeFileSync(file(), JSON.stringify(tags, null, 2), 'utf-8');
}

export function createTag(name, color = null) {
  const tags = loadTags();
  if (tags.find((t) => t.name.toLowerCase() === name.toLowerCase())) return null;
  const tag = {
    id: uuidv4(),
    name,
    color: color || `hsl(${Math.floor(Math.random() * 360)}, 55%, 55%)`,
    created: new Date().toISOString(),
  };
  tags.push(tag);
  save(tags);
  return tag;
}

export function updateTag(id, patch) {
  const tags = loadTags();
  const tag = tags.find((t) => t.id === id);
  if (!tag) return null;
  Object.assign(tag, { name: patch.name ?? tag.name, color: patch.color ?? tag.color });
  save(tags);
  return tag;
}

export function deleteTag(id) {
  const tags = loadTags();
  const filtered = tags.filter((t) => t.id !== id);
  if (filtered.length === tags.length) return false;
  save(filtered);
  return true;
}
