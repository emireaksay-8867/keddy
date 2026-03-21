import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseTranscript, parseLatestExchanges } from "../src/capture/parser.js";

const FIXTURES = join(__dirname, "fixtures");

describe("parseTranscript", () => {
  describe("basic session parsing", () => {
    it("should extract session metadata", () => {
      const result = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
      expect(result.session_id).toBe("sess-001");
      expect(result.project_path).toBe("/Users/test/project");
      expect(result.git_branch).toBe("main");
      expect(result.claude_version).toBe("1.0.0");
      expect(result.slug).toBe("test-project");
    });

    it("should extract all exchanges", () => {
      const result = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
      expect(result.exchanges.length).toBe(5);
    });

    it("should extract user prompts correctly", () => {
      const result = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
      expect(result.exchanges[0].user_prompt).toBe("Read the package.json file");
      expect(result.exchanges[1].user_prompt).toBe("Now edit the description field");
      expect(result.exchanges[2].user_prompt).toBe("Run the tests");
    });

    it("should extract assistant responses", () => {
      const result = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
      expect(result.exchanges[0].assistant_response).toContain(
        "package.json contains a project named 'test'",
      );
    });

    it("should assign sequential exchange indices", () => {
      const result = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
      result.exchanges.forEach((e, i) => {
        expect(e.index).toBe(i);
      });
    });
  });

  describe("tool call detection", () => {
    it("should detect Read tool calls", () => {
      const result = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
      const readExchange = result.exchanges[0];
      expect(readExchange.tool_calls.length).toBeGreaterThanOrEqual(1);
      expect(readExchange.tool_calls[0].name).toBe("Read");
      expect(readExchange.tool_calls[0].id).toBe("tool-001");
    });

    it("should detect Edit tool calls", () => {
      const result = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
      const editExchange = result.exchanges[1];
      const editTool = editExchange.tool_calls.find((tc) => tc.name === "Edit");
      expect(editTool).toBeDefined();
      expect(editTool!.id).toBe("tool-002");
    });

    it("should detect Bash tool calls", () => {
      const result = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
      const testExchange = result.exchanges[2];
      const bashTool = testExchange.tool_calls.find((tc) => tc.name === "Bash");
      expect(bashTool).toBeDefined();
      expect((bashTool!.input as { command: string }).command).toBe("npm test");
    });

    it("should extract tool input data", () => {
      const result = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
      const readTool = result.exchanges[0].tool_calls[0];
      expect(readTool.input).toEqual({
        file_path: "/Users/test/project/package.json",
      });
    });
  });

  describe("plan mode detection", () => {
    it("should detect EnterPlanMode tool calls", () => {
      const result = parseTranscript(join(FIXTURES, "sample-with-plans.jsonl"));
      const planExchanges = result.exchanges.filter((e) =>
        e.tool_calls.some((tc) => tc.name === "EnterPlanMode"),
      );
      expect(planExchanges.length).toBe(3);
    });

    it("should detect ExitPlanMode tool calls with plan text", () => {
      const result = parseTranscript(join(FIXTURES, "sample-with-plans.jsonl"));
      const exitPlanExchanges = result.exchanges.filter((e) =>
        e.tool_calls.some((tc) => tc.name === "ExitPlanMode"),
      );
      expect(exitPlanExchanges.length).toBe(3);

      const firstExit = exitPlanExchanges[0].tool_calls.find(
        (tc) => tc.name === "ExitPlanMode",
      )!;
      expect((firstExit.input as { plan: string }).plan).toContain(
        "Auth Implementation Plan v1",
      );
    });
  });

  describe("compaction detection", () => {
    it("should detect compaction boundaries", () => {
      const result = parseTranscript(
        join(FIXTURES, "sample-with-compaction.jsonl"),
      );
      expect(result.compaction_boundaries.length).toBe(1);
    });

    it("should detect compact summary messages", () => {
      const result = parseTranscript(
        join(FIXTURES, "sample-with-compaction.jsonl"),
      );
      const summaryExchanges = result.exchanges.filter(
        (e) => e.is_compact_summary,
      );
      expect(summaryExchanges.length).toBe(1);
    });
  });

  describe("interrupt detection", () => {
    it("should detect interrupted exchanges", () => {
      const result = parseTranscript(join(FIXTURES, "sample-interrupt.jsonl"));
      const interrupts = result.exchanges.filter((e) => e.is_interrupt);
      expect(interrupts.length).toBe(1);
      expect(interrupts[0].assistant_response).toContain(
        "[Request interrupted by user]",
      );
    });
  });

  describe("skip types", () => {
    it("should not include progress entries", () => {
      // Our fixtures don't have progress entries, but verify the parser handles them
      const result = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
      // All exchanges should be real exchanges, not progress entries
      for (const ex of result.exchanges) {
        expect(ex.user_prompt).toBeTruthy();
      }
    });
  });
});

describe("parseLatestExchanges", () => {
  it("should return the last exchange when no since parameter", () => {
    const result = parseLatestExchanges(join(FIXTURES, "sample-session.jsonl"));
    expect(result.length).toBe(1);
    expect(result[0].user_prompt).toBe("Push to remote");
  });

  it("should return exchanges since a given index", () => {
    const result = parseLatestExchanges(
      join(FIXTURES, "sample-session.jsonl"),
      3,
    );
    expect(result.length).toBe(2);
    expect(result[0].index).toBe(3);
    expect(result[1].index).toBe(4);
  });

  it("should return empty array when since is beyond all exchanges", () => {
    const result = parseLatestExchanges(
      join(FIXTURES, "sample-session.jsonl"),
      100,
    );
    expect(result.length).toBe(0);
  });
});
