import { describe, it, expect } from "vitest";
import { extractSegments } from "../src/capture/segments.js";
import type { ParsedExchange } from "../src/types.js";

function makeExchange(
  index: number,
  toolCalls: Array<{ name: string; input?: unknown; id?: string; is_error?: boolean }> = [],
  overrides: Partial<ParsedExchange> = {},
): ParsedExchange {
  return {
    index,
    user_prompt: `Prompt ${index}`,
    assistant_response: `Response ${index}`,
    tool_calls: toolCalls.map((tc, i) => ({
      name: tc.name,
      input: tc.input ?? {},
      id: tc.id ?? `t${index}-${i}`,
      is_error: tc.is_error,
    })),
    timestamp: "2024-01-01T00:00:00Z",
    is_interrupt: false,
    is_compact_summary: false,
    ...overrides,
  };
}

describe("extractSegments — detailed classification", () => {
  it("should classify pure discussion (no tools)", () => {
    const exchanges = [makeExchange(0), makeExchange(1), makeExchange(2)];
    const segments = extractSegments(exchanges);
    expect(segments.length).toBe(1);
    expect(segments[0].segment_type).toBe("discussion");
  });

  it("should classify exploring (read-heavy, no edits)", () => {
    const exchanges = [
      makeExchange(0, [{ name: "Read", input: { file_path: "/a.ts" } }]),
      makeExchange(1, [
        { name: "Grep", input: { pattern: "foo" } },
        { name: "Glob", input: { pattern: "*.ts" } },
      ]),
      makeExchange(2, [{ name: "Read", input: { file_path: "/b.ts" } }]),
    ];
    const segments = extractSegments(exchanges);
    expect(segments[0].segment_type).toBe("exploring");
  });

  it("should classify implementing (edit-heavy)", () => {
    const exchanges = [
      makeExchange(0, [
        { name: "Edit", input: { file_path: "/a.ts" } },
        { name: "Edit", input: { file_path: "/b.ts" } },
      ]),
      makeExchange(1, [
        { name: "Write", input: { file_path: "/c.ts" } },
        { name: "Read", input: { file_path: "/d.ts" } },
      ]),
    ];
    const segments = extractSegments(exchanges);
    expect(segments[0].segment_type).toBe("implementing");
  });

  it("should classify testing (test commands)", () => {
    const exchanges = [
      makeExchange(0, [{ name: "Bash", input: { command: "npm test" } }]),
      makeExchange(1, [{ name: "Bash", input: { command: "npx vitest run" } }]),
    ];
    const segments = extractSegments(exchanges);
    expect(segments[0].segment_type).toBe("testing");
  });

  it("should classify debugging (errors + fixes)", () => {
    const exchanges = [
      makeExchange(0, [{ name: "Bash", input: { command: "npm test" }, is_error: true }]),
      makeExchange(1, [
        { name: "Edit", input: { file_path: "/fix.ts" } },
        { name: "Bash", input: { command: "npm test" }, is_error: true },
      ]),
    ];
    const segments = extractSegments(exchanges);
    // Should be debugging since there are errors + edits
    expect(["debugging", "testing"]).toContain(segments[0].segment_type);
  });

  it("should classify deploying (git push)", () => {
    const exchanges = [
      makeExchange(0, [{ name: "Bash", input: { command: "git push origin main" } }]),
      makeExchange(1, [{ name: "Bash", input: { command: "npm run deploy" } }]),
    ];
    const segments = extractSegments(exchanges);
    expect(segments[0].segment_type).toBe("deploying");
  });

  it("should classify planning (EnterPlanMode/ExitPlanMode)", () => {
    const exchanges = [
      makeExchange(0, [{ name: "EnterPlanMode" }]),
      makeExchange(1, [{ name: "ExitPlanMode", input: { plan: "Step 1..." } }]),
    ];
    const segments = extractSegments(exchanges);
    expect(segments[0].segment_type).toBe("planning");
  });

  it("should classify pivot (interrupt)", () => {
    const exchanges = [
      makeExchange(0, [{ name: "Write" }], { is_interrupt: true }),
      makeExchange(1, [{ name: "Write", input: { file_path: "/new.ts" } }]),
      makeExchange(2, [{ name: "Edit", input: { file_path: "/new.ts" } }]),
    ];
    const segments = extractSegments(exchanges);
    // pivot is a single exchange, should get merged if < 2
    expect(segments.length).toBeGreaterThan(0);
  });
});

