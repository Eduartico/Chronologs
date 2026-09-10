import Icon from '../Icon.jsx';
import { VIEW_ICONS } from '../../dashboard/catalogue.js';
import { useT } from '../../i18n/index.js';

/**
 * How the same numbers get drawn.
 *
 * Bars are good at comparing two series a period at a time; a line is better at
 * the shape of a year; a table is better than either when what you want is the
 * exact figure. Neither is right for everyone, and picking one for the reader is
 * a decision that costs nothing to hand over.
 *
 * This was two controls. A card carried a chart-type switch and, beside it, a
 * separate chart/table pair — two segmented controls, touching, answering the
 * same question. Rows are a way of looking at a chart, not a different mode, so
 * `table` is one more icon in this control rather than a control of its own.
 *
 * Icon-only: at this size the shapes are the labels.
 */
export default function ViewToggle({ value, onChange, options, label }) {
  const { t } = useT();
  return (
    <div className="seg-toggle" role="group" aria-label={label ? t('chart.viewOf', { title: label }) : t('chart.type')}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`seg-btn ${value === opt ? 'is-on' : ''}`.trim()}
          // A control that sits inside a draggable card header must not let a
          // click start a drag, and must not blur an edit that is open behind it.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => onChange(opt)}
          title={t(`view.${opt}`)}
          aria-label={t(`view.${opt}`)}
          aria-pressed={value === opt}
        >
          <Icon name={VIEW_ICONS[opt] ?? 'chartLine'} size={15} />
        </button>
      ))}
    </div>
  );
}
