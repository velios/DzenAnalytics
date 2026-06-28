import {
  cloneElement,
  isValidElement,
  useCallback,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface Props {
  /** Tooltip body. When falsy, the child renders with no tooltip at all. */
  content?: ReactNode;
  children: ReactElement;
  /** Preferred side; flips to stay on-screen. Default "top". */
  placement?: "top" | "bottom";
  /** Hover delay before showing, ms. Default 120. */
  delay?: number;
}

/**
 * App-themed tooltip that replaces the browser-native `title`. Wraps a single
 * element and renders a styled bubble in a portal on hover/focus — positioned
 * from the child's bounding box, so it adds NO wrapper box and never disturbs
 * the surrounding (often flex) layout. Pass a falsy `content` to disable it
 * conditionally without unwrapping (e.g. `content={editing ? null : text}`).
 */
export function Tooltip({ content, children, placement = "top", delay = 120 }: Props) {
  const [shown, setShown] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number; below: boolean }>({
    x: 0,
    y: 0,
    below: false,
  });
  // The anchor DOM node is kept in STATE (not a ref) — a callback ref into
  // setState avoids the `react-hooks/refs` rule that fires on ref-setters passed
  // through cloneElement, and re-running effects on remount is harmless here.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const place = useCallback(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    // Flip below when there isn't room above.
    const below = placement === "bottom" || r.top < 48;
    setCoords({
      x: Math.min(Math.max(r.left + r.width / 2, 8), window.innerWidth - 8),
      y: below ? r.bottom + 6 : r.top - 6,
      below,
    });
  }, [placement, anchor]);

  const open = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      place();
      setShown(true);
    }, delay);
  }, [delay, place]);

  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setShown(false);
  }, []);

  if (!content || !isValidElement(children)) return children;

  // Merge our handlers/ref onto the child without adding a layout wrapper.
  const childProps = children.props as Record<string, unknown>;
  const call = (name: string) => (e: unknown) => {
    (childProps[name] as ((ev: unknown) => void) | undefined)?.(e);
  };
  // Wrapped elements here don't carry their own ref, so the state setter doubles
  // as a callback ref. The rule below false-positives on `ref` in cloneElement —
  // the callback runs at commit, not during render.
  // eslint-disable-next-line react-hooks/refs
  const merged = cloneElement(children, {
    ref: setAnchor,
    "aria-describedby": shown ? id : undefined,
    onMouseEnter: (e: unknown) => {
      call("onMouseEnter")(e);
      open();
    },
    onMouseLeave: (e: unknown) => {
      call("onMouseLeave")(e);
      close();
    },
    onFocus: (e: unknown) => {
      call("onFocus")(e);
      place();
      setShown(true);
    },
    onBlur: (e: unknown) => {
      call("onBlur")(e);
      close();
    },
  } as Record<string, unknown>);

  return (
    <>
      {merged}
      {shown &&
        createPortal(
          <div
            role="tooltip"
            id={id}
            style={{
              position: "fixed",
              left: coords.x,
              top: coords.y,
              transform: `translate(-50%, ${coords.below ? "0" : "-100%"})`,
            }}
            className="pointer-events-none z-[100] max-w-xs rounded-md border border-border bg-panel2 px-2 py-1 text-xs text-text shadow-lg whitespace-pre-line"
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
