import type { LocDelta } from "@/types";
import { formatNumber } from "./utils";

interface StatBarProps {
  label: string;
  delta: LocDelta;
  max: number;
}

export function StatBar({ label, delta, max }: StatBarProps) {
  const total = delta.added + delta.removed;
  const safeMax = max > 0 ? max : 1;
  const addedPct = Math.min(100, (delta.added / safeMax) * 100);
  const removedPct = Math.min(100, (delta.removed / safeMax) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          +{formatNumber(delta.added)} / -{formatNumber(delta.removed)}
          <span className="ml-2 text-foreground/70">
            ({formatNumber(total)})
          </span>
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
        <div
          className="h-full bg-emerald-500/80"
          style={{ width: `${addedPct}%` }}
          aria-label={`added ${delta.added}`}
        />
        <div
          className="h-full bg-rose-500/80"
          style={{ width: `${removedPct}%` }}
          aria-label={`removed ${delta.removed}`}
        />
      </div>
    </div>
  );
}
