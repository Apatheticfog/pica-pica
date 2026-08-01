import { describe, expect, it } from "vitest";
import { parsePerformanceMode, serializePerformanceMode } from "./performance-mode";

describe("performance mode persistence", () => {
  it("only enables the mode for the explicit enabled value", () => {
    expect(parsePerformanceMode("enabled")).toBe(true);
    expect(parsePerformanceMode("disabled")).toBe(false);
    expect(parsePerformanceMode(null)).toBe(false);
  });

  it("serializes both toggle states", () => {
    expect(serializePerformanceMode(true)).toBe("enabled");
    expect(serializePerformanceMode(false)).toBe("disabled");
  });
});
