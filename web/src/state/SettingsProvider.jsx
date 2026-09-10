import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';

import { api } from '../lib/api.js';
import { configureMoney } from '../lib/money.js';
import { setLocale, currentLocale, localeTag, DEFAULT_LOCALE } from '../lib/locale.js';
import { inkOn } from '../lib/contrastInk.js';
import { themeById, DEFAULT_THEME } from '../styles/themes.js';

/**
 * One fetch of `/settings`, one owner of everything derived from it.
 *
 * Three pages used to call `api.getSettings()` independently, and `money.js` held a
 * module-level exchange rate that was only ever set by Investments — so what the
 * rest of the app formatted with depended on which page you had visited. Theme and
 * language have exactly the same shape of problem and would have inherited it.
 *
 * The DOM is the application target: five `data-*` attributes on <html> plus the
 * computed ink colours. CSS reads them, `ChartThemeProvider` observes them, and
 * nothing has to thread a theme object through props.
 */

/** The mirror the boot script in index.html reads before React exists. It holds
    only what the first paint needs, already resolved, so the script never has to
    know the theme registry. */
export const MIRROR_KEY = 'chronologs.appearance';

export const DEFAULT_APPEARANCE = {
  theme: DEFAULT_THEME,
  locale: DEFAULT_LOCALE,
  finance: 'standard',
  textures: false,
  tables: false,
};

const SettingsContext = createContext(null);

function readMirror() {
  try {
    return { ...DEFAULT_APPEARANCE, ...JSON.parse(globalThis.localStorage?.getItem(MIRROR_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

function writeMirror(appearance, theme) {
  try {
    globalThis.localStorage?.setItem(
      MIRROR_KEY,
      JSON.stringify({ ...appearance, mode: theme.mode, panel: theme.panel, ramp: theme.ramp, bg: theme.anchors.bg }),
    );
  } catch {
    /* private mode, quota, a locked-down browser — the fetch still works */
  }
}

/** Stamp the appearance onto <html>. Everything visual downstream reads from here. */
function applyToDom(appearance) {
  const theme = themeById(appearance.theme);
  const root = document.documentElement;

  root.dataset.theme = theme.id;
  root.dataset.mode = theme.mode;
  root.dataset.panel = theme.panel;
  root.dataset.ramp = theme.ramp;
  root.dataset.finance = appearance.finance === 'cvd' ? 'cvd' : 'standard';
  root.dataset.textures = appearance.textures ? 'on' : 'off';
  root.dataset.tables = appearance.tables ? 'on' : 'off';
  root.lang = localeTag(appearance.locale);

  // CSS cannot decide which ink is readable on a filled colour, so it is computed
  // once per theme and written as inline custom properties, which outrank the
  // stylesheet's first-frame fallbacks.
  const { accent } = theme.anchors;
  const style = getComputedStyle(root);
  root.style.setProperty('--on-accent', inkOn(accent));
  for (const name of ['good', 'warn', 'bad', 'info']) {
    const value = style.getPropertyValue(`--${name}`).trim();
    if (value) root.style.setProperty(`--on-${name}`, inkOn(value));
  }

  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.anchors.bg);
  return theme;
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  // Seeded from the mirror, so the first render is already the right theme and the
  // right language — there is no flash through Guardian-in-English on the way.
  const [appearance, setAppearance] = useState(readMirror);

  useLayoutEffect(() => {
    const theme = applyToDom(appearance);
    writeMirror(appearance, theme);
    setLocale(appearance.locale);
  }, [appearance]);

  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((loaded) => {
        if (cancelled) return;
        setSettings(loaded);
        configureMoney(loaded);
        if (loaded.appearance) setAppearance((a) => ({ ...a, ...loaded.appearance }));
      })
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Optimistic, like the rest of the Settings page: the UI moves first and the
   * write follows. A theme click that waited on a round trip would feel broken.
   */
  const save = useCallback(
    async (patch) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      if (patch.appearance) setAppearance((a) => ({ ...a, ...patch.appearance }));
      if (patch.currency) configureMoney(next);
      setSaving(true);
      try {
        const saved = await api.saveSettings(next);
        setSettings(saved ?? next);
        setError(null);
        return saved ?? next;
      } catch (e) {
        setError(e);
        throw e;
      } finally {
        setSaving(false);
      }
    },
    [settings],
  );

  const setAppearanceValue = useCallback((patch) => save({ appearance: { ...appearance, ...patch } }), [appearance, save]);

  const value = useMemo(
    () => ({
      settings,
      loading: settings === null && !error,
      error,
      saving,
      save,
      appearance,
      theme: themeById(appearance.theme),
      setAppearance: setAppearanceValue,
    }),
    [settings, error, saving, save, appearance, setAppearanceValue],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings() outside <SettingsProvider>');
  return ctx;
}

/** The appearance slice on its own, for components that only care about the theme
    or the accessibility flags and should not re-render on a schedule change. */
export function useAppearance() {
  const { appearance, theme, setAppearance, saving } = useSettings();
  return { ...appearance, theme, locale: appearance.locale ?? currentLocale(), set: setAppearance, saving };
}

/**
 * The dashboard layout slice.
 *
 * Deliberately a sibling of `appearance` rather than a part of it. Appearance is
 * mirrored to localStorage and stamped onto <html> because the first paint needs
 * it; a layout is only read once React is running, so it never has to be the
 * reason a theme flashes.
 *
 * `nodes` is `null` while settings are still in flight, which is different from
 * `[]` — an empty array is a dashboard someone emptied, and putting six cards
 * back would undo that. The grid uses the distinction to hold off drawing the
 * add button over a layout it has not seen yet.
 */
export function useDashboardSettings() {
  const { settings, save, saving } = useSettings();
  const nodes = settings?.dashboard?.nodes ?? null;
  const setNodes = useCallback((next) => save({ dashboard: { nodes: next } }), [save]);
  return { nodes, setNodes, saving };
}
