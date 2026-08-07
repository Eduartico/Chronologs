import { THEMES } from '../../styles/themes.js';
import { useAppearance } from '../../state/SettingsProvider.jsx';
import { LOCALES } from '../../lib/locale.js';
import { useT } from '../../i18n/index.js';

/**
 * Theme and language.
 *
 * Each swatch renders the theme it names, from that theme's own four anchors —
 * not from a screenshot and not from a hand-picked preview colour. So a swatch
 * cannot lie about what clicking it does, and a theme added to `themes.js`
 * appears here with no work at all.
 *
 * The four squares are, in order, the page, the sidebar, the accent, and the ink
 * as an "Aa". That is the whole vocabulary a theme has; everything else in the
 * app is derived from those four by tokens.css.
 */
function ThemeSwatch({ theme, active, onPick }) {
  const { t } = useT();
  const { bg, panel, ink, accent } = theme.anchors;

  return (
    <button
      type="button"
      className={`theme-swatch${active ? ' is-on' : ''}`}
      aria-pressed={active}
      title={t('settings.appearance.preview', { name: theme.name })}
      onClick={() => onPick(theme.id)}
    >
      <span className="theme-swatch-art" style={{ background: bg, borderColor: accent }}>
        <span className="theme-swatch-panel" style={{ background: panel }} />
        <span className="theme-swatch-ink" style={{ color: ink }}>
          Aa
        </span>
        <span className="theme-swatch-accent" style={{ background: accent }} />
      </span>
      <span className="theme-swatch-name">{theme.name}</span>
    </button>
  );
}

export default function AppearancePanel() {
  const { t } = useT();
  const { theme, locale, set } = useAppearance();

  return (
    <>
      <div className="card">
        <h3>{t('settings.appearance.title')}</h3>
        <p className="hint">{t('settings.appearance.help')}</p>
        <p className="hint">{t('settings.appearance.current', { name: theme.name })}</p>
        <div className="theme-grid">
          {THEMES.map((entry) => (
            <ThemeSwatch
              key={entry.id}
              theme={entry}
              active={entry.id === theme.id}
              onPick={(id) => set({ theme: id })}
            />
          ))}
        </div>
      </div>

      <div className="card">
        <h3>{t('settings.language.title')}</h3>
        <p className="hint">{t('settings.language.help')}</p>
        <select value={locale} onChange={(e) => set({ locale: e.target.value })}>
          {Object.keys(LOCALES).map((code) => (
            <option key={code} value={code}>
              {t(`settings.language.${code}`)}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
