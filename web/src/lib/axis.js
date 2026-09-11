/**
 * A y-axis that fits the data it is drawn over.
 *
 * Recharts' automatic domain picks one step wide enough to cover both ends and
 * then anchors the ticks on zero, so a series running from −3K to 5.3K is given
 * an axis of −3K to 9K: nearly half the card is empty, every bar is drawn at two
 * thirds of the height it could be, and the month that actually stands out
 * doesn't. This picks the step first and then the smallest whole number of steps
 * that contains the data, which is the same "nice numbers" idea without the
 * rounding-up.
 *
 * Outliers are deliberately *not* clipped to a percentile. A bar cut short to
 * fit the frame is a bar that lies about its own value, and the reader has no
 * way to tell which ones were cut. The honest answer to one enormous month is a
 * tighter axis around the rest of them, which is what fitting the range gives.
 */
const NICE_STEPS = [1, 2, 2.5, 5, 10];

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  return (NICE_STEPS.find((s) => normalised <= s) ?? 10) * magnitude;
}

/**
 * @param values every number the axis has to contain — hidden series excluded by
 *   the caller, because an axis sized for a series nobody can see is the same
 *   empty space in a different disguise.
 * @returns `{ domain, ticks }`, or `undefined` when there is nothing to draw, so
 *   the call site can spread it and fall back to Recharts' own behaviour.
 */
export function fitDomain(values, { includeZero = true, target = 5, maxTicks = 8, pad = 0.04 } = {}) {
  const nums = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v));
  if (!nums.length) return undefined;

  let min = Math.min(...nums);
  let max = Math.max(...nums);
  // Money charts read against zero: a bar chart whose baseline floats is a bar
  // chart whose bars mean nothing. Rate charts pass includeZero anyway; the
  // option exists for the ones where the interesting band is far from it.
  if (includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (min === max) {
    const delta = Math.abs(min) || 1;
    min -= delta;
    max += delta;
  }
  // A hair of headroom, so the tallest bar is not welded to the top gridline.
  // Only on the ends that are real data: padding a baseline pinned at zero would
  // push the axis below it and reintroduce the empty band this exists to remove.
  const span = max - min;
  if (min !== 0) min -= span * pad;
  if (max !== 0) max += span * pad;

  let step = niceStep((max - min) / target);
  let lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  // Too many gridlines is its own kind of unreadable. Widen the step until the
  // count is sane; each widening is to the next nice number, never a fraction.
  while ((hi - lo) / step > maxTicks) {
    step = niceStep(step * 1.5);
    lo = Math.floor(min / step) * step;
    hi = Math.ceil(max / step) * step;
  }

  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { domain: [lo, hi], ticks };
}

/**
 * `fitDomain` as props to spread onto a Recharts axis. Spreads to nothing when
 * there is no data, which leaves the axis exactly as it was before.
 */
export function fitAxis(values, options) {
  const fit = fitDomain(values, options);
  return fit ? { domain: fit.domain, ticks: fit.ticks } : {};
}
