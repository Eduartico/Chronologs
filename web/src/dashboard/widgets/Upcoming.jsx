import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import ChartCard from '../../components/charts/ChartCard.jsx';
import Value from '../../components/ui/Value.jsx';
import Popover from '../../components/ui/Popover.jsx';
import IconButton from '../../components/ui/IconButton.jsx';
import Icon from '../../components/Icon.jsx';
import { api, errText } from '../../lib/api.js';
import { eur } from '../../lib/money.js';
import { formatDate } from '../../lib/format.js';
import { weekdayNames, firstDayOfWeek } from '../../lib/locale.js';
import { useT } from '../../i18n/index.js';

/**
 * The bills that are coming, on a calendar.
 *
 * There is no feed of bills to read, so these are *inferred*: the same merchant
 * at a steady rhythm for a steady amount (see server/engines/recurring.js) —
 * the rent on the 2nd, the transport pass in the first days of the month, the
 * salary on the 1st. Each is placed on the day its rhythm says it lands next.
 *
 * Five weeks from the start of this one, because "what is coming out before
 * payday" is the question, and payday is at most a month away. A guess can be
 * wrong, so every entry opens to say why it is there, and one press takes it
 * off the calendar and out of the forecast for good — reversibly, from the eye
 * in the header.
 */
const WEEKS = 5;
const DAY = 86400000;

