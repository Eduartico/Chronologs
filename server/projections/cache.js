// In-memory projection cache. The ledger is append-only, so projections stay
// valid until the next write; every write path calls invalidateProjections().
let cached = null;

export function getProjections() {
  if (!cached) {
    // Dynamic import avoids a static cycle: rebuild -> eventStore -> cache.
    cached = import('./rebuild.js').then((m) => m.buildProjections());
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

export function invalidateProjections() {
  cached = null;
}
