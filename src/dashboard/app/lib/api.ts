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
