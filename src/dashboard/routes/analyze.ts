import { Hono } from "hono";
import { getDb } from "../../db/index.js";
import {
  getSession,
  getSessionById,
  getSessionExchanges,
  getSessionSegments,
  insertDecision,
} from "../../db/queries.js";
import { loadConfig } from "../../cli/config.js";
import { createProvider, ANALYSIS_MODELS } from "../../analysis/providers.js";
import { generateTitle } from "../../analysis/titles.js";
import { generateSegmentSummaries } from "../../analysis/summaries.js";
import { extractDecisions } from "../../analysis/decisions.js";
import type { ParsedExchange } from "../../types.js";
import type { ExtractedSegment } from "../../capture/segments.js";

export const analyzeRoutes = new Hono();

// POST /api/sessions/:id/analyze — run AI analysis on a single session
analyzeRoutes.post("/sessions/:id/analyze", async (c) => {
  const id = c.req.param("id");
  const session = getSession(id) ?? getSessionById(id);
  if (!session) return c.json({ error: "Session not found" }, 404);

  const config = loadConfig();
  if (!config.analysis.enabled) return c.json({ error: "AI analysis is not enabled. Go to Settings to enable it." }, 400);
  if (!config.analysis.apiKey) return c.json({ error: "No API key configured. Go to Settings to add your Anthropic API key." }, 400);

  const provider = createProvider(config.analysis);
  if (!provider) return c.json({ error: "Could not create AI provider" }, 400);

  const db = getDb();
  const exchanges = getSessionExchanges(session.id);
  const segments = getSessionSegments(session.id);

  // Convert DB exchanges to ParsedExchange format (with tool calls for richer context)
  const parsedExchanges: ParsedExchange[] = exchanges.map((e) => {
    const tools = db.prepare("SELECT tool_name as name, tool_input as input, tool_use_id as id, is_error FROM tool_calls WHERE exchange_id = ?").all(e.id) as any[];
    return {
      index: e.exchange_index,
      user_prompt: e.user_prompt,
      assistant_response: e.assistant_response,
      tool_calls: tools.map((tc: any) => ({
        name: tc.name,
        input: (() => { try { return JSON.parse(tc.input); } catch { return tc.input; } })(),
        id: tc.id || "",
        is_error: !!tc.is_error,
      })),
      timestamp: e.timestamp,
      is_interrupt: !!e.is_interrupt,
      is_compact_summary: !!e.is_compact_summary,
    };
  });

  const extractedSegments: ExtractedSegment[] = segments.map((s) => ({
    segment_type: s.segment_type as any,
    exchange_index_start: s.exchange_index_start,
    exchange_index_end: s.exchange_index_end,
    files_touched: (() => { try { return JSON.parse(s.files_touched); } catch { return []; } })(),
    tool_counts: (() => { try { return JSON.parse(s.tool_counts); } catch { return {}; } })(),
  }));

  const results: Record<string, unknown> = {};

  // Generate title
  if (config.analysis.features.sessionTitles.enabled) {
    try {
      const title = await generateTitle(provider, parsedExchanges, config.analysis.features.sessionTitles.model);
      if (title) {
        db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(title, session.id);
        results.title = title;
      }
    } catch (e: any) {
      console.error("[AI] Title generation failed:", e.message);
      results.titleError = e.message;
    }
  }

  // Generate segment summaries
  if (config.analysis.features.segmentSummaries.enabled) {
    try {
      const summaries = await generateSegmentSummaries(provider, parsedExchanges, extractedSegments, config.analysis.features.segmentSummaries.model);
      let updated = 0;
      for (const [idx, summary] of summaries) {
        if (segments[idx]) {
          db.prepare("UPDATE segments SET summary = ? WHERE id = ?").run(summary, segments[idx].id);
          updated++;
        }
      }
      results.segmentSummaries = updated;
    } catch (e: any) {
      console.error("[AI] Segment summaries failed:", e.message);
      results.summaryError = e.message;
    }
  }

  // Extract decisions
  if (config.analysis.features.decisionExtraction.enabled) {
    try {
      const decisions = await extractDecisions(provider, parsedExchanges, config.analysis.features.decisionExtraction.model);
      // Clear previous decisions for this session before inserting
      db.prepare("DELETE FROM decisions WHERE session_id = ?").run(session.id);
      for (const d of decisions) {
        insertDecision({
          session_id: session.id,
          exchange_index: d.exchange_index,
          decision_text: d.decision_text,
          context: d.context,
          alternatives: JSON.stringify(d.alternatives),
        });
      }
      results.decisions = decisions.length;
    } catch (e: any) {
      console.error("[AI] Decision extraction failed:", e.message);
      results.decisionError = e.message;
    }
  }

  return c.json({ ok: true, session_id: session.session_id, results });
});

