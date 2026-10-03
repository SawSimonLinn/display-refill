"use client";

import {
  containedRect,
  MIN_SLOT_SIZE,
  moveRect,
  nudgeRect,
  type Point,
  type Rect,
  rectFromPoints,
  type ResizeHandle,
  resizeRect,
  toNormalizedPoint,
} from "@display-refill/domain";
import { TriangleAlert } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useId, useRef, useState } from "react";

export interface CanvasRect {
  key: string;
  rect: Rect;
  /** Short visible text (the slot label). */
  label: string;
  /** Full accessible name, e.g. "Slot A1, Cobb Salad, x 5 %, y 10 %, 40 by 80 %". */
  description: string;
  hasIssue?: boolean;
}

type Drag =
  | { kind: "draw"; start: Point; current: Point; pointerId: number }
  | { kind: "move"; key: string; origin: Rect; grab: Point; pointerId: number }
  | { kind: "resize"; key: string; origin: Rect; handle: ResizeHandle; pointerId: number };

const HANDLES: Array<{ handle: ResizeHandle; style: React.CSSProperties; cursor: string }> = [
  { handle: "nw", style: { left: 0, top: 0 }, cursor: "nwse-resize" },
  { handle: "n", style: { left: "50%", top: 0 }, cursor: "ns-resize" },
  { handle: "ne", style: { left: "100%", top: 0 }, cursor: "nesw-resize" },
  { handle: "e", style: { left: "100%", top: "50%" }, cursor: "ew-resize" },
  { handle: "se", style: { left: "100%", top: "100%" }, cursor: "nwse-resize" },
  { handle: "s", style: { left: "50%", top: "100%" }, cursor: "ns-resize" },
  { handle: "sw", style: { left: 0, top: "100%" }, cursor: "nesw-resize" },
  { handle: "w", style: { left: 0, top: "50%" }, cursor: "ew-resize" },
];

const pct = (v: number) => `${v * 100}%`;

/**
 * The reference image with normalized rectangles on top.
 *
 * The frame is sized to the image's own aspect ratio (never letterboxed), and
 * rectangles are placed in percentages of it, so a slot stays on the same
 * part of the image at every viewport size and zoom level. Pointer positions
 * are converted against the image content box (containedRect), which also
 * excludes any letterbox bars should the frame ever differ from the image.
 *
 * Mouse/touch: drag on empty image to draw, drag a rectangle to move it,
 * drag its handles to resize. Keyboard: each rectangle is a button; arrows
 * move it, Shift+arrows resize, Alt for fine steps, Delete removes, Escape
 * deselects. Numeric fields outside this component edit the same values.
 */