describe("extractSegments — merging behavior", () => {
  it("should merge adjacent same-type segments", () => {
    const exchanges = [
      makeExchange(0, [{ name: "Read" }]),
      makeExchange(1, [{ name: "Grep" }]),
      makeExchange(2, [{ name: "Glob" }]),
      makeExchange(3, [{ name: "Read" }]),
    ];
    const segments = extractSegments(exchanges);
    // All exploring, should be 1 segment
    expect(segments.length).toBe(1);
    expect(segments[0].segment_type).toBe("exploring");
  });

  it("should absorb single-exchange segments into previous", () => {
    const exchanges = [
      makeExchange(0, [{ name: "Edit" }]),
      makeExchange(1, [{ name: "Edit" }]),
      makeExchange(2), // single discussion exchange
      makeExchange(3, [{ name: "Edit" }]),
      makeExchange(4, [{ name: "Edit" }]),
    ];
    const segments = extractSegments(exchanges);
    // The single discussion should be absorbed
    expect(segments.length).toBeLessThanOrEqual(2);
  });

  it("should handle alternating types", () => {
    const exchanges = [
      makeExchange(0, [{ name: "Read" }]),
      makeExchange(1, [{ name: "Read" }]),
      makeExchange(2, [{ name: "Edit" }]),
      makeExchange(3, [{ name: "Edit" }]),
      makeExchange(4, [{ name: "Read" }]),
      makeExchange(5, [{ name: "Read" }]),
    ];
    const segments = extractSegments(exchanges);
    expect(segments.length).toBeGreaterThanOrEqual(2);
  });
});

describe("extractSegments — file and tool tracking", () => {
  it("should track unique files per segment", () => {
    const exchanges = [
      makeExchange(0, [
        { name: "Edit", input: { file_path: "/a.ts" } },
        { name: "Edit", input: { file_path: "/b.ts" } },
      ]),
      makeExchange(1, [
        { name: "Edit", input: { file_path: "/a.ts" } }, // duplicate
        { name: "Edit", input: { file_path: "/c.ts" } },
      ]),
    ];
    const segments = extractSegments(exchanges);
    expect(segments[0].files_touched.length).toBe(3); // /a.ts, /b.ts, /c.ts
    expect(new Set(segments[0].files_touched).size).toBe(3);
  });

  it("should count tools correctly", () => {
    const exchanges = [
      makeExchange(0, [
        { name: "Read" },
        { name: "Read" },
        { name: "Edit" },
      ]),
      makeExchange(1, [
        { name: "Read" },
        { name: "Edit" },
        { name: "Edit" },
      ]),
    ];
    const segments = extractSegments(exchanges);
    expect(segments[0].tool_counts["Read"]).toBe(3);
    expect(segments[0].tool_counts["Edit"]).toBe(3);
  });

  it("should extract file_path and path from tool inputs", () => {
    const exchanges = [
      makeExchange(0, [
        { name: "Read", input: { file_path: "/explicit.ts" } },
        { name: "Grep", input: { path: "/search-dir" } },
      ]),
      makeExchange(1, [
        { name: "Edit", input: { file_path: "/edited.ts" } },
      ]),
    ];
    const segments = extractSegments(exchanges);
    const files = segments.flatMap((s) => s.files_touched);
    expect(files).toContain("/explicit.ts");
    expect(files).toContain("/search-dir");
    expect(files).toContain("/edited.ts");
  });
});

describe("extractSegments — large sessions", () => {
  it("should handle 100+ exchanges efficiently", () => {
    const exchanges: ParsedExchange[] = [];
    for (let i = 0; i < 100; i++) {
      const toolName = i % 5 === 0 ? "Read" : i % 3 === 0 ? "Bash" : "Edit";
      exchanges.push(makeExchange(i, [{ name: toolName }]));
    }

    const start = performance.now();
    const segments = extractSegments(exchanges);
    const elapsed = performance.now() - start;

    expect(segments.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100); // Should be fast
  });

  it("should handle 1000 exchanges", () => {
    const exchanges: ParsedExchange[] = [];
    for (let i = 0; i < 1000; i++) {
      exchanges.push(makeExchange(i, [{ name: "Edit" }]));
    }

    const segments = extractSegments(exchanges);
    expect(segments.length).toBe(1); // All implementing, merged into one
    expect(segments[0].segment_type).toBe("implementing");
    expect(segments[0].exchange_index_start).toBe(0);
    expect(segments[0].exchange_index_end).toBe(999);
  });
});
