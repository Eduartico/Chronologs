import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import Icon from '../Icon.jsx';
import Calendar from './Calendar.jsx';
import Popover from './Popover.jsx';
import {
  parseDateInput,
  displayDate,
  maskDateTyping,
  completionFor,
} from '../../lib/dateInput.js';

/**
 * A date you type.
 *
 * The value handed in and out stays ISO, because that is what the API speaks;
 * the box shows dd/mm/aaaa, because that is what a person in Portugal reads.
 *
 * The inference runs on every keystroke and is drawn as ghost text behind the
 * caret: type `25` against a start of 21/01/2025 and `/01/2025` appears, greyed,
 * before you have done anything else. It used to wait for the field to lose
 * focus, which hid the clever part exactly when it would have helped. What it
 * still refuses to do is rewrite the characters you are typing — the ghost is
 * only ever an extension of them, and leaving the field is what accepts it.
 *
 * `anchor` and `role` are what make it quick. See lib/dateInput.js for the rules.
 */
export default function DateField({
  value,
  onChange,
  anchor = '',
  role = 'end',
  placeholder = 'dd/mm/aaaa',
  title,
  disabled,
  autoFocus,
  className = '',
  style,
}) {
  const { t } = useT();
  const [text, setText] = useState(() => displayDate(value));
  const [open, setOpen] = useState(false);
  const [bad, setBad] = useState(false);
  const wrap = useRef(null);
  const trigger = useRef(null);
  // State rather than a ref: the ghost only shows while the field has focus, so
  // gaining and losing it has to repaint.
  const [focused, setFocused] = useState(false);

  // The field follows the value when it is changed from outside — a preset
  // range button, a reset, the other end of the pair moving.
  useEffect(() => {
    if (!focused) setText(displayDate(value));
  }, [value, focused]);

  // What the field would become if you stopped typing now. Only ever a tail:
  // see completionFor().
  const ghost = focused && !bad ? completionFor(text, { anchor, role }) : '';

  function resolve() {
    const iso = parseDateInput(text, { anchor, role });
    if (iso === null) {
      // Unreadable: keep what was typed so it can be corrected, and say so.
      setBad(true);
      return;
    }
    setBad(false);
    setText(displayDate(iso));
    if (iso !== (value || '')) onChange(iso);
  }

  return (
    <div className={`date-field ${bad ? 'is-bad' : ''} ${className}`.trim()} ref={wrap} style={style}>
      <input
        value={text}
        onChange={(e) => {
          setText(maskDateTyping(e.target.value));
          if (bad) setBad(false);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          resolve();
        }}
        onKeyDown={(e) => {
          // Tab accepts the ghost the same way leaving the field does, so the
          // shortest path through a date range never touches the mouse.
          if (e.key === 'Enter') {
            resolve();
            setOpen(false);
          }
          if (e.key === 'Escape') {
            setText(displayDate(value));
            setBad(false);
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        title={title}
        disabled={disabled}
        autoFocus={autoFocus}
        inputMode="numeric"
        spellCheck={false}
      />
      {ghost && (
        <span className="date-ghost" aria-hidden="true">
          {text}
          <span>{ghost}</span>
        </span>
      )}
      <button
        ref={trigger}
        type="button"
        className="icon-btn date-field-cal"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label={t('calendar.open')}
      >
        <Icon name="calendar" size={15} />
      </button>
      <Popover anchorRef={trigger} open={open} onClose={() => setOpen(false)} align="end" width={252}>
        <Calendar
          value={value}
          rangeFrom={role === 'end' ? anchor : value}
          rangeTo={role === 'end' ? value : anchor}
          onPick={(iso) => {
            setText(displayDate(iso));
            setBad(false);
            onChange(iso);
            setOpen(false);
          }}
        />
      </Popover>
    </div>
  );
}

/**
 * Two of the above, wired together: the start is the end's anchor, so the
 * second field only ever needs the part that differs.
 */
export function DateRangeField({ from, to, onChange, disabled, labels }) {
  return (
    <div className="date-range">
      <DateField
        value={from}
        anchor={to}
        role="start"
        onChange={(iso) => onChange({ from: iso, to })}
        disabled={disabled}
        title={labels?.from || 'De'}
        placeholder={labels?.from || 'dd/mm/aaaa'}
      />
      <span className="date-range-sep">→</span>
      <DateField
        value={to}
        anchor={from}
        role="end"
        onChange={(iso) => onChange({ from, to: iso })}
        disabled={disabled}
        title={labels?.to || 'Até'}
        placeholder={labels?.to || 'dd/mm/aaaa'}
      />
    </div>
  );
}
