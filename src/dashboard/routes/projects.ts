import { Hono } from "hono";
import { getProjects } from "../../db/queries.js";

export const projectsRoutes = new Hono();

interface ProjectView {
  project_path: string;
  session_count: number;
  last_activity: string;
  exchange_count: number;
  org: string;
  repo: string;
  short_path: string;
}

// Known orgs — GitHub org folders that contain repos
const KNOWN_ORGS = ["LIVAD-Technologies"];

function parseProjectPath(projectPath: string): { org: string; repo: string } {
  const parts = projectPath.split("/");

  // Detect worktrees: .../worktrees/repo-name/branch
  const worktreeIdx = parts.findIndex((s) => s === "worktrees");
  if (worktreeIdx >= 0 && worktreeIdx + 1 < parts.length) {
    return { org: "", repo: parts[worktreeIdx + 1] };
  }

  // Standard GitHub path: .../GitHub/[Org/]RepoName
  const ghIdx = parts.indexOf("GitHub");
  if (ghIdx >= 0) {
    const after = parts.slice(ghIdx + 1).filter(Boolean);

    if (after.length === 0) return { org: "", repo: "unknown" };

    // Check if first component is a known org
    if (after.length >= 2 && KNOWN_ORGS.includes(after[0])) {
      return { org: after[0], repo: after[1] };
    }

    // Check if first component looks like an org (contains uppercase or "Technologies" etc)
    if (after.length >= 2 && /[A-Z]/.test(after[0]) && after[0] !== after[0].toUpperCase()) {
      // Mixed case like "LIVAD-Technologies" = org
      return { org: after[0], repo: after[1] };
    }

    // Single component or personal repo
    return { org: "", repo: after[0] };
  }

  // Fallback
  return { org: "", repo: parts[parts.length - 1] || projectPath };
}

// Normalize repo names: merge corrupted paths (e.g. "repo/v2" → "repo-v2")
function normalizeRepo(repo: string): string {
  return repo;
}

projectsRoutes.get("/projects", (c) => {
  const raw = getProjects();

  // Parse and normalize all project paths
  const parsed = raw.map((p) => {
    const { org, repo } = parseProjectPath(p.project_path);
    return { ...p, org, repo, short_path: org ? `${org}/${repo}` : repo };
  });

  // Merge projects: same repo name merges together, org version preferred
  const merged = new Map<string, ProjectView>();

  // First pass: insert all with org (they're the canonical entries)
  for (const p of parsed) {
    if (!p.org) continue;
    const key = p.repo.toLowerCase();
    if (merged.has(key)) {
      const existing = merged.get(key)!;
      existing.session_count += p.session_count;
      existing.exchange_count += p.exchange_count;
      if (p.last_activity > existing.last_activity) existing.last_activity = p.last_activity;
    } else {
      merged.set(key, {
        project_path: p.project_path,
        session_count: p.session_count,
        last_activity: p.last_activity,
        exchange_count: p.exchange_count,
        org: p.org,
        repo: p.repo,
        short_path: p.short_path,
      });
    }
  }

  // Second pass: merge non-org projects — if repo name matches an org project, merge into it
  for (const p of parsed) {
    if (p.org) continue;
    const key = p.repo.toLowerCase();
    if (merged.has(key)) {
      // Merge into existing entry — prefer the path with more sessions as canonical
      const existing = merged.get(key)!;
      if (p.session_count > existing.session_count) {
        existing.project_path = p.project_path;
        existing.short_path = existing.org ? `${existing.org}/${existing.repo}` : existing.repo;
      }
      existing.session_count += p.session_count;
      existing.exchange_count += p.exchange_count;
      if (p.last_activity > existing.last_activity) existing.last_activity = p.last_activity;
    } else {
      // Standalone personal repo
      merged.set(key, {
        project_path: p.project_path,
        session_count: p.session_count,
        last_activity: p.last_activity,
        exchange_count: p.exchange_count,
        org: "",
        repo: p.repo,
        short_path: p.repo,
      });
    }
  }

  // Remove entries that are clearly fragments from corrupted deriveProjectPath
  // Only merge if the short name has 1 session and no real project_path (a true fragment)
  // e.g. "LIVAD" from corrupted "LIVAD-Technologies" path
  // Do NOT merge repos that share a prefix — "foo" and "foo-v2" are different repos
  const repoNames = new Set(Array.from(merged.keys()));
  for (const key of repoNames) {
    const entry = merged.get(key)!;
    // Only treat as fragment if: single session, no org, and the project_path looks corrupted
    // (doesn't contain /GitHub/ or /Documents/ — meaning it came from deriveProjectPath)
    const looksCorrupted = !entry.project_path.includes("/GitHub/") && !entry.project_path.includes("/Documents/");
    if (entry.session_count <= 2 && !entry.org && looksCorrupted) {
      for (const otherKey of repoNames) {
        if (otherKey !== key && otherKey.startsWith(key + "-")) {
          const other = merged.get(otherKey)!;
          other.session_count += entry.session_count;
          other.exchange_count += entry.exchange_count;
          if (entry.last_activity > other.last_activity) other.last_activity = entry.last_activity;
          merged.delete(key);
          break;
        }
      }
    }
  }

  const result = Array.from(merged.values()).sort(
    (a, b) => b.last_activity.localeCompare(a.last_activity),
  );

  return c.json(result);
});
