import { loadConfig } from "../cli/config.js";
import type { ParsedExchange } from "../types.js";
import type { ExtractedSegment } from "../capture/segments.js";
import { generateTitle } from "./titles.js";
import { generateSegmentSummaries } from "./summaries.js";
import { extractDecisions } from "./decisions.js";
import { createProvider } from "./providers.js";

export interface AnalysisResult {
  title?: string;
  segmentSummaries?: Map<number, string>;
  decisions?: Array<{
    exchange_index: number;
    decision_text: string;
    context: string;
    alternatives: string[];
  }>;
}

export async function runAnalysis(
  exchanges: ParsedExchange[],
  segments: ExtractedSegment[],
): Promise<AnalysisResult> {
  const config = loadConfig();
  if (!config.analysis.enabled) return {};

  const provider = createProvider(config.analysis);
  if (!provider) return {};

  const result: AnalysisResult = {};

  // Session titles
  if (config.analysis.features.sessionTitles.enabled) {
    try {
      result.title = await generateTitle(
        provider,
        exchanges,
        config.analysis.features.sessionTitles.model,
      );
    } catch {
      // Non-critical
    }
  }

  // Segment summaries
  if (config.analysis.features.segmentSummaries.enabled) {
    try {
      result.segmentSummaries = await generateSegmentSummaries(
        provider,
        exchanges,
        segments,
        config.analysis.features.segmentSummaries.model,
      );
    } catch {
      // Non-critical
    }
  }

  // Decision extraction
  if (config.analysis.features.decisionExtraction.enabled) {
    try {
      result.decisions = await extractDecisions(
        provider,
        exchanges,
        config.analysis.features.decisionExtraction.model,
      );
    } catch {
      // Non-critical
    }
  }

  return result;
}
