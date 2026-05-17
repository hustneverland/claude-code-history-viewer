import { describe, it, expect } from "vitest";
import { getProjectDisplayName } from "../pathDisplay";

describe("getProjectDisplayName", () => {
  it("returns the full Windows path when provided", () => {
    expect(
      getProjectDisplayName("D:\\github\\claude-code-history-viewer", "fallback")
    ).toBe("D:\\github\\claude-code-history-viewer");
  });

  it("returns the full POSIX path when provided", () => {
    expect(
      getProjectDisplayName("/Users/jack/projects/demo", "fallback")
    ).toBe("/Users/jack/projects/demo");
  });

  it("trims surrounding whitespace", () => {
    expect(getProjectDisplayName("  D:\\foo  ", "fallback")).toBe("D:\\foo");
  });

  it("falls back when actualPath is empty or nullish", () => {
    expect(getProjectDisplayName(null, "fallback")).toBe("fallback");
    expect(getProjectDisplayName(undefined, "fallback")).toBe("fallback");
    expect(getProjectDisplayName("", "fallback")).toBe("fallback");
    expect(getProjectDisplayName("   ", "fallback")).toBe("fallback");
  });
});
