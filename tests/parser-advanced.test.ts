import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseTranscript, parseLatestExchanges } from "../src/capture/parser.js";
import { extractMilestones } from "../src/capture/milestones.js";

const FIXTURES = join(__dirname, "fixtures");

describe("parseTranscript — multi-tool exchanges", () => {
  it("should correctly group multi-step tool calls into single exchanges", () => {
    const result = parseTranscript(join(FIXTURES, "sample-multi-tool.jsonl"));

    // The session has:
    // Exchange 0: "Refactor the auth module..." → multiple Read+Edit+Bash tool calls → final text response
    // Exchange 1: "Great, now commit..." → Bash (commit, push, pr create) → final text response
    expect(result.exchanges.length).toBe(2);
  });

  it("should collect all tool calls from multi-step assistant responses", () => {
    const result = parseTranscript(join(FIXTURES, "sample-multi-tool.jsonl"));
    const firstExchange = result.exchanges[0];

    // Should have Read, Read, Edit, Edit, Bash, Edit, Bash tool calls
    expect(firstExchange.tool_calls.length).toBe(7);
    expect(firstExchange.tool_calls[0].name).toBe("Read");
    expect(firstExchange.tool_calls[1].name).toBe("Read");
    expect(firstExchange.tool_calls[2].name).toBe("Edit");
  });

  it("should match tool results to correct tool calls", () => {
    const result = parseTranscript(join(FIXTURES, "sample-multi-tool.jsonl"));
    const firstExchange = result.exchanges[0];

    // First Read should have its result
    const firstRead = firstExchange.tool_calls[0];
    expect(firstRead.result).toContain("login");

    // First Bash (npm test) should have error result
    const firstBash = firstExchange.tool_calls.find(
      (tc) => tc.name === "Bash" && tc.id === "tool-054",
    );
    expect(firstBash).toBeDefined();
    expect(firstBash!.is_error).toBe(true);
    expect(firstBash!.result).toContain("FAIL");
  });

  it("should detect debugging pattern (error + subsequent fix)", () => {
    const result = parseTranscript(join(FIXTURES, "sample-multi-tool.jsonl"));
    // The session has a test failure followed by a fix — this is debugging behavior
    const firstExchange = result.exchanges[0];
    const hasError = firstExchange.tool_calls.some((tc) => tc.is_error);
    expect(hasError).toBe(true);
  });

  it("should detect all milestones from multi-tool session", () => {
    const result = parseTranscript(join(FIXTURES, "sample-multi-tool.jsonl"));
    const milestones = extractMilestones(result.exchanges);

    // Should detect: test_fail, test_pass, commit, push, pr
    const types = milestones.map((m) => m.milestone_type);
    expect(types).toContain("test_fail");
    expect(types).toContain("test_pass");
    expect(types).toContain("commit");
    expect(types).toContain("push");
    expect(types).toContain("pr");
  });
});

describe("parseTranscript — forked sessions", () => {
  it("should detect forked session metadata", () => {
    const result = parseTranscript(join(FIXTURES, "sample-forked.jsonl"));
    expect(result.forked_from).toBe("sess-005");
    expect(result.session_id).toBe("sess-006");
  });

  it("should parse forked session exchanges normally", () => {
    const result = parseTranscript(join(FIXTURES, "sample-forked.jsonl"));
    expect(result.exchanges.length).toBe(1);
    expect(result.exchanges[0].user_prompt).toContain("Continue from where we left off");
  });
});

describe("parseTranscript — multi-turn assistant text accumulation", () => {
  it("should accumulate assistant text from multiple assistant messages", () => {
    const result = parseTranscript(join(FIXTURES, "sample-multi-assistant.jsonl"));
    expect(result.exchanges.length).toBe(1);

    const exchange = result.exchanges[0];
    // Should contain text from ALL three assistant messages
    expect(exchange.assistant_response).toContain("Let me look at the login code first");
    expect(exchange.assistant_response).toContain("I see the issue");
    expect(exchange.assistant_response).toContain("login function has been fixed");
  });

  it("should have all tool calls from multi-turn exchange", () => {
    const result = parseTranscript(join(FIXTURES, "sample-multi-assistant.jsonl"));
    const exchange = result.exchanges[0];
    expect(exchange.tool_calls.length).toBe(2);
    expect(exchange.tool_calls[0].name).toBe("Read");
    expect(exchange.tool_calls[1].name).toBe("Edit");
  });

  it("should match tool results correctly in multi-turn exchange", () => {
    const result = parseTranscript(join(FIXTURES, "sample-multi-assistant.jsonl"));
    const exchange = result.exchanges[0];
    expect(exchange.tool_calls[0].result).toContain("return false");
    expect(exchange.tool_calls[1].result).toBe("File edited");
  });
});

