/** Claude AI sparkle icon — the distinctive Anthropic mark */
export function ClaudeIcon({ size = 18, color = "var(--claude-accent)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Anthropic/Claude sparkle — 4-pointed star with soft curves */}
      <path
        d="M12 2C12 2 14.5 8.5 12 12C9.5 8.5 12 2 12 2Z"
        fill={color}
        opacity="0.9"
      />
      <path
        d="M12 22C12 22 9.5 15.5 12 12C14.5 15.5 12 22 12 22Z"
        fill={color}
        opacity="0.9"
      />
      <path
        d="M2 12C2 12 8.5 9.5 12 12C8.5 14.5 2 12 2 12Z"
        fill={color}
        opacity="0.9"
      />
      <path
        d="M22 12C22 12 15.5 14.5 12 12C15.5 9.5 22 12 22 12Z"
        fill={color}
        opacity="0.9"
      />
      {/* Inner glow */}
      <circle cx="12" cy="12" r="2" fill={color} opacity="0.6" />
    </svg>
  );
}