// POST /api/analyze/bulk — run analysis on multiple sessions
analyzeRoutes.post("/analyze/bulk", async (c) => {
  const body = await c.req.json<{ limit?: number }>().catch(() => ({}));
  const limit = (body as any).limit || 10;

  const config = loadConfig();
  if (!config.analysis.enabled || !config.analysis.apiKey) {
    return c.json({ error: "AI analysis not configured" }, 400);
  }

  const provider = createProvider(config.analysis);
  if (!provider) return c.json({ error: "Could not create provider" }, 400);

  const db = getDb();
  // Find sessions without AI titles (not yet analyzed)
  const sessions = db.prepare(`
    SELECT id, session_id FROM sessions
    WHERE (title IS NULL OR title = '' OR title LIKE '%[Request%' OR length(title) < 5)
    AND exchange_count > 0
    ORDER BY started_at DESC
    LIMIT ?
  `).all(limit) as Array<{ id: string; session_id: string }>;

  const results: Array<{ session_id: string; title?: string; error?: string }> = [];

  for (const session of sessions) {
    try {
      const exchanges = getSessionExchanges(session.id);
      const parsedExchanges: ParsedExchange[] = exchanges.map((e) => ({
        index: e.exchange_index,
        user_prompt: e.user_prompt,
        assistant_response: e.assistant_response,
        tool_calls: [],
        timestamp: e.timestamp,
        is_interrupt: !!e.is_interrupt,
        is_compact_summary: !!e.is_compact_summary,
      }));

      if (parsedExchanges.length === 0) continue;

      // Generate title
      if (config.analysis.features.sessionTitles.enabled) {
        const title = await generateTitle(provider, parsedExchanges, config.analysis.features.sessionTitles.model);
        if (title) {
          db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(title, session.id);
          results.push({ session_id: session.session_id, title });
        }
      }

      // Generate segment summaries
      if (config.analysis.features.segmentSummaries.enabled) {
        const segments = getSessionSegments(session.id);
        const extractedSegments: ExtractedSegment[] = segments.map((s) => ({
          segment_type: s.segment_type as any,
          exchange_index_start: s.exchange_index_start,
          exchange_index_end: s.exchange_index_end,
          files_touched: (() => { try { return JSON.parse(s.files_touched); } catch { return []; } })(),
          tool_counts: (() => { try { return JSON.parse(s.tool_counts); } catch { return {}; } })(),
        }));
        const summaries = await generateSegmentSummaries(provider, parsedExchanges, extractedSegments, config.analysis.features.segmentSummaries.model);
        for (const [idx, summary] of summaries) {
          if (segments[idx]) {
            db.prepare("UPDATE segments SET summary = ? WHERE id = ?").run(summary, segments[idx].id);
          }
        }
      }
    } catch (e: any) {
      results.push({ session_id: session.session_id, error: e.message });
    }
  }

  return c.json({ processed: results.length, results });
});

// GET /api/analyze/status — check how many sessions need analysis
analyzeRoutes.get("/analyze/status", (c) => {
  const db = getDb();
  const config = loadConfig();

  const total = (db.prepare("SELECT COUNT(*) as c FROM sessions WHERE exchange_count > 0").get() as any).c;
  const needsTitle = (db.prepare("SELECT COUNT(*) as c FROM sessions WHERE (title IS NULL OR title = '' OR title LIKE '%[Request%' OR length(title) < 5) AND exchange_count > 0").get() as any).c;
  const hasSummaries = (db.prepare("SELECT COUNT(DISTINCT session_id) as c FROM segments WHERE summary IS NOT NULL").get() as any).c;
  const hasDecisions = (db.prepare("SELECT COUNT(DISTINCT session_id) as c FROM decisions").get() as any).c;

  return c.json({
    enabled: config.analysis.enabled,
    hasApiKey: !!config.analysis.apiKey,
    total,
    needsTitle,
    hasSummaries,
    hasDecisions,
    analyzed: total - needsTitle,
  });
});

// GET /api/analyze/models — list available models for UI dropdowns
analyzeRoutes.get("/analyze/models", (c) => {
  return c.json(ANALYSIS_MODELS.map(m => ({ id: m.id, label: m.label, description: m.description, tier: m.tier })));
});