describe("parseTranscript — malformed input handling", () => {
  let tmpDir: string;

  function createTempJsonl(content: string): string {
    if (!tmpDir) tmpDir = mkdtempSync(join(tmpdir(), "keddy-parser-"));
    const path = join(tmpDir, `test-${Date.now()}.jsonl`);
    writeFileSync(path, content);
    return path;
  }

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined!;
    }
  });

  it("should handle empty file", () => {
    const path = createTempJsonl("");
    const result = parseTranscript(path);
    expect(result.exchanges).toEqual([]);
    expect(result.session_id).toBe("");
  });

  it("should handle file with only metadata", () => {
    const path = createTempJsonl(
      '{"type":"summary","sessionId":"test","cwd":"/test","timestamp":"2024-01-01"}\n',
    );
    const result = parseTranscript(path);
    expect(result.session_id).toBe("test");
    expect(result.exchanges).toEqual([]);
  });

  it("should skip malformed JSON lines", () => {
    const content = [
      '{"type":"summary","sessionId":"test","cwd":"/test"}',
      "this is not json",
      '{"type":"user","message":{"role":"user","content":"Hello"},"timestamp":"2024-01-01"}',
      "{broken json",
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hi!"}]}}',
    ].join("\n");
    const path = createTempJsonl(content);
    const result = parseTranscript(path);
    expect(result.session_id).toBe("test");
    expect(result.exchanges.length).toBe(1);
    expect(result.exchanges[0].user_prompt).toBe("Hello");
  });

  it("should handle user message with empty content", () => {
    const content = [
      '{"type":"summary","sessionId":"test","cwd":"/test"}',
      '{"type":"user","message":{"role":"user","content":""},"timestamp":"2024-01-01"}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"How can I help?"}]}}',
    ].join("\n");
    const path = createTempJsonl(content);
    const result = parseTranscript(path);
    expect(result.exchanges.length).toBe(1);
    expect(result.exchanges[0].user_prompt).toBe("");
    expect(result.exchanges[0].assistant_response).toBe("How can I help?");
  });

  it("should handle assistant message with no text blocks", () => {
    const content = [
      '{"type":"summary","sessionId":"test","cwd":"/test"}',
      '{"type":"user","message":{"role":"user","content":"Do something"},"timestamp":"2024-01-01"}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Read","input":{"file_path":"/test"},"id":"t1"}]}}',
      '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"file data"}]}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Done."}]}}',
    ].join("\n");
    const path = createTempJsonl(content);
    const result = parseTranscript(path);
    expect(result.exchanges.length).toBe(1);
    expect(result.exchanges[0].tool_calls.length).toBe(1);
    expect(result.exchanges[0].tool_calls[0].result).toBe("file data");
  });

  it("should skip progress and queue-operation entries", () => {
    const content = [
      '{"type":"summary","sessionId":"test","cwd":"/test"}',
      '{"type":"progress","data":"loading"}',
      '{"type":"queue-operation","operation":"enqueue"}',
      '{"type":"file-history-snapshot","snapshot":{}}',
      '{"type":"user","message":{"role":"user","content":"Hello"},"timestamp":"2024-01-01"}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hi"}]}}',
    ].join("\n");
    const path = createTempJsonl(content);
    const result = parseTranscript(path);
    expect(result.exchanges.length).toBe(1);
  });

  it("should handle tool_result with is_error flag", () => {
    const content = [
      '{"type":"summary","sessionId":"test","cwd":"/test"}',
      '{"type":"user","message":{"role":"user","content":"Run command"},"timestamp":"2024-01-01"}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"invalid"},"id":"t1"}]}}',
      '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"command not found","is_error":true}]}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"That command failed."}]}}',
    ].join("\n");
    const path = createTempJsonl(content);
    const result = parseTranscript(path);
    expect(result.exchanges[0].tool_calls[0].is_error).toBe(true);
    expect(result.exchanges[0].tool_calls[0].result).toBe("command not found");
  });

  it("should handle consecutive user messages without assistant responses", () => {
    const content = [
      '{"type":"summary","sessionId":"test","cwd":"/test"}',
      '{"type":"user","message":{"role":"user","content":"First message"},"timestamp":"2024-01-01"}',
      '{"type":"user","message":{"role":"user","content":"Second message without waiting"},"timestamp":"2024-01-01"}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Responding to second message."}]}}',
    ].join("\n");
    const path = createTempJsonl(content);
    const result = parseTranscript(path);
    // First message has no assistant response, second does
    expect(result.exchanges.length).toBe(2);
    expect(result.exchanges[0].user_prompt).toBe("First message");
    expect(result.exchanges[0].assistant_response).toBe("");
    expect(result.exchanges[1].user_prompt).toBe("Second message without waiting");
    expect(result.exchanges[1].assistant_response).toBe("Responding to second message.");
  });

  it("should handle [Request interrupted by user for tool use] variant", () => {
    const content = [
      '{"type":"summary","sessionId":"test","cwd":"/test"}',
      '{"type":"user","message":{"role":"user","content":"Do something"},"timestamp":"2024-01-01"}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"[Request interrupted by user for tool use]"}]}}',
    ].join("\n");
    const path = createTempJsonl(content);
    const result = parseTranscript(path);
    expect(result.exchanges[0].is_interrupt).toBe(true);
  });
});

describe("parseLatestExchanges — edge cases", () => {
  it("should handle file with only one exchange", () => {
    const result = parseLatestExchanges(join(FIXTURES, "sample-forked.jsonl"));
    expect(result.length).toBe(1);
  });

  it("should return correct exchange count from multi-tool file", () => {
    const result = parseLatestExchanges(join(FIXTURES, "sample-multi-tool.jsonl"), 0);
    expect(result.length).toBe(2);
  });
});
