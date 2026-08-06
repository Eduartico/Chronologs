import { useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * Whether the local model is actually usable right now — enabled in
 * Settings *and* a model chosen. Every AI button on the site asks this
 * instead of guessing from `enabled` alone, which used to leave a button
 * clickable with no model selected and an unhelpful error as the only
 * feedback.
 *
 * Fetched once per page load and shared between every caller through a
 * module-level cache rather than a request per button — a dozen AI-gated
 * controls on one screen used to mean a dozen identical `/llm/status` calls.
 */
let cached = null;
let inflight = null;
const listeners = new Set();

function fetchStatus() {
  if (!inflight) {
    inflight = api
      .getLlmStatus()
      .then((s) => {
        cached = { enabled: !!s?.enabled, model: s?.model || '', ready: !!s?.enabled && !!s?.model };
        listeners.forEach((fn) => fn(cached));
        return cached;
      })
      .catch(() => {
        cached = { enabled: false, model: '', ready: false };
        listeners.forEach((fn) => fn(cached));
        return cached;
      });
  }
  return inflight;
}

/** Call after Settings changes the LLM configuration, so every open tab picks it up. */
export function refreshLlmStatus() {
  inflight = null;
  cached = null;
  fetchStatus();
}

export function useLlmStatus() {
  const [status, setStatus] = useState(cached || { enabled: false, model: '', ready: false });

  useEffect(() => {
    listeners.add(setStatus);
    if (cached) setStatus(cached);
    else fetchStatus();
    return () => listeners.delete(setStatus);
  }, []);

  return status;
}
