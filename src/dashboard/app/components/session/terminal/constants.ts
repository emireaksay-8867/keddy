/** File extension → Prism language mapping */
export const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  py: "python", rs: "rust", go: "go", rb: "ruby",
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
  css: "css", scss: "css", html: "markup", xml: "markup",
  md: "markdown", mdx: "markdown",
  sql: "sql", sh: "bash", bash: "bash", zsh: "bash",
  java: "java", kt: "kotlin", swift: "swift",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp",
  cs: "csharp", php: "php", r: "r",
  dockerfile: "docker", makefile: "makefile",
};

export function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return EXT_TO_LANG[ext] || "text";
}

/** Subtle background for tool names matching Claude Code's ToolUseLoader */
export function toolNameBg(name: string): string | undefined {
  switch (name) {
    case "Bash": return "rgba(253,93,177,0.12)";
    case "Edit": case "Write": return "rgba(78,186,101,0.12)";
    default: return undefined;
  }
}
