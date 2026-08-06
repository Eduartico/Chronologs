import { useRef, useState } from 'react';
import Icon from './Icon.jsx';
import Popover from './ui/Popover.jsx';
import IconButton from './ui/IconButton.jsx';
import { tint } from '../lib/color.js';

/**
 * Subcategories on a transaction — the chips, and the chooser.
 *
 * These were tags: coloured pills with no glyph, added through a bare `<select>`
 * that appeared inside the table cell. The select was as wide as the longest
 * name in it, so opening one stretched the column; picking a value shrank it
 * again, to a third width. The table never sat still.
 *
 * They are the other half of the category idea and are now built the same way —
 * icon, colour, floating picker, and the same wrapped grid of options the
 * category picker uses rather than a scrolling vertical list. The list read
 * as a native `<select>`'s dropdown and inherited its worst habit: the mouse
 * wheel and the scrollbar both used to close the panel instead of scrolling
 * it (a `Popover` bug, fixed at the source — see its own comment), which on a
 * list of any length meant there was no way to reach the option you wanted.
 */
export function SubcategoryChip({ subcategory, onRemove, size = 13 }) {
  if (!subcategory) return null;
  return (
    <span
      className="subcat-chip"
      style={{
        background: tint(subcategory.color),
        color: subcategory.color || 'var(--text-secondary)',
      }}
    >
      <Icon name={subcategory.icon || 'tag'} size={size} />
      <span>{subcategory.name}</span>
      {onRemove && (
        <button
          type="button"
          className="subcat-chip-x"
          onClick={onRemove}
          aria-label={`Tirar ${subcategory.name}`}
        >
          <Icon name="close" size={11} />
        </button>
      )}
    </span>
  );
}

export default function SubcategoryPicker({
  subcategories = [],
  selected = [],
  onAdd,
  onRemove,
  disabled,
}) {
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const chosen = selected.map((id) => subcategories.find((s) => s.id === id)).filter(Boolean);
  const available = subcategories.filter(
    (s) =>
      !selected.includes(s.id) &&
      (!query.trim() || s.name.toLowerCase().includes(query.trim().toLowerCase()))
  );

  function close() {
    setOpen(false);
    setQuery('');
  }

  return (
    <div className="subcat-cell">
      {chosen.map((s) => (
        <SubcategoryChip
          key={s.id}
          subcategory={s}
          onRemove={disabled ? undefined : () => onRemove(s.id)}
        />
      ))}
      <span ref={anchor} style={{ display: 'inline-flex' }}>
        <IconButton
          icon="plus"
          size={12}
          label="Juntar subcategoria"
          disabled={disabled}
          onClick={() => (open ? close() : setOpen(true))}
        />
      </span>
      <Popover anchorRef={anchor} open={open} onClose={close} width={300}>
        <div className="subcat-picker">
          <input
            autoFocus
            value={query}
            placeholder="Procurar…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && close()}
          />
          <div className="category-grid subcat-picker-grid">
            {available.map((s) => (
              <button
                key={s.id}
                type="button"
                className="category-option"
                onClick={() => {
                  onAdd(s.id);
                  close();
                }}
              >
                <Icon name={s.icon || 'tag'} size={15} style={{ color: s.color }} />
                <span>{s.name}</span>
              </button>
            ))}
            {available.length === 0 && (
              <span className="muted" style={{ fontSize: 12, padding: 6 }}>
                {subcategories.length === 0
                  ? 'Ainda não há subcategorias — cria-as em Categorias.'
                  : 'Nada com esse nome.'}
              </span>
            )}
          </div>
        </div>
      </Popover>
    </div>
  );
}
