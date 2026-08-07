import { useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import Popover from './Popover.jsx';
import { PALETTE } from './palette.js';

/** Re-exported so existing importers keep working; the list itself lives in
    palette.js, which Node can read for the contrast and validator tests. */
export { PALETTE };

export default function ColorPicker({ value, onPick, label, disabled }) {
  const { t } = useT();
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="color-trigger"
        disabled={disabled}
        aria-label={label ?? t('picker.changeColour')}
        title={label ?? t('picker.changeColour')}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ background: value || 'var(--surface-2)' }} />
      </button>
      <Popover anchorRef={anchor} open={open} onClose={() => setOpen(false)} width={188}>
        <div className="color-grid">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-swatch${value === c ? ' is-on' : ''}`}
              style={{ background: c }}
              title={c}
              onClick={() => {
                onPick(c);
                setOpen(false);
              }}
            />
          ))}
        </div>
      </Popover>
    </>
  );
}
