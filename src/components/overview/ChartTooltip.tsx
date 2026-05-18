interface TooltipEntry {
  name?: string | number;
  value?: string | number;
  color?: string;
  dataKey?: string | number;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}

function formatValue(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "");
  return new Intl.NumberFormat("zh-CN").format(Math.trunc(n));
}

export function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-popover text-popover-foreground shadow-md text-xs px-3 py-2 min-w-[9rem] backdrop-blur-sm">
      {label !== undefined && label !== "" && (
        <div className="font-medium mb-1.5 text-foreground">{String(label)}</div>
      )}
      <ul className="space-y-1">
        {payload.map((entry, i) => (
          <li
            key={`${entry.dataKey ?? entry.name ?? i}`}
            className="flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {entry.color && (
                <span
                  className="size-2 rounded-full shrink-0"
                  style={{ background: entry.color }}
                />
              )}
              <span className="text-muted-foreground truncate">
                {String(entry.name ?? "")}
              </span>
            </div>
            <span className="tabular-nums font-medium text-foreground">
              {formatValue(entry.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
