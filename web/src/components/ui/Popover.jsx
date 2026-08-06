import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A panel that floats over everything, anchored to the thing that opened it.
 *
 * The category picker and the subcategory chooser used to render *inside* the
 * table cell. Opening one made the row three hundred pixels tall, shoved every
 * row below it down the page, and — on the last visible row — opened downwards
 * into nothing. Closing it snapped everything back to a slightly different size,
 * so the table was permanently twitching.
 *
 * Two things fix that, and both need this component. It renders through a portal
 * to `document.body`, so the cell's own height never changes and `.card`'s
 * `overflow: auto` cannot clip it. And it measures before it paints: if there is
 * not enough room below the trigger, it opens upwards instead.
 *
 * Positioning is fixed rather than absolute, which is what lets it survive
 * inside a scrolling container without doing arithmetic on scroll offsets. The
 * trade-off is that it must close when the page scrolls under it, which it does.
 */
const MARGIN = 6;
const VIEWPORT_PADDING = 8;

export default function Popover({
  anchorRef,
  open,
  onClose,
  children,
  align = 'start',
  width,
  className = '',
}) {
  const panel = useRef(null);
  const [style, setStyle] = useState(null);

  // Measured after the DOM is there but before the browser paints, so the panel
  // never appears in the wrong place and jumps.
  useLayoutEffect(() => {
    if (!open || !anchorRef?.current || !panel.current) return;

    const anchor = anchorRef.current.getBoundingClientRect();
    const box = panel.current.getBoundingClientRect();
    const room = {
      below: window.innerHeight - anchor.bottom - VIEWPORT_PADDING,
      above: anchor.top - VIEWPORT_PADDING,
    };

    // Flip up when the panel does not fit below and there is more room above.
    // This is the last-row case, and the reason the old picker pushed the page.
    const flip = box.height > room.below && room.above > room.below;
    const maxHeight = Math.max(160, flip ? room.above : room.below);

    let left = align === 'end' ? anchor.right - box.width : anchor.left;
    left = Math.min(Math.max(VIEWPORT_PADDING, left), window.innerWidth - box.width - VIEWPORT_PADDING);

    setStyle({
      position: 'fixed',
      left,
      top: flip ? undefined : anchor.bottom + MARGIN,
      bottom: flip ? window.innerHeight - anchor.top + MARGIN : undefined,
      maxHeight,
      width,
    });
  }, [open, anchorRef, align, width, children]);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (e) => {
      if (panel.current?.contains(e.target) || anchorRef?.current?.contains(e.target)) return;
      onClose?.();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    // Fixed positioning does not follow a scrolling ancestor, so rather than
    // recompute on every frame the panel steps aside when the page underneath
    // it moves. Scroll events do not bubble, but they do reach a capture-phase
    // listener on the window from any scrollable element on the page — which
    // used to include the popover's *own* scrolling list: scrolling the icon
    // grid or the subcategory list fired this same handler and closed the very
    // panel being scrolled. A scroll that originates inside the panel is left
    // alone; only the page moving under a still panel should close it.
    const onScroll = (e) => {
      if (panel.current?.contains(e.target)) return;
      onClose?.();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, onClose, anchorRef]);

  useEffect(() => {
    if (!open) setStyle(null);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panel}
      className={`popover ${className}`.trim()}
      role="dialog"
      // Hidden until measured, so the first paint is already in the right place.
      style={style || { position: 'fixed', left: -9999, top: -9999, width, visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body
  );
}
