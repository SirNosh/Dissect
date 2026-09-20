import { describe, expect, it } from "vitest";
import { positionDissectPopup } from "./popup-position";

const pane = { x: 100, y: 50, width: 400, height: 500 };

describe("positionDissectPopup", () => {
  it("opens down and right of the cursor when there is room", () => {
    const placed = positionDissectPopup({
      cursor: { x: 140, y: 80 },
      size: { width: 240, height: 120 },
      pane,
    });
    expect(placed).toEqual({ x: 146, y: 86, width: 240, height: 120 });
  });

  it("flips left and up when the cursor is at the pane's far edge", () => {
    const placed = positionDissectPopup({
      cursor: { x: 480, y: 520 },
      size: { width: 240, height: 120 },
      pane,
    });
    expect(placed.x + placed.width).toBeLessThanOrEqual(pane.x + pane.width - 8);
    expect(placed.y + placed.height).toBeLessThanOrEqual(pane.y + pane.height - 8);
    expect(placed.x).toBeGreaterThanOrEqual(pane.x + 8);
    expect(placed.y).toBeGreaterThanOrEqual(pane.y + 8);
  });

  it("caps size to the pane and stays inside it", () => {
    const placed = positionDissectPopup({
      cursor: { x: 120, y: 60 },
      size: { width: 800, height: 900 },
      pane,
    });
    expect(placed.width).toBe(400 - 16);
    expect(placed.height).toBe(500 - 16);
    expect(placed.x).toBe(pane.x + 8);
    expect(placed.y).toBe(pane.y + 8);
  });
});
