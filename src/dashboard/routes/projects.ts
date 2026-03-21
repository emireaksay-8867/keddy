import { Hono } from "hono";
import { getProjects } from "../../db/queries.js";

export const projectsRoutes = new Hono();

// GET /api/projects
projectsRoutes.get("/projects", (c) => {
  const projects = getProjects();

  // Group by org/owner
  const grouped = projects.map((p) => {
    const parts = p.project_path.split("/");
    // Try to extract org/repo pattern
    const ghIdx = parts.indexOf("GitHub");
    let org = "";
    let repo = "";
    if (ghIdx >= 0 && ghIdx + 1 < parts.length) {
      if (ghIdx + 2 < parts.length) {
        org = parts[ghIdx + 1];
        repo = parts[ghIdx + 2];
      } else {
        repo = parts[ghIdx + 1];
      }
    } else {
      // Worktree or other path
      repo = parts[parts.length - 1] || parts[parts.length - 2] || p.project_path;
      org = parts[parts.length - 2] || "";
    }

    return {
      ...p,
      org,
      repo,
      short_path: org ? `${org}/${repo}` : repo,
    };
  });

  return c.json(grouped);
});
