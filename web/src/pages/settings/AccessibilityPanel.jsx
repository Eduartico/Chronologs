import Switch from '../../components/ui/Switch.jsx';
import Value from '../../components/ui/Value.jsx';
import { useAppearance } from '../../state/SettingsProvider.jsx';
import { useChartTheme } from '../../components/charts/ChartThemeProvider.jsx';
import { useT } from '../../i18n/index.js';

/**
 * The three accessibility switches.
 *
 * Each one carries a live sample rather than only a sentence. A toggle whose
 * effect you cannot see is a toggle nobody trusts — you flip it, nothing visibly
 * happens on the settings page, and you flip it back. The samples are the real
 * components reading the real tokens, so what you see here is exactly what the
 * rest of the app will do.
 */

/** Three bars, drawn from the live series colours and the live pattern defs, so
    the texture switch shows its own result. */
function TextureSample() {
  const theme = useChartTheme();
  return (
    <svg width="120" height="46" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={i * 42}
          y={46 - (i + 2) * 11}
          width="34"
          height={(i + 2) * 11}
          fill={theme.textures ? `url(#cx-tex-${i})` : theme.series[i]}
          stroke={theme.series[i]}
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}

export default function AccessibilityPanel() {
  const { t } = useT();
  const { finance, textures, tables, set } = useAppearance();

  return (
    <div className="card">
      <h3>{t('settings.a11y.title')}</h3>

      <div className="a11y-option">
        <Switch
          checked={finance === 'cvd'}
          onChange={(on) => set({ finance: on ? 'cvd' : 'standard' })}
          label={t('settings.a11y.finance')}
        />
        <p className="hint">{t('settings.a11y.financeHelp')}</p>
        <div className="a11y-sample">
          <span>
            {t('settings.a11y.sampleGain')}: <Value amount={1240.5} symbol="sign" />
          </span>
          <span>
            {t('settings.a11y.sampleLoss')}: <Value amount={-318.2} symbol="arrow" format="percent" />
          </span>
        </div>
      </div>

      <div className="a11y-option">
        <Switch checked={!!textures} onChange={(on) => set({ textures: on })} label={t('settings.a11y.textures')} />
        <p className="hint">{t('settings.a11y.texturesHelp')}</p>
        <div className="a11y-sample">
          <TextureSample />
        </div>
      </div>

      <div className="a11y-option">
        <Switch checked={!!tables} onChange={(on) => set({ tables: on })} label={t('settings.a11y.tables')} />
        <p className="hint">{t('settings.a11y.tablesHelp')}</p>
      </div>
    </div>
  );
}
