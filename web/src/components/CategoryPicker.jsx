import { useRef, useState } from 'react';
import Icon from './Icon.jsx';
import Popover from './ui/Popover.jsx';
import { tint } from '../lib/color.js';

/**
 * Category chooser used by the review queue and the transactions table.
 *
 * Two things it does that a plain <select> could not: it puts the categories the
 * user actually uses at the front (the server sorts by transaction count), and
 * it gives each one an icon, so after a week the target is recognised by shape
 * rather than read. With fifteen categories and a thousand decisions to make,
 * that is the difference between a click and a pause.
 *
 * The grid used to render inside the table cell, which made the row grow tall
 * enough to push every row below it down the page — and on the last visible row
 * it opened downwards into nothing. It floats now, through `Popover`: the cell
 * keeps its height, and the panel flips upwards when it has to.
 */
export function CategoryIcon({ category, size = 16 }) {
  if (!category) return null;
  return (
    <span
      className="icon-swatch"
      style={{
        background: tint(category.color),
        color: category.color || 'var(--text-secondary)',
        width: size + 10,
        height: size + 10,
      }}
    >
      <Icon name={category.icon || 'tag'} size={size} />
    </span>
  );
}

export default function CategoryPicker({
  categories,
  onPick,
  selected,
  disabled,
  compact = false,
  label = 'Escolher categoria',
  trigger,
}) {
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);

  if (!compact) {
    return <Grid categories={categories} selected={selected} onPick={onPick} disabled={disabled} />;
  }

  const selectedCategory = categories.find((c) => c.name === selected);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="picker-trigger"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {trigger ?? (
          <>
            {selectedCategory && <CategoryIcon category={selectedCategory} size={14} />}
            <span>{selected || label}</span>
          </>
        )}
      </button>
      <Popover anchorRef={anchor} open={open} onClose={() => setOpen(false)} width={340}>
        <div style={{ padding: 'var(--sp-3)' }}>
          <Grid
            categories={categories}
            selected={selected}
            onPick={(name) => {
              setOpen(false);
              onPick(name);
            }}
          />
        </div>
      </Popover>
    </>
  );
}

function Grid({ categories, selected, onPick, disabled }) {
  return (
    <div className="category-grid">
      {categories.map((c) => (
        <button
          key={c.id}
          type="button"
          disabled={disabled}
          className={`category-option${selected === c.name ? ' selected' : ''}`}
          onClick={() => onPick(c.name)}
          title={c.count != null ? `${c.count} transacções` : c.name}
        >
          <CategoryIcon category={c} />
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {c.name}
          </span>
          {c.count > 0 && <span className="count">{c.count}</span>}
        </button>
      ))}
    </div>
  );
}