export function SlotCanvas(props: {
  imageUrl: string | null;
  /** Reference width / height. */
  aspect: number;
  rects: CanvasRect[];
  selectedKey: string | null;
  readOnly?: boolean;
  /** Accessible name of the whole canvas. */
  label: string;
  /** Shown instead of the image when there is none (or it failed to load). */
  placeholder?: string;
  onSelect?: (key: string | null) => void;
  onChange?: (key: string, rect: Rect, via: "pointer" | "keyboard") => void;
  onCreate?: (rect: Rect) => void;
  onDelete?: (key: string) => void;
  /** Maximum frame height, as a CSS length. */
  maxHeight?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageFailed = props.imageUrl !== null && failedUrl === props.imageUrl;
  const helpId = useId();
  const editable = !props.readOnly;
  const maxHeight = props.maxHeight ?? "70vh";

  const pointAt = (event: PointerEvent): Point => {
    const element = frame.current!;
    const box = element.getBoundingClientRect();
    const scaleX = box.width / element.offsetWidth;
    const scaleY = box.height / element.offsetHeight;
    // Absolute image/slot overlays occupy the inner box, excluding borders.
    return toNormalizedPoint(event.clientX, event.clientY, containedRect({
      left: box.left + element.clientLeft * scaleX,
      top: box.top + element.clientTop * scaleY,
      width: element.clientWidth * scaleX,
      height: element.clientHeight * scaleY,
    }, props.aspect));
  };

  function startDraw(event: PointerEvent<HTMLDivElement>) {
    if (!editable || event.button !== 0 || !props.onCreate) return;
    const p = pointAt(event);
    frame.current!.setPointerCapture(event.pointerId);
    setDrag({ kind: "draw", start: p, current: p, pointerId: event.pointerId });
    props.onSelect?.(null);
  }

  function startMove(event: PointerEvent, key: string, rect: Rect) {
    event.stopPropagation();
    props.onSelect?.(key);
    if (!editable || event.button !== 0) return;
    frame.current!.setPointerCapture(event.pointerId);
    setDrag({ kind: "move", key, origin: rect, grab: pointAt(event), pointerId: event.pointerId });
  }

  function startResize(event: PointerEvent, key: string, rect: Rect, handle: ResizeHandle) {
    event.stopPropagation();
    if (!editable || event.button !== 0) return;
    frame.current!.setPointerCapture(event.pointerId);
    setDrag({ kind: "resize", key, origin: rect, handle, pointerId: event.pointerId });
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const p = pointAt(event);
    if (drag.kind === "draw") setDrag({ ...drag, current: p });
    else if (drag.kind === "move") props.onChange?.(drag.key, moveRect(drag.origin, p.x - drag.grab.x, p.y - drag.grab.y), "pointer");
    else props.onChange?.(drag.key, resizeRect(drag.origin, drag.handle, p), "pointer");
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.kind === "draw") {
      const rect = rectFromPoints(drag.start, pointAt(event));
      if (rect.width >= MIN_SLOT_SIZE && rect.height >= MIN_SLOT_SIZE) props.onCreate?.(rect);
    }
    setDrag(null);
  }

  function onKeyDown(event: KeyboardEvent, key: string, rect: Rect) {
    if (event.key === "Escape") {
      props.onSelect?.(null);
      return;
    }
    if (!editable) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      props.onDelete?.(key);
      return;
    }
    const next = nudgeRect(rect, event.key, { shift: event.shiftKey, alt: event.altKey });
    if (next) {
      event.preventDefault();
      props.onSelect?.(key);
      props.onChange?.(key, next, "keyboard");
    }
  }

  const drawing = drag?.kind === "draw" ? rectFromPoints(drag.start, drag.current) : null;

  return (
    <div className="flex flex-col gap-2">
      <p id={helpId} className="text-sm text-muted-foreground">
        {editable
          ? "Drag on the image to draw a slot. Select a slot to move or resize it: drag it or its handles, or use the arrow keys (Shift + arrows resize, Alt/Option for small steps, Delete removes). Every value can also be typed in the fields."
          : "Read-only layout. Select a slot to see its details."}
      </p>
      <div
        ref={frame}
        role="group"
        aria-label={props.label}
        aria-describedby={helpId}
        data-testid="slot-canvas"
        onPointerDown={startDraw}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        className={`relative touch-none select-none overflow-hidden rounded-lg border border-border bg-muted ${editable ? "cursor-crosshair" : ""}`}
        style={{ boxSizing: "content-box", aspectRatio: `${props.aspect}`, width: `min(calc(100% - 2px), calc(${maxHeight} * ${props.aspect}))` }}
      >
        {props.imageUrl && !imageFailed ? (
          // A signed, five-minute private Storage link: next/image would fetch and cache it server-side.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={props.imageUrl} alt="" draggable={false} onError={() => setFailedUrl(props.imageUrl)} className="pointer-events-none absolute inset-0 size-full object-contain" />
        ) : (
          <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground">
            {imageFailed ? "The reference image could not be loaded (the link may have expired). Reload the page." : props.placeholder ?? "No reference image."}
          </p>
        )}
        {props.rects.map(({ key, rect, label, description, hasIssue }) => {
          const selected = key === props.selectedKey;
          return (
            <div
              key={key}
              className="absolute"
              style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.width), height: pct(rect.height), zIndex: selected ? 2 : 1 }}
            >
              <button
                type="button"
                aria-label={description}
                aria-pressed={selected}
                data-slot-key={key}
                onPointerDown={(e) => startMove(e, key, rect)}
                onClick={() => props.onSelect?.(key)}
                onKeyDown={(e) => onKeyDown(e, key, rect)}
                className={`absolute inset-0 flex items-start justify-start overflow-hidden rounded-sm border-2 p-0.5 text-left text-xs font-semibold ${
                  selected ? "border-primary bg-primary/25" : hasIssue ? "border-dashed border-destructive bg-destructive/15" : "border-primary/80 bg-primary/10"
                } ${editable ? "cursor-move" : "cursor-pointer"}`}
              >
                <span className="flex max-w-full items-center gap-0.5 truncate rounded bg-card/90 px-1 text-foreground">
                  {hasIssue ? <TriangleAlert aria-hidden className="size-3 shrink-0 text-destructive" /> : null}
                  {label || "—"}
                </span>
              </button>
              {selected && editable
                ? HANDLES.map(({ handle, style, cursor }) => (
                    <span
                      key={handle}
                      aria-hidden
                      data-handle={handle}
                      onPointerDown={(e) => startResize(e, key, rect, handle)}
                      className="absolute z-10 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                      style={{ ...style, cursor }}
                    >
                      <span className="size-2.5 rounded-sm border border-primary-foreground bg-primary" />
                    </span>
                  ))
                : null}
            </div>
          );
        })}
        {drawing ? (
          <div
            aria-hidden
            className="pointer-events-none absolute border-2 border-dashed border-primary bg-primary/10"
            style={{ left: pct(drawing.x), top: pct(drawing.y), width: pct(drawing.width), height: pct(drawing.height) }}
          />
        ) : null}
      </div>
    </div>
  );
}
