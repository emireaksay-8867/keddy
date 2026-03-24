interface FileOp {
  file_path: string;
  short_name: string;
  reads: number;
  edits: number;
  writes: number;
}

interface FilesSectionProps {
  fileOps: FileOp[];
  onViewFile: (filePath: string) => void;
}

/** Group files by directory, stripping longest common prefix */
function groupByDirectory(files: FileOp[]): Array<{ dir: string; files: FileOp[] }> {
  if (files.length === 0) return [];

  // Find common prefix
  const paths = files.map(f => f.file_path);
  const parts0 = paths[0].split("/");
  let commonLen = 0;
  outer: for (let i = 0; i < parts0.length - 1; i++) {
    for (const p of paths) {
      if (p.split("/")[i] !== parts0[i]) break outer;
    }
    commonLen = i + 1;
  }
  const prefix = parts0.slice(0, commonLen).join("/");

  // Group
  const groups = new Map<string, FileOp[]>();
  for (const f of files) {
    const relative = prefix ? f.file_path.slice(prefix.length + 1) : f.file_path;
    const dirParts = relative.split("/");
    const dir = dirParts.length > 1 ? dirParts.slice(0, -1).join("/") + "/" : "";
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir)!.push(f);
  }

  return Array.from(groups.entries()).map(([dir, files]) => ({ dir, files }));
}

export function FilesSection({ fileOps, onViewFile }: FilesSectionProps) {
  if (fileOps.length === 0) return null;

  const grouped = groupByDirectory(fileOps);

  return (
    <div className="mb-6">
      <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>Files</div>

      <div className="flex flex-col gap-0.5">
        {grouped.map(({ dir, files }) => (
          <div key={dir}>
            {dir && (
              <div className="text-[11px] mt-2 mb-0.5" style={{ color: "var(--text-muted)" }}>{dir}</div>
            )}
            {files.map(f => {
              const name = f.file_path.split("/").pop() || f.file_path;
              return (
                <div key={f.file_path} className="flex items-center gap-3 text-[12px] py-0.5 px-2 rounded hover:bg-[var(--bg-hover)]">
                  <span className="min-w-0 truncate" style={{ color: "var(--text-secondary)" }}>{name}</span>
                  <span className="flex items-center gap-2 shrink-0 ml-auto" style={{ color: "var(--text-muted)" }}>
                    {(f.edits > 0 || f.writes > 0) && (
                      <span>{f.writes > 0 && f.edits === 0 ? "\u2728" : "\u270F\uFE0F"} {f.edits + f.writes}</span>
                    )}
                    {f.reads > 0 && (
                      <span>{"\uD83D\uDC41"} {f.reads}</span>
                    )}
                    {(f.edits > 0 || f.writes > 0) && (
                      <button
                        className="text-[11px] px-1.5 py-0.5 hover:underline"
                        style={{ color: "var(--text-muted)" }}
                        onClick={() => onViewFile(f.file_path)}
                      >diffs</button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
