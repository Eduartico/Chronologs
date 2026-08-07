import { useChartTheme } from './ChartThemeProvider.jsx';
import { inkOn } from '../../lib/contrastInk.js';

/**
 * Hatch and dot fills, one per series colour.
 *
 * Colour alone fails in greyscale, in print, and for a reader who cannot separate
 * two of the hues. A texture is a second, independent channel: even at 40 % opacity
 * a 45° hatch is unmistakably not a 90° one.
 *
 * A pattern has to carry its series colour, so this is eight patterns rather than
 * eight reusable shapes — the colour is baked into each `<rect>`. They are emitted
 * once at the app root into a zero-size `<svg>`; `url(#id)` is a document-wide id
 * lookup in every current engine, so a chart in a different `<svg>` resolves them.
 * (That breaks under `<base href>` or shadow DOM, neither of which this app uses.)
 *
 * The hatch stroke is `inkOn(colour)` at low opacity, so it reads as shading rather
 * than as a second colour competing with the fill.
 */

/** Angles chosen so no two adjacent series share an orientation, and so none of
    them lands on the horizontal-plus-vertical pair that reads as a grid. */
const ANGLE = [45, 135, 0, 90, 22, 68, 112, 158];
const WIDTH = [1.2, 1.2, 2.2, 1, 1.6, 1, 1.4, 1.8];

/** The fill for series `i`: a pattern when textures are on, the flat colour when
    they are not. Marks keep their solid `stroke` either way — the true colour on
    the edge is what keeps a textured shape identifiable. */
export function seriesFill(theme, index, colour) {
  return theme.textures ? `url(#cx-tex-${index % ANGLE.length})` : colour;
}

export default function ChartPatterns() {
  const theme = useChartTheme();

  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute' }} focusable="false">
      <defs>
        {theme.series.map((colour, i) => (
          <pattern
            key={i}
            id={`cx-tex-${i}`}
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform={`rotate(${ANGLE[i % ANGLE.length]})`}
          >
            <rect width="6" height="6" fill={colour} />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke={inkOn(colour)}
              strokeOpacity="0.35"
              strokeWidth={WIDTH[i % WIDTH.length]}
            />
          </pattern>
        ))}
      </defs>
    </svg>
  );
}
