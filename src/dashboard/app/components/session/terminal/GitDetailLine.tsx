import type { GitDetail } from "../../../lib/types.js";

export function GitDetailLine({ gd }: { gd: GitDetail }) {
  const shortHash = gd.hash ? gd.hash.substring(0, 7) : null;
  let text = "";
  switch (gd.type) {
    case "commit":
      text = `Committed ${shortHash || ""} "${gd.description}"`;
      break;
    case "push":
      text = `Pushed${gd.push_branch ? ` to ${gd.push_branch}` : ""}${gd.push_range ? ` (${gd.push_range})` : ""}`;
      break;
    case "pr":
      text = `Created PR${gd.description ? ` — ${gd.description}` : ""}`;
      break;
    case "branch":
      text = gd.description || "Created branch";
      break;
    default:
      text = gd.description || gd.type;
  }

  const inner = (
    <div className="py-0.5">
      <span style={{ color: "var(--cc-dim)" }}>{"\u00A0\u00A0"}{"\u25CF"}{" "}</span>
      <span style={{ color: "var(--text-tertiary)" }}>{text}</span>
    </div>
  );

  if (gd.url) {
    return (
      <a href={gd.url} target="_blank" rel="noopener noreferrer"
        className="block -mx-1 px-1 rounded hover:bg-[var(--bg-hover)] transition-colors">
        {inner}
      </a>
    );
  }
  return inner;
}
