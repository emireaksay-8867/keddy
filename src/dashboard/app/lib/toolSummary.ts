/**
 * Generates a human-readable one-line summary for a tool call.
 * Knows each tool's important fields instead of showing raw JSON.
 */
export function toolSummary(toolName: string, input: string): string {
  try {
    const o = JSON.parse(input);

    switch (toolName) {
      // File tools — show path + what happened
      case "Read":
        return o.file_path || input.substring(0, 60);
      case "Write":
        return o.file_path ? `${o.file_path} (new file)` : input.substring(0, 60);
      case "Edit":
        if (o.file_path && o.old_string) {
          const preview = o.old_string.trim().substring(0, 30).replace(/\n/g, " ");
          return `${o.file_path} → "${preview}"`;
        }
        return o.file_path || input.substring(0, 60);

      // Shell — show the command
      case "Bash":
        return o.command?.substring(0, 80) || input.substring(0, 60);

      // Search tools — show what was searched and where
      case "Grep":
        return o.glob ? `${o.pattern} in ${o.glob}` : o.pattern || input.substring(0, 60);
      case "Glob":
        return o.pattern || input.substring(0, 60);

      // Agent — show the human-readable description
      case "Agent":
        return o.description || o.prompt?.substring(0, 60) || input.substring(0, 60);

      // Task tools — show the task subject
      case "TaskCreate":
        return o.subject || o.description?.substring(0, 60) || input.substring(0, 60);
      case "TaskUpdate":
        return o.status ? `#${o.task_id || "?"} → ${o.status}` : input.substring(0, 60);

      // Web tools
      case "WebSearch":
        return o.query || input.substring(0, 60);
      case "WebFetch":
        return o.url?.substring(0, 80) || input.substring(0, 60);

      // Notebook
      case "NotebookEdit":
        return o.file_path || input.substring(0, 60);

      // Default — try common fields, then fall back to raw
      default:
        return o.file_path || o.command || o.pattern || o.query || o.description || input.substring(0, 60);
    }
  } catch {
    return input.substring(0, 60);
  }
}
