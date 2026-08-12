/**
 * A connection's state, as a dot and a word.
 *
 * The word is not decoration. A dot alone says "something is green" to someone
 * who cannot tell green from grey, and connection state is exactly the kind of
 * thing that must not be colour-only — see the data-visualisation rules in
 * CLAUDE.md. `--good` and `--text-muted` rather than the finance colours, since
 * a live session is not a gain.
 */
export default function StatusDot({ ok, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: ok ? 'var(--good)' : 'var(--text-muted)',
        }}
      />
      {label}
    </span>
  );
}
