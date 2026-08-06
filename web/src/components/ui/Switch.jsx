/**
 * An on/off switch.
 *
 * Reserved for state — "cotações online ligadas", "regra activa". Selecting rows
 * is a different idea and keeps a box shape: a switch says *this thing is now
 * on*, and ticking three rows to categorize them together is not that.
 *
 * Built from a real `<input type="checkbox">` underneath, so it keeps the
 * keyboard behaviour, the focus ring and the label association that a pair of
 * styled divs would have to reimplement badly.
 */
export default function Switch({ checked, onChange, label, disabled, title }) {
  const control = (
    <span className="switch">
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
    </span>
  );

  if (!label) return control;

  return (
    <label className={`switch-label ${disabled ? 'is-disabled' : ''}`.trim()} title={title}>
      {control}
      <span>{label}</span>
    </label>
  );
}
