const BASE = "/api";

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function getProjects() {
  return fetchJson<
    Array<{
      project_path: string;
      session_count: number;
      last_activity: string;
      exchange_count: number;
      org: string;
      repo: string;
      short_path: string;
    }>
  >("/projects");
}

export async function getSessions(params?: {
  q?: string;
  project?: string;
  days?: number;
  limit?: number;
}) {
  const searchParams = new URLSearchParams();
  if (params?.q) searchParams.set("q", params.q);
  if (params?.project) searchParams.set("project", params.project);
  if (params?.days) searchParams.set("days", String(params.days));
  if (params?.limit) searchParams.set("limit", String(params.limit));
  else searchParams.set("limit", "200");
  searchParams.set("days", String(params?.days ?? 365));
  const qs = searchParams.toString();
  return fetchJson(`/sessions${qs ? `?${qs}` : ""}`);
}

export async function getSession(id: string) {
  return fetchJson(`/sessions/${id}`);
}

export async function getSessionExchanges(id: string, withTools = false) {
  return fetchJson(`/sessions/${id}/exchanges${withTools ? "?tools=true" : ""}`);
}

export async function getSessionPlans(id: string) {
  return fetchJson(`/sessions/${id}/plans`);
}

export async function updateSessionTitle(id: string, title: string) {
  return fetchJson(`/sessions/${id}/title`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export async function getStats() {
  return fetchJson("/stats");
}

export async function getConfig() {
  return fetchJson("/config");
}

export async function updateConfig(config: unknown) {
  return fetchJson("/config", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export async function analyzeSession(id: string) {
  return fetchJson(`/sessions/${id}/analyze`, { method: "POST" });
}

export async function analyzeBulk(limit: number = 10) {
  return fetchJson("/analyze/bulk", {
    method: "POST",
    body: JSON.stringify({ limit }),
  });
}

export async function getAnalyzeStatus() {
  return fetchJson<{
    enabled: boolean;
    hasApiKey: boolean;
    total: number;
    needsTitle: number;
    hasSummaries: number;
    hasDecisions: number;
    analyzed: number;
  }>("/analyze/status");
}

export interface AnalysisModel {
  id: string;
  label: string;
  description: string;
  tier: "fast" | "smart" | "powerful";
}

export async function getAnalysisModels() {
  return fetchJson<AnalysisModel[]>("/analyze/models");
}

export async function getFileDiffs(sessionId: string, filePath: string) {
  return fetchJson(`/sessions/${sessionId}/file/${encodeURIComponent(filePath)}`);
}

export async function getToolCall(sessionId: string, toolCallId: string) {
  return fetchJson(`/sessions/${sessionId}/tool-call/${toolCallId}`);
}

// --- Session Notes ---

export async function getSessionNotes(sessionId: string) {
  return fetchJson<import("./types.js").SessionNote[]>(`/sessions/${sessionId}/notes`);
}

export async function getSessionMermaid(sessionId: string) {
  return fetchJson<{ mermaid: string }>(`/sessions/${sessionId}/mermaid`);
}

export async function deleteSessionNotes(sessionId: string) {
  return fetchJson(`/sessions/${sessionId}/notes`, { method: "DELETE" });
}

export async function deleteSessionNote(sessionId: string, noteId: string) {
  return fetchJson(`/sessions/${sessionId}/notes/${noteId}`, { method: "DELETE" });
}

/** Stream session notes generation via SSE — returns cleanup function */
export function generateSessionNotesSSE(
  sessionId: string,
  callbacks: {
    onEvent: (event: { type: string; message: string; detail?: string; timestamp: number }) => void;
    onDone: (note: import("./types.js").SessionNote) => void;
    onError: (error: string) => void;
  },
  options?: { apiKey?: string; model?: string },
): () => void {
  const controller = new AbortController();

  fetch(`${BASE}/sessions/${sessionId}/notes/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options || {}),
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok || !response.body) {
      callbacks.onError(`HTTP ${response.status}`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.ok && parsed.note) {
              callbacks.onDone(parsed.note);
            } else if (parsed.error) {
              callbacks.onError(parsed.error);
            } else if (parsed.type) {
              callbacks.onEvent(parsed);
            }
          } catch { /* skip malformed */ }
        }
      }
    }
  }).catch((err) => {
    if (err.name !== "AbortError") {
      callbacks.onError(err.message || "Connection failed");
    }
  });

  return () => controller.abort();
}

// --- Daily Notes ---

export async function getDailyData(date: string) {
  return fetchJson<import("./types.js").DailyData>(`/daily/${date}/data`);
}

export async function deleteDailyNote(date: string) {
  return fetchJson(`/daily/${date}`, { method: "DELETE" });
}

export function generateDailyNoteSSE(
  date: string,
  callbacks: {
    onEvent: (event: { type: string; message: string; detail?: string; timestamp: number }) => void;
    onDone: (note: import("./types.js").DailyNote) => void;
    onError: (error: string) => void;
  },
  options?: { apiKey?: string; model?: string; sessionIds?: string[] },
): () => void {
  const controller = new AbortController();

  fetch(`${BASE}/daily/${date}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options || {}),
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok || !response.body) {
      callbacks.onError(`HTTP ${response.status}`);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.ok && parsed.note) callbacks.onDone(parsed.note);
            else if (parsed.error) callbacks.onError(parsed.error);
            else if (parsed.type) callbacks.onEvent(parsed);
          } catch { /* skip */ }
        }
      }
    }
  }).catch((err) => {
    if (err.name !== "AbortError") callbacks.onError(err.message || "Connection failed");
  });

  return () => controller.abort();
}
