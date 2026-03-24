import { useState } from "react";

interface FileOp {
  file_path: string;
  short_name: string;
  reads: number;
  edits: number;
  writes: number;
}

interface TreeNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  children: TreeNode[];
  fileOp?: FileOp;
}

function buildTree(files: FileOp[], commonPrefix: string): TreeNode[] {
  const root: TreeNode = { name: "", fullPath: "", isDir: true, children: [] };

  for (const f of files) {
    const relative = commonPrefix ? f.file_path.slice(commonPrefix.length + 1) : f.file_path;
    const parts = relative.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (isLast) {
        current.children.push({
          name: part,
          fullPath: f.file_path,
          isDir: false,
          children: [],
          fileOp: f,
        });
      } else {
        let child = current.children.find(c => c.isDir && c.name === part);
        if (!child) {
          child = { name: part, fullPath: "", isDir: true, children: [] };
          current.children.push(child);
        }
        current = child;
      }
    }
  }

  // Sort: directories first, then alphabetical
  function sortTree(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.isDir) sortTree(n.children);
    }
  }
  sortTree(root.children);

  // Collapse single-child directories
  function collapse(nodes: TreeNode[]): TreeNode[] {
    return nodes.map(n => {
      if (n.isDir) {
        n.children = collapse(n.children);
        // If dir has exactly one child that is also a dir, merge them
        if (n.children.length === 1 && n.children[0].isDir) {
          const child = n.children[0];
          return { ...child, name: `${n.name}/${child.name}` };
        }
      }
      return n;
    });
  }

  return collapse(root.children);
}

function findCommonPrefix(files: FileOp[]): string {
  if (files.length === 0) return "";
  const paths = files.map(f => f.file_path);
  const parts0 = paths[0].split("/");
  let commonLen = 0;
  outer: for (let i = 0; i < parts0.length - 1; i++) {
    for (const p of paths) {
      if (p.split("/")[i] !== parts0[i]) break outer;
    }
    commonLen = i + 1;
  }
  return parts0.slice(0, commonLen).join("/");
}

function TreeNodeRow({ node, depth, onViewFile }: { node: TreeNode; depth: number; onViewFile: (path: string) => void }) {
  const [open, setOpen] = useState(depth < 3);
  const pl = depth * 16;

  if (node.isDir) {
    return (
      <>
        <div
          className="flex items-center gap-1.5 py-0.5 px-2 rounded cursor-pointer hover:bg-[var(--bg-hover)] text-[12px]"
          style={{ paddingLeft: pl + 8, color: "var(--text-muted)" }}
          onClick={() => setOpen(!open)}
        >
          <span className="text-[10px]">{open ? "\u25BC" : "\u25B6"}</span>
          <span>{node.name}/</span>
        </div>
        {open && node.children.map((child, i) => (
          <TreeNodeRow key={`${child.name}-${i}`} node={child} depth={depth + 1} onViewFile={onViewFile} />
        ))}
      </>
    );
  }

  const f = node.fileOp!;
  const hasEdits = f.edits > 0 || f.writes > 0;

  return (
    <div
      className="flex items-center gap-3 py-0.5 px-2 rounded hover:bg-[var(--bg-hover)] text-[12px]"
      style={{ paddingLeft: pl + 8 }}
    >
      <span className="min-w-0 truncate font-medium" style={{ color: "var(--text-secondary)" }}>
        {node.name}
      </span>
      <span className="flex items-center gap-2 shrink-0 ml-auto" style={{ color: "var(--text-muted)" }}>
        {hasEdits && (
          <span>{f.writes > 0 && f.edits === 0 ? "\u2728" : "\u270F\uFE0F"} {f.edits + f.writes}</span>
        )}
        {f.reads > 0 && <span>{"\uD83D\uDC41"} {f.reads}</span>}
        {hasEdits && (
          <button
            className="text-[11px] px-1.5 py-0.5 hover:underline"
            style={{ color: "var(--text-muted)" }}
            onClick={() => onViewFile(f.file_path)}
          >diffs</button>
        )}
        <a
          href={`vscode://file${f.file_path}`}
          className="text-[11px] px-1 hover:underline"
          style={{ color: "var(--text-muted)" }}
          title="Open in VS Code"
          onClick={e => e.stopPropagation()}
        >{"\u2197"}</a>
      </span>
    </div>
  );
}

interface FileTreeProps {
  fileOps: FileOp[];
  onViewFile: (filePath: string) => void;
}

export function FileTree({ fileOps, onViewFile }: FileTreeProps) {
  const prefix = findCommonPrefix(fileOps);
  const tree = buildTree(fileOps, prefix);

  return (
    <div className="flex flex-col gap-0.5">
      {prefix && (
        <div className="text-[10px] mb-1 font-mono" style={{ color: "var(--text-muted)" }}>{prefix}/</div>
      )}
      {tree.map((node, i) => (
        <TreeNodeRow key={`${node.name}-${i}`} node={node} depth={0} onViewFile={onViewFile} />
      ))}
    </div>
  );
}
