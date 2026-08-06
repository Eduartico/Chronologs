import { useState } from 'react';
import Icon from '../Icon.jsx';
import { monthGrid, todayIso } from '../../lib/dateInput.js';

const WEEKDAYS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/**
 * The picker behind the calendar icon.
 *
 * Typing is the fast path; this is for the times you are looking for "the
 * Saturday after next" rather than a number you already know. It opens on the
 * month of whatever the field holds, and shades the other end of the range so
 * a trip's shape is visible while you pick.
 */
export default function Calendar({ value, rangeFrom, rangeTo, onPick }) {
  const start = value || todayIso();
  const [cursor, setCursor] = useState(() => {
    const [y, m] = start.split('-').map(Number);
    return { year: y, month: m };
  });

  const cells = monthGrid(cursor.year, cursor.month);
  const today = todayIso();

  function shift(by) {
    setCursor((c) => {
      const m = c.month + by;
      if (m > 12) return { year: c.year + 1, month: 1 };
      if (m < 1) return { year: c.year - 1, month: 12 };
      return { year: c.year, month: m };
    });
  }

  const lo = rangeFrom && rangeTo ? (rangeFrom < rangeTo ? rangeFrom : rangeTo) : null;
  const hi = rangeFrom && rangeTo ? (rangeFrom < rangeTo ? rangeTo : rangeFrom) : null;

  // Keeping the mouse from stealing focus is what lets the date field stay
  // focused while a day is picked, so its blur handler does not fight the pick.
  return (
    <div className="calendar-pop" onMouseDown={(e) => e.preventDefault()}>
      <div className="calendar-pop-head">
        <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="Mês anterior">
          <Icon name="chevronLeft" size={15} />
        </button>
        <strong>
          {MONTHS[cursor.month - 1]} {cursor.year}
        </strong>
        <button type="button" className="icon-btn" onClick={() => shift(1)} aria-label="Mês seguinte">
          <Icon name="chevronRight" size={15} />
        </button>
      </div>

      <div className="calendar-grid calendar-pop-grid">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="calendar-head">{d}</div>
        ))}
        {cells.map((cell, i) =>
          cell.iso ? (
            <button
              key={cell.iso}
              type="button"
              className={[
                'calendar-day',
                'pickable',
                cell.iso === value ? 'picked' : '',
                cell.iso === today ? 'today' : '',
                lo && hi && cell.iso > lo && cell.iso < hi ? 'in-travel' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onPick(cell.iso)}
            >
              <span>{cell.day}</span>
            </button>
          ) : (
            <div key={`b${i}`} className="calendar-day outside" />
          )
        )}
      </div>

      <div className="calendar-pop-foot">
        <button type="button" className="btn-ghost btn-sm" onClick={() => onPick(today)}>
          Hoje
        </button>
        {value && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => onPick('')}>
            Limpar
          </button>
        )}
      </div>
    </div>
  );
}
