/**
 * What the interface knows about modules.
 *
 * Two halves, deliberately:
 *
 *  - The *description* comes from the server (`GET /api/modules`): which modules
 *    are installed, which instances are configured, and what each one can do.
 *    That is data, and it is why no page needs a table of provider names.
 *  - The *component*, when a module ships one, is found here by globbing
 *    `modules/<id>/ui.jsx` at build time. A card cannot arrive over HTTP — it is
 *    code — so it is bundled, and the description simply says which id it
 *    belongs to.
 *
 * A module with no `ui.jsx` is not lesser: `ModuleCard` renders it from its
 * `configSchema` and capability list, and it gets the themes, the translations
 * and the accessibility rules without its author knowing they exist.
 */

/**
 * Every module-supplied card, keyed by module id.
 *
 * `eager` because there are a handful of them and they are all on one screen;
 * lazy loading would buy a suspense boundary per card in exchange for nothing.
 * The path is relative and reaches outside `web/` on purpose — a module is one
 * folder holding both of its halves. `vite.config.js` allows the read.
 */
const CARDS = import.meta.glob('../../../modules/*/ui.jsx', { eager: true });

const byId = {};
for (const [path, module] of Object.entries(CARDS)) {
  const id = path.split('/').at(-2);
  if (module?.default) byId[id] = module.default;
}

/** The component a module ships for its own card, or null. */
export function cardFor(moduleId) {
  return byId[moduleId] ?? null;
}

/** Which modules brought a card of their own. Used by tests and diagnostics. */
export function modulesWithCards() {
  return Object.keys(byId).sort();
}

/**
 * The server's description of what is installed and configured.
 *
 * Returns a shape that is always safe to render — an unreachable server gives
 * empty lists and one problem, rather than throwing into a blank screen on the
 * one page whose whole job is to tell you what is connected.
 */
export async function fetchModules() {
  try {
    const response = await fetch('/api/modules');
    if (!response.ok) throw new Error(String(response.status));
    const body = await response.json();
    return {
      modules: body.modules ?? [],
      instances: body.instances ?? [],
      problems: body.problems ?? [],
    };
  } catch (err) {
    return { modules: [], instances: [], problems: [`modules: ${err.message}`] };
  }
}

/** The manifest an instance is an instance of. */
export function manifestFor(instance, modules) {
  return modules.find((m) => m.id === instance.module) ?? null;
}
