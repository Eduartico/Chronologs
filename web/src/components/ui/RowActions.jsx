import IconButton from './IconButton.jsx';
import { useT } from '../../i18n/index.js';

/**
 * The two buttons at the end of a row, and what they become.
 *
 * At rest: edit and delete. Press edit and the same two positions hold confirm
 * and cancel instead — nothing is added to the screen, the row's own fields
 * become writable.
 *
 * Press delete and the bin itself — same icon slot, same pixel — turns into a
 * tick. A second press there is the one that deletes. Deleting several rows in
 * a row is then one rhythm, click-click, click-click, in the same spot each
 * time, rather than a click on the right followed by a click on the left to
 * confirm. It disarms itself shortly after (see `useRowEditor`'s `DISARM_MS`)
 * so a control left loaded is not a trap for the next click that lands nearby.
 *
 * The cluster keeps a fixed width so none of these swaps shift the column.
 *
 * For things that are expensive to lose — a trip, a category, anything that
 * drags transactions with it — pass `deleteMode="modal"` and handle
 * `onAskDelete` by opening a `ConfirmDialog`; arming a button is the right
 * weight for a tag, not for a year of travel.
 */
export default function RowActions({
  editing,
  deleting,
  canEdit = true,
  canDelete = true,
  busy,
  deleteMode = 'inline',
  editLabel,
  deleteLabel,
  confirmDeleteLabel = 'Confirmar — apaga',
  editBlockedReason = 'Não é possível editar isto',
  deleteBlockedReason = 'Não é possível apagar isto',
  onEdit,
  onSave,
  onCancel,
  onAskDelete,
  onConfirmDelete,
  extras,
}) {
  const { t } = useT();
  if (editing) {
    // Keyed so React remounts the cluster instead of diffing pencil→check,
    // trash→close prop-by-prop — a remount is what makes the CSS entrance
    // animation (`.row-actions .icon-btn`, see index.css) play on every swap.
    return (
      <div className="row-actions" key="edit">
        {extras}
        <IconButton icon="check" label={t('common.save')} tone="good" disabled={busy} onClick={onSave} />
        <IconButton icon="close" label={t('common.cancel')} disabled={busy} onClick={onCancel} />
      </div>
    );
  }

  if (deleting && deleteMode === 'inline') {
    return (
      <div className="row-actions" key="armed">
        {extras}
        {/* The pencil stays — arming is not a different mode, just a second
            press away from either outcome. Hiding it would leave whoever
            armed by mistake with no way back except waiting it out. */}
        <IconButton icon="pencil" label={editLabel ?? t('common.edit')} disabled />
        <IconButton
          icon="check"
          label={confirmDeleteLabel}
          tone="armed"
          disabled={busy}
          onClick={onConfirmDelete}
        />
      </div>
    );
  }

  return (
    <div className="row-actions" key="rest">
      {extras}
      {canEdit ? (
        <IconButton icon="pencil" label={editLabel ?? t('common.edit')} disabled={busy} onClick={onEdit} />
      ) : (
        <IconButton icon="pencil" label={editBlockedReason} disabled />
      )}
      {/*
        A blocked delete is still drawn, greyed, with the reason on hover.
        Omitting it left the column with a lone pencil floating where two
        buttons sit on every other row.
      */}
      {canDelete ? (
        <IconButton icon="trash" label={deleteLabel ?? t('common.delete')} tone="danger" disabled={busy} onClick={onAskDelete} />
      ) : (
        <IconButton icon="trash" label={deleteBlockedReason} disabled />
      )}
    </div>
  );
}
