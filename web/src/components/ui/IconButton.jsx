import Icon from '../Icon.jsx';
import Tooltip from './Tooltip.jsx';

/**
 * A button that is only an icon.
 *
 * Rows used to carry "Editar", "Apagar", "Guardar", "Cancelar" spelled out in
 * full, which is four words of furniture on every line of a table whose point is
 * the numbers. The glyphs are the ones everybody already reads.
 *
 * The word is still there — it is the accessible name, and it appears on hover
 * through the site's own tooltip rather than the browser's unstylable one. Where
 * colour is used it goes on the glyph, never behind it; the single exception is
 * the armed delete, which has to be unmistakable.
 *
 * `onMouseDown` is blocked from taking focus, the same trick `Calendar.jsx`
 * uses for picking a day: a name field being edited two cells over must not
 * blur — and cancel itself — just because the pointer landed on Save, or on an
 * icon/colour swatch that is meant to work *alongside* the field still being
 * edited. Keyboard focus (Tab) is untouched; only the mouse is stopped from
 * stealing it.
 */
export default function IconButton({
  icon,
  label,
  tone = 'neutral',
  size = 16,
  disabled,
  onClick,
  className = '',
  tooltipAlign,
  ...rest
}) {
  return (
    <Tooltip label={label} align={tooltipAlign}>
      <button
        type="button"
        className={`icon-btn ${tone === 'neutral' ? '' : `icon-btn-${tone}`} ${className}`.trim()}
        aria-label={label}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        {...rest}
      >
        <Icon name={icon} size={size} />
      </button>
    </Tooltip>
  );
}
