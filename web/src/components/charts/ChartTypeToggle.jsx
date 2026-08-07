import Icon from '../Icon.jsx';
import { useT } from '../../i18n/index.js';

/**
 * How the same numbers get drawn.
 *
 * Bars are good at comparing two series a period at a time; a line is better at
 * the shape of a year. Neither is right for everyone, and picking one for the
 * reader is a decision that costs nothing to hand over — so the card carries a
 * small segmented control instead of an argument.
 *
 * Icon-only: at this size the shapes are the labels.
 */
const LABELS = {
  bar: 'Barras',
  line: 'Linhas',
  area: 'Área',
  pie: 'Sopa',
};

const ICONS = {
  bar: 'chartBar',
  line: 'chartLine',
  area: 'chartArea',
  pie: 'chartPie',
};

export default function ChartTypeToggle({ value, onChange, options = ['bar', 'line'] }) {
  const { t } = useT();
  return (
    <div className="seg-toggle" role="group" aria-label={t('chart.type')}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`seg-btn ${value === opt ? 'is-on' : ''}`.trim()}
          onClick={() => onChange(opt)}
          title={LABELS[opt]}
          aria-label={LABELS[opt]}
          aria-pressed={value === opt}
        >
          <Icon name={ICONS[opt]} size={15} />
        </button>
      ))}
    </div>
  );
}
