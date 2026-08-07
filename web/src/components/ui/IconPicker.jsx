import { useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import Icon, { CATEGORY_ICON_NAMES } from '../Icon.jsx';
import Popover from './Popover.jsx';
import { tint } from '../../lib/color.js';

/**
 * Icon chooser.
 *
 * The set is deliberately small and drawn in the same stroke weight as the rest
 * of the interface — emoji would carry their own colours and render differently
 * on every machine. It outgrew a single glance, so it scrolls and it filters:
 * names are English keys behind a Portuguese interface, and typing "avi" should
 * not have to know the icon is called `plane`.
 *
 * Lifted out of the categories page so subcategories get exactly the same one.
 */
export default function IconPicker({ value, onPick, color, disabled, label = 'Mudar ícone' }) {
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
        className="icon-swatch icon-swatch-button"
        disabled={disabled}
        aria-label={label}
        title={label}
        style={{
          background: tint(color),
          color: color || 'var(--text-secondary)',
        }}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name={value || 'tag'} size={16} />
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
                style={{ borderColor: value === name ? 'var(--accent)' : 'transparent' }}
                onClick={() => {
                  onPick(name);
                  close();
                }}
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
        </div>
      </Popover>
    </>
  );
}
