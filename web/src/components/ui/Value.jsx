import { money, pct as formatPct, nativeOf } from '../../lib/money.js';
import { nf } from '../../lib/locale.js';
import { useT } from '../../i18n/index.js';

/**
 * A financial value, rendered so its direction survives without colour.
 *
 * Red-and-green is the app's most important distinction and the one pair a large
 * share of colourblind readers cannot separate — and colour disappears entirely in
 * greyscale, in print, and under a screen reader. So every value carries three
 * independent encodings:
 *
 *   1. hue      — `--pnl-up` / `--pnl-down`, which the accessibility setting swaps
 *                 for blue and orange without touching --good/--bad, so an error
 *                 message stays red while the money changes
 *   2. symbol   — an explicit `+`/`−` or `▲`/`▼`, never optional
 *   3. weight   — up is semibold, down is regular; a structural difference that
 *                 reads at a glance even in a dense column
 *
 * plus a screen-reader word, because "▲ 1.4%" is announced as "1.4%" otherwise.
 *
 * `invert` matters here specifically. Chronologs shows spending as often as it
 * shows profit, and a large *expense* is not "bad" — colouring it red would say
 * something the data does not. Only genuine gains and losses (investments, budget
 * deltas) should be directional; everything else passes `symbol="none"` and gets
 * the neutral treatment.
 */
export default function Value({
  amount,
  from,
  format = 'money',
  symbol = 'sign',
  neutralAt = 0,
  invert = false,
  className = '',
  title,
  ...rest
}) {
  const { t } = useT();
  const n = Number(amount);

  if (!Number.isFinite(n)) {
    return <span className={`value value-empty ${className}`.trim()} {...rest}>—</span>;
  }

  const magnitude = Math.abs(n);
  const raw = magnitude <= Math.abs(neutralAt) ? 'flat' : n > 0 ? 'up' : 'down';
  const dir = raw === 'flat' || !invert ? raw : raw === 'up' ? 'down' : 'up';

  const glyph =
    symbol === 'none' || raw === 'flat' ? ''
    : symbol === 'arrow' ? (raw === 'up' ? '▲' : '▼')
    : raw === 'up' ? '+' : '−';

  // The unsigned magnitude — the glyph carries the sign, so the number must not
  // repeat it as a hyphen-minus, which reads as a dash next to a real minus sign.
  const text =
    format === 'percent' ? formatPct(magnitude).replace(/^\+/, '')
    // `nf()`, never a bare Intl formatter: a bare one follows the machine's
    // locale, so a plain count read Portuguese on one laptop and English on the
    // next while every money value on the same row followed the app.
    : format === 'plain' ? nf().format(magnitude)
    : money(magnitude, { from });

  return (
    <span
      className={`value ${className}`.trim()}
      data-dir={dir}
      title={title ?? (format === 'money' ? nativeOf(magnitude, from) : undefined)}
      {...rest}
    >
      {glyph && <span className="value-sym" aria-hidden="true">{glyph}</span>}
      <span className="value-num">{text}</span>
      {raw !== 'flat' && <span className="sr-only"> {t(`value.${dir}`)}</span>}
    </span>
  );
}
