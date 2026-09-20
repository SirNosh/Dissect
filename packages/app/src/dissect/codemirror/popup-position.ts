export interface PopupRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PopupPoint {
  x: number;
  y: number;
}

export interface PopupSize {
  width: number;
  height: number;
}

const EDGE_PADDING = 8;
const CURSOR_GAP = 6;

/**
 * Place a popup next to the cursor, flipped if needed, then clamped so the
 * whole box stays inside `pane`. Width/height are also capped to the pane.
 */
export function positionDissectPopup(input: {
  cursor: PopupPoint;
  size: PopupSize;
  pane: PopupRect;
}): { x: number; y: number; width: number; height: number } {
  const maxWidth = Math.max(0, input.pane.width - EDGE_PADDING * 2);
  const maxHeight = Math.max(0, input.pane.height - EDGE_PADDING * 2);
  const width = Math.min(input.size.width, maxWidth);
  const height = Math.min(input.size.height, maxHeight);

  const paneRight = input.pane.x + input.pane.width;
  const paneBottom = input.pane.y + input.pane.height;
  const fitsRight = input.cursor.x + CURSOR_GAP + width <= paneRight - EDGE_PADDING;
  const fitsBelow = input.cursor.y + CURSOR_GAP + height <= paneBottom - EDGE_PADDING;

  let x = fitsRight ? input.cursor.x + CURSOR_GAP : input.cursor.x - CURSOR_GAP - width;
  let y = fitsBelow ? input.cursor.y + CURSOR_GAP : input.cursor.y - CURSOR_GAP - height;

  const minX = input.pane.x + EDGE_PADDING;
  const minY = input.pane.y + EDGE_PADDING;
  const maxX = paneRight - EDGE_PADDING - width;
  const maxY = paneBottom - EDGE_PADDING - height;
  x = clamp(x, minX, Math.max(minX, maxX));
  y = clamp(y, minY, Math.max(minY, maxY));
  return { x, y, width, height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
