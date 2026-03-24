interface TokenSparklineProps {
  data: Array<{ input: number; output: number }>;
  width?: number;
  height?: number;
}

export function TokenSparkline({ data, width = 200, height = 32 }: TokenSparklineProps) {
  if (data.length === 0) return null;

  const maxValue = data.reduce((max, d) => Math.max(max, d.input + d.output), 1);
  const barWidth = width / data.length;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {data.map((d, i) => {
        const inputHeight = (d.input / maxValue) * height;
        const outputHeight = (d.output / maxValue) * height;
        const x = i * barWidth;

        return (
          <g key={i}>
            {/* Input bar (bottom) */}
            {d.input > 0 && (
              <rect
                x={x}
                y={height - inputHeight}
                width={Math.max(barWidth - 0.5, 0.5)}
                height={inputHeight}
                fill="#60a5fa"
                rx={0.5}
              />
            )}
            {/* Output bar (stacked on top) */}
            {d.output > 0 && (
              <rect
                x={x}
                y={height - inputHeight - outputHeight}
                width={Math.max(barWidth - 0.5, 0.5)}
                height={outputHeight}
                fill="#a78bfa"
                rx={0.5}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
