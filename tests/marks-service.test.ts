import { describe, expect, it } from "vitest";
import { MarksService } from "../src/services/marks-service.js";

describe("MarksService", () => {
  const service = new MarksService();

  it("clamps marks to the valid range", () => {
    expect(service.clampMarks(5, 9, 0.5)).toBe(5);
    expect(service.clampMarks(5, -1, 0.5)).toBe(0);
  });

  it("rounds to configured increment", () => {
    expect(service.clampMarks(5, 2.24, 0.5)).toBe(2);
    expect(service.clampMarks(5, 2.26, 0.5)).toBe(2.5);
    expect(service.clampMarks(5, 2.37, 0.25)).toBe(2.25);
  });
});
