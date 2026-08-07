import { useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import Icon, { CATEGORY_ICON_NAMES } from '../Icon.jsx';
import Popover from './Popover.jsx';
import { PALETTE } from './ColorPicker.jsx';
import { tint } from '../../lib/color.js';

/**
 * Icon and colour, chosen from one button.
 *
 * These used to be two separate triggers — the icon swatch on one side of the
 * name, a bare colour dot on the other. With a short name like "Carol" that
 * put six characters between them and the eye had to travel; in edit mode,
 * where the field used to claim a fixed width regardless of what was typed,
 * the colour dot got flung all the way to the far edge of the row, past the
 * transaction counts. One button — already tinted the current colour — opens
 * one panel with both choices, and sits in exactly one place: immediately
 * before the name, in every state.
 */
export default function StylePicker({
  icon,
  color,
  onPickIcon,
  onPickColor,
  disabled,
  label = 'Ícone e cor',
  bare = false,
}) {
  const { t } = useT();
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const shown = query.trim()
    ? CATEGORY_ICON_NAMES.filter((n) => n.toLowerCase().includes(query.trim().toLowerCase()))
    : CATEGORY_ICON_NAMES;

  function close() {
    setOpen(false);
    setQuery('');
  }

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`icon-swatch icon-swatch-button${bare ? ' is-bare' : ''}`}
        disabled={disabled}
        aria-label={label}
        title={label}
        style={{
          background: bare ? 'transparent' : tint(color),
          color: color || 'var(--text-secondary)',
        }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name={icon || 'tag'} size={16} />
      </button>
      <Popover anchorRef={anchor} open={open} onClose={close} width={244}>
        <div className="icon-picker" style={{ padding: 'var(--sp-2)' }}>
          <input
            className="icon-picker-search"
            autoFocus
            value={query}
            placeholder={t('picker.searchIcon')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && close()}
          />
          <div className="icon-picker-grid">
            {shown.map((name) => (
              <button
                key={name}
                type="button"
                className="icon-picker-option"
                title={name}
                style={{ borderColor: icon === name ? 'var(--accent)' : 'transparent' }}
                onClick={() => onPickIcon(name)}
              >
                <Icon name={name} size={17} />
              </button>
            ))}
            {shown.length === 0 && (
              <span className="muted" style={{ fontSize: 12, padding: 4 }}>
                {t('picker.noIcon')}
              </span>
            )}
          </div>
          <div className="color-grid color-grid-attached">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-swatch${color === c ? ' is-on' : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => onPickColor(c)}
              />
            ))}
          </div>
        </div>
      </Popover>
    </>
  );
}
