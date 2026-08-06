import DateField from './DateField.jsx';

/**
 * A value that becomes writable where it already is.
 *
 * The old shape was: press "Editar", and an input appears somewhere else on the
 * row holding a copy of the name you were looking at. Two representations of
 * the same thing, in two places, one of them stale. Here the text and the input
 * occupy the same box.
 *
 * The box itself is not allowed to look like a box. Editing changes nothing
 * about the glyphs — no fill, no border, no ring — and the input is exactly as
 * wide as what is typed in it, via the CSS grid-mirror trick (`.autosize`):
 * an invisible copy of the value sizes the cell, the real input sits on top of
 * it. Without that, "Carol" in edit mode used to claim the same fixed width as
 * "Continente", stretching the field to 80% of the row and shoving the colour
 * swatch and every column after it toward the far edge. A row's only visible
 * sign of being live is its own background (`tr.is-editing`, in index.css) and
 * the buttons swapping to a tick and a cross.
 *
 * Losing focus commits the cancel — click anywhere that is not this field and
 * the edit ends. What makes that safe rather than a trap: the Save/Cancel
 * buttons, and any icon or colour picker meant to be used *while* a name is
 * being edited, block the mouse from taking focus in the first place (see
 * `IconButton`), so clicking them never fires this blur at all.
 *
 * Double-clicking the text also starts the edit, for anyone who never looks at
 * the buttons.
 */
export default function EditableField({
  editing,
  value,
  onChange,
  onStartEdit,
  onCommit,
  onCancel,
  as = 'text',
  options,
  placeholder,
  render,
  align,
  width,
  anchor,
  role,
  disabled,
  autoFocus,
  title,
}) {
  if (!editing) {
    return (
      <span
        className={`editable ${disabled ? 'is-locked' : ''}`.trim()}
        style={align === 'right' ? { textAlign: 'right', display: 'inline-block' } : undefined}
        onDoubleClick={disabled ? undefined : onStartEdit}
        title={title || (disabled ? undefined : 'Duplo-clique para editar')}
      >
        {render ? render(value) : value || <span className="muted">—</span>}
      </span>
    );
  }

  const commitKeys = (e) => {
    if (e.key === 'Enter') onCommit?.();
    if (e.key === 'Escape') onCancel?.();
  };

  if (as === 'date') {
    return (
      <DateField
        value={value || ''}
        anchor={anchor}
        role={role}
        onChange={onChange}
        autoFocus={autoFocus}
        className="editable is-editing"
      />
    );
  }

  if (as === 'select') {
    return (
      <select
        className="editable is-editing"
        value={value ?? ''}
        autoFocus={autoFocus}
        style={width ? { width } : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={commitKeys}
        onBlur={onCancel}
      >
        {(options || []).map((o) => (
          <option key={o.value ?? o} value={o.value ?? o}>
            {o.label ?? o}
          </option>
        ))}
      </select>
    );
  }

  const rightAligned = align === 'right' || as === 'money' || as === 'number';

  return (
    <span
      className="autosize"
      data-value={value || placeholder || ' '}
      style={width ? { minWidth: width } : undefined}
    >
      <input
        className="editable is-editing"
        type={as === 'number' || as === 'money' ? 'number' : 'text'}
        step={as === 'money' ? '0.01' : undefined}
        value={value ?? ''}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={rightAligned ? { textAlign: 'right' } : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={commitKeys}
        onBlur={onCancel}
      />
    </span>
  );
}
