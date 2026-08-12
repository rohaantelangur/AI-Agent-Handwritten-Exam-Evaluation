import type { BBox, NormalizedBBox } from "../schemas/common.js";

export function makeBBox(x1: number, y1: number, x2: number, y2: number): BBox {
  if (x2 < x1 || y2 < y1) {
    throw new Error(`Invalid bbox: [${x1}, ${y1}, ${x2}, ${y2}]`);
  }
  return {
    x1: Math.round(x1),
    y1: Math.round(y1),
    x2: Math.round(x2),
    y2: Math.round(y2),
    width: Math.round(x2 - x1),
    height: Math.round(y2 - y1)
  };
}

export function normalizeBBox(bbox: BBox, pageWidth: number, pageHeight: number): NormalizedBBox {
  return {
    left: round4(bbox.x1 / pageWidth),
    top: round4(bbox.y1 / pageHeight),
    width: round4(bbox.width / pageWidth),
    height: round4(bbox.height / pageHeight)
  };
}

export function unionBBox(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null;
  return makeBBox(
    Math.min(...boxes.map((box) => box.x1)),
    Math.min(...boxes.map((box) => box.y1)),
    Math.max(...boxes.map((box) => box.x2)),
    Math.max(...boxes.map((box) => box.y2))
  );
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
