import { describe, expect, it } from "vitest";
import { makeBBox, normalizeBBox, unionBBox } from "../src/utils/bbox.js";

describe("bbox utilities", () => {
  it("creates pixel and normalized boxes", () => {
    const bbox = makeBBox(100, 200, 900, 700);
    expect(bbox).toEqual({ x1: 100, y1: 200, x2: 900, y2: 700, width: 800, height: 500 });
    expect(normalizeBBox(bbox, 1654, 2339)).toEqual({
      left: 0.0605,
      top: 0.0855,
      width: 0.4837,
      height: 0.2138
    });
  });

  it("unions boxes", () => {
    expect(unionBBox([makeBBox(5, 10, 20, 30), makeBBox(1, 12, 25, 18)])).toEqual({
      x1: 1,
      y1: 10,
      x2: 25,
      y2: 30,
      width: 24,
      height: 20
    });
  });
});
