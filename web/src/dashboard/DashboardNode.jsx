import { useCallback, useEffect, useRef, useState } from 'react';

import Icon from '../components/Icon.jsx';
import IconButton from '../components/ui/IconButton.jsx';
import Popover from '../components/ui/Popover.jsx';
import { WIDGETS, SIZES, CHART_HEIGHT } from './catalogue.js';
import { useT } from '../i18n/index.js';

import Cashflow from './widgets/Cashflow.jsx';
import RunningBalance from './widgets/RunningBalance.jsx';
import CategoryTrend from './widgets/CategoryTrend.jsx';
import SpendingBreakdown from './widgets/SpendingBreakdown.jsx';
import TopMerchants from './widgets/TopMerchants.jsx';
import SavingsRate from './widgets/SavingsRate.jsx';
import MoneyFlow from './widgets/MoneyFlow.jsx';
import SpendingCalendar from './widgets/SpendingCalendar.jsx';
import Movers from './widgets/Movers.jsx';
import Committed from './widgets/Committed.jsx';
import Projection from './widgets/Projection.jsx';
import Trips from './widgets/Trips.jsx';
import NetWorth from './widgets/NetWorth.jsx';
import TripDetail from './widgets/TripDetail.jsx';
import Pace from './widgets/Pace.jsx';
import Investing from './widgets/Investing.jsx';
import Upcoming from './widgets/Upcoming.jsx';
import Forecast from './widgets/Forecast.jsx';
import Goals from './widgets/Goals.jsx';
import Freedom from './widgets/Freedom.jsx';

/** The one place a widget id becomes a component. The catalogue names what
    exists; this says what draws it. */
const COMPONENTS = {
  cashflow: Cashflow,
  balance: RunningBalance,
  trend: CategoryTrend,
  breakdown: SpendingBreakdown,
  merchants: TopMerchants,
  savings: SavingsRate,
  flow: MoneyFlow,
  calendar: SpendingCalendar,
  movers: Movers,
  committed: Committed,
  projection: Projection,
  trips: Trips,
  networth: NetWorth,
  trip: TripDetail,
  pace: Pace,
  investing: Investing,
  upcoming: Upcoming,
  forecast: Forecast,
  goals: Goals,
  freedom: Freedom,
};

/**
 * One card on the dashboard, and everything that can be done to it.
 *
 * A node is a row. It is at rest, or being edited, or armed for deletion, and
 * never two of those — the same three states every editable table in this app
 * has, so it uses the same gesture rather than inventing a fourth one.
 *
 * At rest the card carries its view switch and a pencil. Press the pencil and
 * nothing is added to the screen: the card tints, and the controls it already
 * had swap for the ones that change what the card *is* — which widget, how big,
 * where in the order, and a bin. Press the bin and it becomes a tick in the same
 * pixel; a second press there removes the card, and it disarms itself shortly
 * after so a loaded control is not a trap for the next click that lands nearby.
 *
 * The cluster is keyed by state so React remounts it rather than diffing
 * pencil→check prop by prop. A remount is what makes the CSS entrance animation
 * play on every swap; a diffed prop change does not retrigger an animation.
 *
 * Edit mode also gives up on its own. Nothing else on the site leaves a mode
 * switched on indefinitely waiting for a click that may never come, and a card
 * is no different: five seconds with no click on any of its edit controls and
 * it closes itself, the same `onDone` the explicit "Done" button already
 * calls. Purely click-driven — no mouse tracking, no click-outside handler —
 * because that is exactly what was asked for, and the widget picker's own
 * outside-click handling already exists and does not need duplicating.
 */
const DISARM_MS = 1000;
const EDIT_IDLE_MS = 5000;

