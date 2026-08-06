import { useRef, useState } from 'react';
import Popover from './Popover.jsx';

/**
 * A tooltip the site can style.
 *
 * The browser's own `title` cannot be styled at all: it arrives after a delay
 * nobody chose, in the operating system's font, on a yellow-ish box that belongs
 * to no design. With buttons that are nothing *but* icons, the label is the only
 * thing standing between the reader and a guess — it deserves to look like it
 * belongs here.
 *
 * Reuses the popover's measuring and flipping, so a tooltip on the last row of a
 * table opens upwards like everything else.
 */
const DELAY_MS = 400;

export default function Tooltip({ label, children, align = 'start', disabled }) {
  const anchor = useRef(null);
  const timer = useRef(null);
  const [open, setOpen] = useState(false);

  if (!label || disabled) return children;

  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), DELAY_MS);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <>
      <span
        ref={anchor}
        className="tooltip-anchor"
        onMouseEnter={show}
        onMouseLeave={hide}
        // Keyboard users get it immediately: they have already committed to the
        // control by focusing it.
        onFocus={() => setOpen(true)}
        onBlur={hide}
      >
        {children}
      </span>
      <Popover anchorRef={anchor} open={open} onClose={hide} align={align} className="tooltip">
        {label}
      </Popover>
    </>
  );
}
