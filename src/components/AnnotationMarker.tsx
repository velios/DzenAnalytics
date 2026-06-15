// Custom Recharts `label` for an annotation's vertical ReferenceLine.
//
// The bare <ReferenceLine label="…"> only prints a tiny title at the top and
// has no hover affordance, so you can't see the annotation's date / note. This
// renders a coloured chip at the top of the line PLUS a full-height invisible
// hover strip; the whole group carries a native SVG <title>, so hovering
// anywhere along the line shows the title, date and body as a tooltip.
//
// Used as `label={<AnnotationMarker ann={a} />}` — Recharts injects `viewBox`
// (`{ x, y, width, height }` of the reference line) into the cloned element.

import { formatDate } from "../lib/format";
import type { Annotation } from "../store/useAnnotationsStore";

interface Props {
  ann: Annotation;
  /** Injected by Recharts. For a vertical line: x = line x, y = plot top,
   *  height = plot height (width is 0). */
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
}

const DEFAULT_COLOR = "#A78BFA";

export function AnnotationMarker({ ann, viewBox }: Props) {
  const x = viewBox?.x ?? 0;
  const y = viewBox?.y ?? 0;
  const h = viewBox?.height ?? 0;
  const color = ann.color || DEFAULT_COLOR;

  const tooltip =
    `${ann.title} · ${formatDate(ann.date, "medium")}` +
    (ann.body ? `\n${ann.body}` : "");

  const label = ann.title.length > 16 ? `${ann.title.slice(0, 15)}…` : ann.title;
  const chipW = label.length * 6.2 + 14;

  return (
    <g style={{ cursor: "help" }}>
      {/* Native tooltip for the whole marker (line strip + chip). */}
      <title>{tooltip}</title>
      {/* Invisible, easy-to-hit hover strip running the height of the plot. */}
      <rect x={x - 5} y={y} width={10} height={h} fill="transparent" />
      {/* Top chip with the (truncated) title. */}
      <rect
        x={x + 3}
        y={y + 2}
        width={chipW}
        height={15}
        rx={4}
        fill={color}
        fillOpacity={0.18}
        stroke={color}
        strokeOpacity={0.5}
      />
      <text x={x + 8} y={y + 13} fontSize={10} fontWeight={500} fill={color}>
        {label}
      </text>
    </g>
  );
}
