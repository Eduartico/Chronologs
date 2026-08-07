import { useEffect } from 'react';
import { useT } from '../../i18n/index.js';

/**
 * The confirmation that is worth interrupting for.
 *
 * Most deletions are handled by arming the row's own bin — no dialog, no
 * pointer journey. This is for the ones that take other things with them: a
 * category that sends its transactions back to uncategorized, a trip that
 * unmarks everything inside its window, a merge that cannot be undone. What
 * makes it useful is the `impact` line, which says how many rows are about to
 * change; a dialog that only says "tem a certeza?" adds a click and no
 * information.
 */
export default function ConfirmDialog({
  open,
  title,
  impact,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  busy,
  onConfirm,
  onCancel,
}) {
  const { t } = useT();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>{title}</h3>
        {impact && (
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', margin: '8px 0 16px' }}>
            {impact}
          </p>
        )}
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            className={tone === 'danger' ? 'btn-red' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {confirmLabel ?? t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
