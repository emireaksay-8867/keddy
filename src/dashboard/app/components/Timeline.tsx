import type { Segment, Milestone, CompactionEvent } from "../lib/types.js";
import { SegmentCard } from "./SegmentCard.js";
import { MILESTONE_ICONS } from "../lib/constants.js";

interface TimelineProps {
  segments: Segment[];
  milestones: Milestone[];
  compactionEvents: CompactionEvent[];
}

export function Timeline({ segments, milestones, compactionEvents }: TimelineProps) {
  // Interleave segments and milestones by exchange index
  const items: Array<
    | { type: "segment"; data: Segment; index: number }
    | { type: "milestone"; data: Milestone; index: number }
    | { type: "compaction"; data: CompactionEvent; index: number }
  > = [];

  for (const seg of segments) {
    items.push({ type: "segment", data: seg, index: seg.exchange_index_start });
  }
  for (const ms of milestones) {
    items.push({ type: "milestone", data: ms, index: ms.exchange_index });
  }
  for (const ce of compactionEvents) {
    items.push({ type: "compaction", data: ce, index: ce.exchange_index });
  }

  items.sort((a, b) => a.index - b.index);

  return (
    <div className="space-y-1">
      {items.map((item, i) => {
        if (item.type === "segment") {
          return <SegmentCard key={`seg-${i}`} segment={item.data} />;
        }
        if (item.type === "milestone") {
          const ms = item.data;
          return (
            <div key={`ms-${i}`} className="flex gap-3 items-center py-2">
              <div className="w-3 flex justify-center">
                <span className="text-sm">{MILESTONE_ICONS[ms.milestone_type] || "·"}</span>
              </div>
              <div className="flex-1 flex items-center gap-2">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--color-surface-hover)]">
                  {ms.milestone_type}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">{ms.description}</span>
              </div>
            </div>
          );
        }
        // compaction
        const ce = item.data;
        return (
          <div key={`ce-${i}`} className="flex gap-3 items-center py-2">
            <div className="w-3 flex justify-center">
              <span className="text-xs text-[#F59E0B]">≡</span>
            </div>
            <span className="text-xs text-[#F59E0B]">
              Context compacted ({ce.exchanges_before} → {ce.exchanges_after} exchanges)
            </span>
          </div>
        );
      })}
    </div>
  );
}
