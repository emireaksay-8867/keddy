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