export default function Upcoming({ card }) {
  const { t } = useT();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(null); // { item, anchor }
  const [showIgnored, setShowIgnored] = useState(false);
  const ignoredAnchor = useRef(null);
  // The chip that was pressed. A ref rather than state: the popover measures it
  // after it opens, and it never needs a render of its own.
  const chipAnchor = useRef(null);

  const load = useCallback(() => {
    setFailed(false);
    return api
      .getRecurring({ days: WEEKS * 7 })
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A day cell is a seventh of a half-width card: too narrow for a merchant's
  // name, wide enough for its category's icon beside the amount. The name is in
  // the chip's label and in the detail it opens.
  const [categories, setCategories] = useState([]);
  useEffect(() => {
    api.getCategories().then(setCategories).catch(() => {});
  }, []);
  const categoryByName = useMemo(() => new Map(categories.map((c) => [c.name, c])), [categories]);

  const today = data?.today;

  /* Columns of seven from the locale's first weekday, starting with the week
     that holds today — the days already gone this week are drawn, quieter, so
     the grid reads as a calendar and not as a list that happens to wrap. */
  const weeks = useMemo(() => {
    if (!today) return [];
    const start = new Date(`${today}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() - firstDayOfWeek() + 7) % 7));
    return Array.from({ length: WEEKS }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => new Date(start.getTime() + (w * 7 + d) * DAY).toISOString().slice(0, 10)),
    );
  }, [today]);

  const byDate = useMemo(() => {
    const map = new Map();
    for (const item of data?.upcoming || []) {
      const list = map.get(item.date) || [];
      list.push(item);
      map.set(item.date, list);
    }
    return map;
  }, [data]);

  const seriesById = useMemo(() => new Map((data?.series || []).map((s) => [s.id, s])), [data]);

  const totals = useMemo(() => {
    let out = 0;
    let into = 0;
    for (const item of data?.upcoming || []) {
      if (item.amount < 0) out += -item.amount;
      else into += item.amount;
    }
    return { out, into };
  }, [data]);

  async function ignore(id, ignored) {
    try {
      await api.ignoreRecurring(id, ignored);
      setOpen(null);
      await load();
    } catch (err) {
      // The card has no toast of its own; the failure is rare enough to log.
      console.error(errText(err));
    }
  }

  const weekdays = weekdayNames('short');
  const rows = useMemo(
    () =>
      (data?.upcoming || []).map((item) => ({
        ...item,
        cadenceName: t(`recurring.cadence.${item.cadence}`),
      })),
    [data, t],
  );

  const ignored = data?.ignored || [];
  const controls = ignored.length ? (
    <span ref={ignoredAnchor} style={{ display: 'inline-flex' }}>
      <IconButton
        icon="eye"
        label={t('widget.upcoming.hidden', { count: ignored.length })}
        onClick={() => setShowIgnored((v) => !v)}
      />
    </span>
  ) : null;

  const selected = open ? seriesById.get(open.item.id) : null;

  return (
    <>
      <ChartCard
        {...card}
        title={t('widget.upcoming.name')}
        subtitle={t('widget.upcoming.desc')}
        controls={controls}
        loading={!data && !failed}
        empty={!data?.upcoming?.length}
        emptyMessage={failed ? t('dashboard.loadFailed') : t('widget.upcoming.empty')}
        footnote={
          data
            ? t('widget.upcoming.footnote', {
                out: eur(totals.out),
                in: eur(totals.into),
                count: data.series.length,
              })
            : undefined
        }
        table={{
          rows,
          columns: [
            { key: 'date', label: t('common.date'), format: formatDate },
            { key: 'name', label: t('common.description') },
            { key: 'cadenceName', label: t('widget.upcoming.cadence') },
            { key: 'category', label: t('common.category') },
            { key: 'amount', label: t('common.amount'), align: 'right', format: eur },
          ],
        }}
      >
        <BillsGrid
          weeks={weeks}
          weekdays={weekdays}
          today={today}
          byDate={byDate}
          categoryByName={categoryByName}
          t={t}
          onOpen={(item, anchor) => {
            chipAnchor.current = anchor;
            setOpen({ item });
          }}
        />
      </ChartCard>
      {/* Outside the card: ResponsiveContainer takes exactly one child, and both
          of these are portalled anyway. */}
      <Popover
        anchorRef={chipAnchor}
        open={!!open}
        onClose={() => setOpen(null)}
        width={260}
        className="widget-picker"
      >
        {open && (
          <div className="bill-detail">
            <strong>{open.item.name}</strong>
            <div className="muted">
              {t('widget.upcoming.detail', {
                cadence: t(`recurring.cadence.${open.item.cadence}`),
                date: formatDate(open.item.expected),
              })}
            </div>
            {selected && (
              <div className="muted">
                {t('widget.upcoming.seen', {
                  count: selected.count,
                  since: formatDate(selected.firstDate),
                  last: formatDate(selected.lastDate),
                })}
              </div>
            )}
            {open.item.variable && <div className="muted">{t('widget.upcoming.variable')}</div>}
            {open.item.overdue && <div className="muted">{t('widget.upcoming.overdue')}</div>}
            <div className="bill-detail-amount">
              <Value amount={open.item.amount} symbol={open.item.amount > 0 ? 'sign' : 'none'} />
            </div>
            <button type="button" className="btn-ghost btn-sm" onClick={() => ignore(open.item.id, true)}>
              {t('widget.upcoming.notABill')}
            </button>
          </div>
        )}
      </Popover>
      <Popover
        anchorRef={ignoredAnchor}
        open={showIgnored && ignored.length > 0}
        onClose={() => setShowIgnored(false)}
        width={280}
        className="widget-picker"
      >
        <div className="bill-detail">
          <strong>{t('widget.upcoming.hiddenTitle')}</strong>
          {ignored.map((s) => (
            <div key={s.id} className="bill-hidden-row">
              <span>{s.name}</span>
              <button type="button" className="btn-ghost btn-sm" onClick={() => ignore(s.id, false)}>
                {t('widget.upcoming.restore')}
              </button>
            </div>
          ))}
        </div>
      </Popover>
    </>
  );
}

/**
 * The grid itself. ResponsiveContainer hands it a width and height, which it
 * ignores: a day is a cell of a calendar, laid out by CSS, and the card scrolls
 * rather than squeezing five weeks into a quarter-width card.
 */
function BillsGrid({ weeks, weekdays, today, byDate, categoryByName, t, onOpen }) {
  return (
    <div className="bills-grid" role="grid" aria-label={t('widget.upcoming.name')}>
      {weekdays.map((name, i) => (
        <div key={`h-${i}`} className="bills-head" role="columnheader">
          {name}
        </div>
      ))}
      {weeks.flat().map((iso) => {
        const items = byDate.get(iso) || [];
        const past = iso < today;
        return (
          <div
            key={iso}
            role="gridcell"
            className={`bills-day${past ? ' is-past' : ''}${iso === today ? ' is-today' : ''}`}
            aria-label={formatDate(iso)}
          >
            <span className="bills-date">{Number(iso.slice(8, 10))}</span>
            {items.slice(0, 2).map((item) => (
              <button
                key={`${item.id}-${item.expected}`}
                type="button"
                className={`bills-chip${item.amount > 0 ? ' is-in' : ''}${item.overdue ? ' is-overdue' : ''}`}
                title={`${item.name} · ${eur(Math.abs(item.amount))}`}
                aria-label={`${item.name} · ${eur(Math.abs(item.amount))}`}
                onClick={(e) => onOpen(item, e.currentTarget)}
              >
                <span
                  className="bills-chip-icon"
                  style={{ color: categoryByName.get(item.category)?.color || undefined }}
                  aria-hidden="true"
                >
                  <Icon name={categoryByName.get(item.category)?.icon || 'tag'} size={11} />
                </span>
                <Value amount={item.amount} symbol={item.amount > 0 ? 'sign' : 'none'} />
              </button>
            ))}
            {items.length > 2 && (
              <span className="bills-more">{t('widget.upcoming.more', { count: items.length - 2 })}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
