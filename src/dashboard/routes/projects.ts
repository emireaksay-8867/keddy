import { Hono } from "hono";
import { getProjects } from "../../db/queries.js";

export const projectsRoutes = new Hono();

interface ProjectInfo {
  project_path: string;
  session_count: number;
  last_activity: string;
  exchange_count: number;
  org: string;
  repo: string;
  short_path: string;
  is_worktree: boolean;
  worktree_branch: string | null;
}

// GET /api/projects
projectsRoutes.get("/projects", (c) => {
  const raw = getProjects();

  const projects: ProjectInfo[] = raw.map((p) => {
    const path = p.project_path;
    const parts = path.split("/");

    // Detect worktrees: paths containing "worktrees" or ".superset/worktrees"
    const worktreeIdx = parts.findIndex((s) => s === "worktrees");
    if (worktreeIdx >= 0) {
      // e.g. .superset/worktrees/livad-knowledge/branch-name
      // or   .claude/worktrees/repo-name/branch
      const repoName = parts[worktreeIdx + 1] || "unknown";
      const branchName = parts.slice(worktreeIdx + 2).join("/") || null;
      return {
        ...p,
        org: "",
        repo: repoName,
        short_path: branchName ? `${repoName}/${branchName}` : repoName,
        is_worktree: true,
        worktree_branch: branchName,
      };
    }

    // Standard GitHub path: .../GitHub/OrgOrUser/RepoName
    const ghIdx = parts.indexOf("GitHub");
    if (ghIdx >= 0) {
      const remaining = parts.slice(ghIdx + 1);
      if (remaining.length >= 2) {
        // org/repo pattern
        return {
          ...p,
          org: remaining[0],
          repo: remaining[1],
          short_path: `${remaining[0]}/${remaining[1]}`,
          is_worktree: false,
          worktree_branch: null,
        };
      } else if (remaining.length === 1) {
        return {
          ...p,
          org: "",
          repo: remaining[0],
          short_path: remaining[0],
          is_worktree: false,
          worktree_branch: null,
        };
      }
    }

    // Fallback: use last 2 path components
    const repo = parts[parts.length - 1] || parts[parts.length - 2] || path;
    return {
      ...p,
      org: "",
      repo,
      short_path: repo,
      is_worktree: false,
      worktree_branch: null,
    };
  });

  // Merge worktree sessions into their parent repo
  const merged = new Map<string, ProjectInfo>();
  const worktrees = new Map<string, ProjectInfo[]>();

  for (const p of projects) {
    if (p.is_worktree) {
      // Group worktrees under their repo name
      const key = p.repo;
      if (!worktrees.has(key)) worktrees.set(key, []);
      worktrees.get(key)!.push(p);
    } else {
      const key = p.short_path;
      if (merged.has(key)) {
        const existing = merged.get(key)!;
        existing.session_count += p.session_count;
        existing.exchange_count += p.exchange_count;
        if (p.last_activity > existing.last_activity) {
          existing.last_activity = p.last_activity;
        }
      } else {
        merged.set(key, { ...p });
      }
    }
  }

  // Merge worktree counts into parent repos if they exist
  for (const [repoName, wtProjects] of worktrees) {
    const totalSessions = wtProjects.reduce((s, p) => s + p.session_count, 0);
    const totalExchanges = wtProjects.reduce((s, p) => s + p.exchange_count, 0);
    const lastActivity = wtProjects.reduce((a, p) => p.last_activity > a ? p.last_activity : a, "");

    // Find parent repo
    let parent: ProjectInfo | undefined;
    for (const [, m] of merged) {
      if (m.repo === repoName) {
        parent = m;
        break;
      }
    }

    if (parent) {
      parent.session_count += totalSessions;
      parent.exchange_count += totalExchanges;
      if (lastActivity > parent.last_activity) parent.last_activity = lastActivity;
    } else {
      // No parent found — create standalone entry
      merged.set(repoName, {
        project_path: wtProjects[0].project_path,
        session_count: totalSessions,
        exchange_count: totalExchanges,
        last_activity: lastActivity,
        org: "",
        repo: repoName,
        short_path: repoName,
        is_worktree: true,
        worktree_branch: null,
      });
    }
  }

  // Sort by last activity
  const result = Array.from(merged.values()).sort(
    (a, b) => b.last_activity.localeCompare(a.last_activity),
  );

  return c.json(result);
});
