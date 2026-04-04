import { Highlight, themes } from "prism-react-renderer";

export function SyntaxBlock({
  code,
  language = "text",
  maxHeight = 400,
}: {
  code: string;
  language?: string;
  maxHeight?: number;
}) {
  return (
    <Highlight theme={themes.vsDark} code={code} language={language}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre
          className="text-[11px] overflow-auto rounded py-1.5 px-3 m-0"
          style={{ background: "var(--bg-elevated)", maxHeight }}
        >
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })} style={{ display: "flex" }}>
              <span
                className="select-none text-right shrink-0 pr-3"
                style={{ color: "var(--text-muted)", width: "3ch" }}
              >
                {i + 1}
              </span>
              <span>
                {line.map((token, j) => (
                  <span key={j} {...getTokenProps({ token })} />
                ))}
              </span>
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}
