import { describe, it, expect } from "vitest";
import { getProjectDisplayName } from "../pathDisplay";

describe("getProjectDisplayName", () => {
  it("returns last segment of Windows path", () => {
    expect(
      getProjectDisplayName("D:\\github\\claude-code-history-viewer", "fallback")
    ).toBe("claude-code-history-viewer");
  });

  it("returns last segment of POSIX path", () => {
    expect(
      getProjectDisplayName("/Users/jack/projects/demo", "fallback")
    ).toBe("demo");
  });

  it("strips trailing separators", () => {
    expect(getProjectDisplayName("D:\\foo\\bar\\", "fallback")).toBe("bar");
    expect(getProjectDisplayName("/foo/bar/", "fallback")).toBe("bar");
  });

  it("falls back when actualPath is empty or nullish", () => {
    expect(getProjectDisplayName(null, "fallback")).toBe("fallback");
    expect(getProjectDisplayName(undefined, "fallback")).toBe("fallback");
    expect(getProjectDisplayName("", "fallback")).toBe("fallback");
    expect(getProjectDisplayName("   ", "fallback")).toBe("fallback");
  });

  it("falls back when path has no segments left after stripping separators", () => {
    expect(getProjectDisplayName("/", "fallback")).toBe("fallback");
    expect(getProjectDisplayName("\\\\", "fallback")).toBe("fallback");
  });
});
