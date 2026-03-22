import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseTranscript } from "../src/capture/parser.js";
import { extractPlans } from "../src/capture/plans.js";

const FIXTURES = join(__dirname, "fixtures");

describe("extractPlans", () => {
  it("should extract all plan versions", () => {
    const transcript = parseTranscript(
      join(FIXTURES, "sample-with-plans.jsonl"),
    );
    const plans = extractPlans(transcript.exchanges);
    expect(plans.length).toBe(3);
  });

  it("should assign sequential version numbers", () => {
    const transcript = parseTranscript(
      join(FIXTURES, "sample-with-plans.jsonl"),
    );
    const plans = extractPlans(transcript.exchanges);
    expect(plans[0].version).toBe(1);
    expect(plans[1].version).toBe(2);
    expect(plans[2].version).toBe(3);
  });

  it("should extract plan text", () => {
    const transcript = parseTranscript(
      join(FIXTURES, "sample-with-plans.jsonl"),
    );
    const plans = extractPlans(transcript.exchanges);
    expect(plans[0].plan_text).toContain("Auth Implementation Plan v1");
    expect(plans[0].plan_text).toContain("Add JWT middleware");
    expect(plans[1].plan_text).toContain("Auth Implementation Plan v2");
    expect(plans[2].plan_text).toContain("Auth Implementation Plan v3");
  });

  it("should detect approved plans", () => {
    const transcript = parseTranscript(
      join(FIXTURES, "sample-with-plans.jsonl"),
    );
    const plans = extractPlans(transcript.exchanges);
    // Plan v1 was approved first but should be superseded
    // Plan v3 is the final approved plan
    expect(plans[2].status).toBe("approved");
  });

  it("should detect revised plans (rejected with feedback + next version)", () => {
    const transcript = parseTranscript(
      join(FIXTURES, "sample-with-plans.jsonl"),
    );
    const plans = extractPlans(transcript.exchanges);
    // v2 was "rejected" with feedback, and v3 exists → should be "revised"
    expect(plans[1].status).toBe("revised");
  });

  it("should extract user feedback from rejection", () => {
    const transcript = parseTranscript(
      join(FIXTURES, "sample-with-plans.jsonl"),
    );
    const plans = extractPlans(transcript.exchanges);
    const rejectedPlan = plans[1];
    expect(rejectedPlan.user_feedback).toContain("Passport.js");
  });

  it("should mark superseded plans", () => {
    const transcript = parseTranscript(
      join(FIXTURES, "sample-with-plans.jsonl"),
    );
    const plans = extractPlans(transcript.exchanges);
    // v1 was approved but superseded by v3
    expect(plans[0].status).toBe("superseded");
  });

  it("should track exchange index ranges", () => {
    const transcript = parseTranscript(
      join(FIXTURES, "sample-with-plans.jsonl"),
    );
    const plans = extractPlans(transcript.exchanges);
    for (const plan of plans) {
      expect(plan.exchange_index_start).toBeDefined();
      expect(plan.exchange_index_end).toBeDefined();
      expect(plan.exchange_index_end).toBeGreaterThanOrEqual(
        plan.exchange_index_start,
      );
    }
  });

  it("should return empty array for sessions without plans", () => {
    const transcript = parseTranscript(
      join(FIXTURES, "sample-session.jsonl"),
    );
    const plans = extractPlans(transcript.exchanges);
    expect(plans).toEqual([]);
  });
});
