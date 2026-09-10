import { useRef, useState } from 'react';

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
 */
const DISARM_MS = 1000;

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

  const Widget = COMPONENTS[node.widget.id];
  if (!Widget) return null;

  const arm = () => {
    clearTimeout(disarm.current);
    setArmed(true);
    disarm.current = setTimeout(() => setArmed(false), DISARM_MS);
  };

  const close = () => {
    clearTimeout(disarm.current);
    setArmed(false);
    setPicking(false);
    onDone();
  };

  const actions = editing ? (
    <div className="row-actions" key={armed ? 'armed' : 'edit'}>
      <span ref={pickerAnchor} style={{ display: 'inline-flex' }}>
        <IconButton
          icon={node.widget.icon}
          label={t('dashboard.edit.pickWidget')}
          disabled={armed}
          onClick={() => setPicking((v) => !v)}
        />
      </span>
      {SIZES.map((size) => (
        <IconButton
          key={size.value}
          icon={size.icon}
          label={t(`dashboard.size.${size.value}`)}
          className={node.size === size.value ? 'is-on' : ''}
          disabled={armed}
          onClick={() => onSetSize(size.value)}
        />
      ))}
      {/* The keyboard path for reordering. Dragging alone would put the whole
          feature out of reach of anyone not using a mouse. */}
      <IconButton
        icon="chevronLeft"
        label={t('dashboard.edit.moveBack')}
        disabled={armed || index === 0}
        onClick={() => onNudge(-1)}
      />
      <IconButton
        icon="chevronRight"
        label={t('dashboard.edit.moveForward')}
        disabled={armed || index === count - 1}
        onClick={() => onNudge(1)}
      />
      {armed ? (
        <IconButton icon="check" label={t('dashboard.edit.confirmRemove')} tone="armed" onClick={onRemove} />
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
    </>
  );
}