export default function DashboardNode({
  node,
  index,
  count,
  editing,
  onEdit,
  onDone,
  onSetWidget,
  onSetView,
  onSetSize,
  onNudge,
  onRemove,
  dragProps,
  ...widgetProps
}) {
  const { t } = useT();
  const [armed, setArmed] = useState(false);
  const disarm = useRef(null);
  const pickerAnchor = useRef(null);
  const [picking, setPicking] = useState(false);
  const sizeAnchor = useRef(null);
  const [sizing, setSizing] = useState(false);
  const idleTimer = useRef(null);
  // `onDone` is a fresh closure every render (DashboardGrid defines it inline),
  // but the idle timer is only ever (re)started when `editing` flips — reading
  // through a ref rather than closing over the prop directly is what keeps the
  // timeout calling whichever `onDone` is actually current without having to
  // restart the countdown on every unrelated re-render.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const bump = useCallback(() => {
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => doneRef.current(), EDIT_IDLE_MS);
  }, []);

  useEffect(() => {
    if (editing) bump();
    return () => clearTimeout(idleTimer.current);
  }, [editing, bump]);

  const Widget = COMPONENTS[node.widget.id];
  if (!Widget) return null;

  const arm = () => {
    bump();
    clearTimeout(disarm.current);
    setArmed(true);
    disarm.current = setTimeout(() => setArmed(false), DISARM_MS);
  };

  const close = () => {
    clearTimeout(idleTimer.current);
    clearTimeout(disarm.current);
    setArmed(false);
    setPicking(false);
    setSizing(false);
    onDone();
  };

  const actions = editing ? (
    <div className="row-actions" key={armed ? 'armed' : 'edit'}>
      <span ref={pickerAnchor} style={{ display: 'inline-flex' }}>
        <IconButton
          icon={node.widget.icon}
          label={t('dashboard.edit.pickWidget')}
          disabled={armed}
          onClick={() => {
            bump();
            setPicking((v) => !v);
          }}
        />
      </span>
      {/* One button, not one per width. Six of them inline would put eleven
          controls in a header that has to survive being a quarter of a row wide,
          and the cluster would wrap onto a second line and shove the title
          sideways — the thing the header's own layout comment exists to stop.
          The current width is the button's glyph, so the control still says what
          it is set to without being asked. */}
      <span ref={sizeAnchor} style={{ display: 'inline-flex' }}>
        <IconButton
          icon={SIZES.find((s) => s.value === node.size)?.icon || 'sizeWide'}
          label={t('dashboard.edit.pickSize')}
          disabled={armed}
          onClick={() => {
            bump();
            setSizing((v) => !v);
          }}
        />
      </span>
      {/* The keyboard path for reordering. Dragging alone would put the whole
          feature out of reach of anyone not using a mouse. */}
      <IconButton
        icon="chevronLeft"
        label={t('dashboard.edit.moveBack')}
        disabled={armed || index === 0}
        onClick={() => {
          bump();
          onNudge(-1);
        }}
      />
      <IconButton
        icon="chevronRight"
        label={t('dashboard.edit.moveForward')}
        disabled={armed || index === count - 1}
        onClick={() => {
          bump();
          onNudge(1);
        }}
      />
      {armed ? (
        <IconButton
          icon="check"
          label={t('dashboard.edit.confirmRemove')}
          tone="armed"
          onClick={() => {
            clearTimeout(idleTimer.current);
            onRemove();
          }}
        />
      ) : (
        <IconButton icon="trash" label={t('dashboard.edit.remove')} tone="danger" onClick={arm} />
      )}
      <IconButton icon="close" label={t('common.done')} onClick={close} />
    </div>
  ) : (
    <div className="row-actions" key="rest">
      <IconButton icon="pencil" label={t('dashboard.edit.open')} onClick={onEdit} />
    </div>
  );

  const card = {
    view: node.view,
    // No view switch while the card is being arranged. The view switch is for
    // reading it and the edit cluster is for arranging it; showing both puts a
    // dozen buttons in one header, which on a half-width card wraps to a second
    // line and shoves the title sideways. Swapping the cluster rather than
    // adding to it is the same gesture every editable row here uses.
    views: editing ? [] : node.widget.views,
    onViewChange: onSetView,
    height: CHART_HEIGHT[node.size],
    // The span lives on the grid cell, not here: the cell is what the grid
    // places, and it is also what FLIP measures.
    className: `dash-node${editing ? ' is-editing' : ''}`,
    actions,
    headerProps: dragProps,
  };

  return (
    <>
      <Widget {...widgetProps} card={card} view={node.view} nodeId={node.id} />
      {/* A grid of tiles, not a vertical list: a list of eight full-width rows
          reads as a native <select> and inherits its worst trait, no room to
          show more than a handful. Portalled, so opening it never resizes the
          card it opened from — which on a grid would reflow every other card. */}
      <Popover
        anchorRef={pickerAnchor}
        open={picking && editing}
        onClose={() => setPicking(false)}
        width={260}
        className="widget-picker"
      >
        <div className="widget-picker-grid">
          {WIDGETS.map((widget) => (
            <button
              key={widget.id}
              type="button"
              className={`widget-tile${widget.id === node.widget.id ? ' is-on' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                bump();
                onSetWidget(widget.id);
                setPicking(false);
              }}
            >
              <Icon name={widget.icon} size={18} />
              <span>{t(`widget.${widget.id}.name`)}</span>
            </button>
          ))}
        </div>
      </Popover>

      {/* Rows, not tiles: a width is a single ordered choice from narrow to wide,
          and a list is the shape that reads as an order. */}
      <Popover
        anchorRef={sizeAnchor}
        open={sizing && editing}
        onClose={() => setSizing(false)}
        width={200}
        className="widget-picker"
      >
        <div className="size-picker">
          {SIZES.map((size) => (
            <button
              key={size.value}
              type="button"
              className={`size-option${size.value === node.size ? ' is-on' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                bump();
                onSetSize(size.value);
                setSizing(false);
              }}
            >
              <Icon name={size.icon} size={18} />
              <span>{t(`dashboard.size.${size.value}`)}</span>
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}
