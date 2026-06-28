// Custom Recharts `label` for an annotation's vertical ReferenceLine.
//
// The bare <ReferenceLine> line carries no details, and a native SVG <title>
// tooltip proved unreliable (showed only a help-cursor, no text). So instead:
// a small coloured DOT at the top of the line as a compact marker, and on hover
// — over the dot OR anywhere along the line — a real HTML tooltip (rendered via
// a portal to <body>, so it can't be clipped by the chart SVG) with the title,
// date and note.
//
// Used as `label={<AnnotationMarker ann={a} />}` — Recharts injects `viewBox`
// (`{ x, y, height }` of the reference line) into the cloned element.

import { useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { formatDate } from "../lib/format";
import type { Annotation } from "../store/useAnnotationsStore";

interface Props {
  ann: Annotation;
  /** Injected by Recharts. Vertical line: x = line x, y = plot top, height = plot height. */
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
}

const DEFAULT_COLOR = "#A78BFA";
const TOOLTIP_W = 264;

export function AnnotationMarker({ ann, viewBox }: Props) {
  const x = viewBox?.x ?? 0;
  const y = viewBox?.y ?? 0;
  const h = viewBox?.height ?? 0;
  const color = ann.color || DEFAULT_COLOR;

  // Cursor position (viewport coords) while hovering — null when not hovered.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const move = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
  const leave = () => setPos(null);

  return (
    <g>
      <g
        onMouseEnter={move}
        onMouseMove={move}
        onMouseLeave={leave}
        style={{ cursor: "pointer" }}
      >
        {/* Invisible full-height strip so hovering anywhere on the line works. */}
        <rect x={x - 5} y={y} width={10} height={h} fill="transparent" />
        {/* Compact visible dot at the top of the line. */}
        <circle
          cx={x}
          cy={y + 4}
          r={4}
          fill={color}
          style={{ stroke: "rgb(var(--c-panel))", strokeWidth: 1.5 }}
        />
        {/* Larger invisible hit-target around the dot for easy hover. */}
        <circle cx={x} cy={y + 4} r={9} fill="transparent" />
      </g>

      {pos &&
        createPortal(
          <div
            className="pointer-events-none rounded-lg border border-border bg-panel shadow-card px-3 py-2 text-xs"
            style={{
              position: "fixed",
              zIndex: 9999,
              width: "max-content",
              maxWidth: TOOLTIP_W,
              left: Math.min(pos.x + 14, window.innerWidth - TOOLTIP_W - 8),
              top: pos.y + 14,
            }}
          >
            <div className="font-semibold" style={{ color }}>
              {ann.title}
            </div>
            <div className="text-muted">{formatDate(ann.date, "medium")}</div>
            {ann.body && (
              <div className="mt-1 text-text whitespace-pre-wrap break-words">
                {ann.body}
              </div>
            )}
          </div>,
          document.body
        )}
    </g>
  );
}
