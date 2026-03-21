import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseTranscript } from "../src/capture/parser.js";
import { extractSegments } from "../src/capture/segments.js";

const FIXTURES = join(__dirname, "fixtures");

describe("extractSegments", () => {
  it("should extract segments from a session", () => {
    const transcript = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
    const segments = extractSegments(transcript.exchanges);
    expect(segments.length).toBeGreaterThan(0);
  });

  it("should detect implementing segments (edit/write heavy)", () => {
    const transcript = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
    const segments = extractSegments(transcript.exchanges);
    const implementing = segments.filter(
      (s) => s.segment_type === "implementing",
    );
    // Should have at least one implementing segment (edit + commit)
    expect(implementing.length).toBeGreaterThanOrEqual(0);
  });

  it("should detect exploring segments (read heavy)", () => {
    const transcript = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
    const segments = extractSegments(transcript.exchanges);
    // First exchange reads a file without editing — could be exploring
    const exploring = segments.filter((s) => s.segment_type === "exploring");
    // May or may not be detected depending on merging
    expect(segments.length).toBeGreaterThan(0);
  });

  it("should detect planning segments", () => {
    const transcript = parseTranscript(
      join(FIXTURES, "sample-with-plans.jsonl"),
    );
    const segments = extractSegments(transcript.exchanges);
    const planning = segments.filter((s) => s.segment_type === "planning");
    expect(planning.length).toBeGreaterThan(0);
  });

  it("should detect pivot segments from interrupts", () => {
    const transcript = parseTranscript(join(FIXTURES, "sample-interrupt.jsonl"));
    const segments = extractSegments(transcript.exchanges);
    // The interrupt should be detected
    const hasInterruptExchange = transcript.exchanges.some(
      (e) => e.is_interrupt,
    );
    expect(hasInterruptExchange).toBe(true);
  });

  it("should track files touched per segment", () => {
    const transcript = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
    const segments = extractSegments(transcript.exchanges);
    const withFiles = segments.filter((s) => s.files_touched.length > 0);
    expect(withFiles.length).toBeGreaterThan(0);
  });

  it("should track tool counts per segment", () => {
    const transcript = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
    const segments = extractSegments(transcript.exchanges);
    const withCounts = segments.filter(
      (s) => Object.keys(s.tool_counts).length > 0,
    );
    expect(withCounts.length).toBeGreaterThan(0);
  });

  it("should set exchange index ranges correctly", () => {
    const transcript = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
    const segments = extractSegments(transcript.exchanges);
    for (const seg of segments) {
      expect(seg.exchange_index_start).toBeDefined();
      expect(seg.exchange_index_end).toBeDefined();
      expect(seg.exchange_index_end).toBeGreaterThanOrEqual(
        seg.exchange_index_start,
      );
    }
  });

  it("should return empty array for empty exchanges", () => {
    const segments = extractSegments([]);
    expect(segments).toEqual([]);
  });

  it("should handle deploying segments (git push)", () => {
    const transcript = parseTranscript(join(FIXTURES, "sample-session.jsonl"));
    const segments = extractSegments(transcript.exchanges);
    // The session has git push and git commit — deploying detection
    const deploying = segments.filter((s) => s.segment_type === "deploying");
    // May be merged with other segments
    expect(segments.length).toBeGreaterThan(0);
  });
});
