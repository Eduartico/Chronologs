import Switch from '../../components/ui/Switch.jsx';
import Icon from '../../components/Icon.jsx';
import { useExperiments } from '../../state/SettingsProvider.jsx';
import { EXPERIMENTS, EXPERIMENT_IDS, allOn } from '../../experiments.js';
import { useT } from '../../i18n/index.js';

/**
 * The unfinished things, and whether they are switched on.
 *
 * Same shape as the accessibility panel — a switch, a sentence, and nothing
 * else — because these are the same kind of control and inventing a second
 * layout for them would only make the page harder to read.
 *
 * What it does not do is hide anything behind a warning dialog. Every one of
 * these adds a chart to a page; none of them touch the ledger, and none can lose
 * data. The honest thing is to say they are unfinished and let them be tried.
 */
export default function ExperimentsPanel() {
  const { t } = useT();
  const { flags, set } = useExperiments();

  const on = EXPERIMENT_IDS.filter((id) => flags[id]).length;
  const every = on === EXPERIMENT_IDS.length;

  return (
    <div className="card">
      <h3>{t('settings.experimental.title')}</h3>
      <p className="hint">{t('settings.experimental.help')}</p>

      <div className="a11y-option">
        <Switch
          checked={every}
          onChange={() => set(allOn(!every))}
          label={t('settings.experimental.all')}
        />
        <p className="hint">{t('settings.experimental.allHelp', { on, total: EXPERIMENT_IDS.length })}</p>
      </div>

      {EXPERIMENTS.map((experiment) => (
        <div className="a11y-option" key={experiment.id}>
          <Switch
            checked={!!flags[experiment.id]}
            onChange={(value) => set({ [experiment.id]: value })}
            label={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name={experiment.icon} size={15} />
                {t(`settings.experimental.${experiment.id}.label`)}
              </span>
            }
          />
          <p className="hint">{t(`settings.experimental.${experiment.id}.help`)}</p>
          <p className="hint">{t(`settings.experimental.surface.${experiment.surface}`)}</p>
        </div>
      ))}
    </div>
  );
}
