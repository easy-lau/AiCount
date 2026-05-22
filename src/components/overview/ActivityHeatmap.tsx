import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HeatmapData } from "@/types";

const CELL_SIZE = 11;
const CELL_GAP = 2;
const CELL_STEP = CELL_SIZE + CELL_GAP;
const WEEKS = 53;
const DAYS = 7;
const MONTH_LABEL_HEIGHT = 18;
const WEEKDAY_LABEL_WIDTH = 28;

const SVG_WIDTH = WEEKDAY_LABEL_WIDTH + WEEKS * CELL_STEP;
const SVG_HEIGHT = MONTH_LABEL_HEIGHT + DAYS * CELL_STEP;

const WEEKDAY_LABELS = ["一", "", "三", "", "五", "", ""];

const MONTH_NAMES = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

const LEGEND_TOKENS = [
  "var(--heatmap-l0)",
  "var(--heatmap-l1)",
  "var(--heatmap-l2)",
  "var(--heatmap-l3)",
  "var(--heatmap-l4)",
];

function locToColor(loc: number): string {
  if (loc === 0) return LEGEND_TOKENS[0]!;
  if (loc <= 100) return LEGEND_TOKENS[1]!;
  if (loc <= 500) return LEGEND_TOKENS[2]!;
  if (loc <= 2000) return LEGEND_TOKENS[3]!;
  return LEGEND_TOKENS[4]!;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface TooltipState {
  x: number;
  y: number;
  date: string;
  loc: number;
}

interface Props {
  data: HeatmapData;
}

export function ActivityHeatmap({ data }: Props) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const { grid, monthLabels } = useMemo(() => {
    const locMap = new Map<string, number>();
    for (const cell of data.cells) {
      locMap.set(cell.date, cell.loc);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startMs = data.fromMs;
    const startDate = new Date(startMs);
    // align to Sunday (start of week column)
    const dayOfWeek = startDate.getDay(); // 0=Sun
    const gridStart = addDays(startDate, -dayOfWeek);

    type Cell = { date: string; loc: number; inRange: boolean; col: number; row: number };
    const cells: Cell[] = [];

    const monthLabelMap = new Map<number, string>(); // col -> month name

    for (let col = 0; col < WEEKS; col++) {
      for (let row = 0; row < DAYS; row++) {
        const cellDate = addDays(gridStart, col * 7 + row);
        const dateStr = toDateString(cellDate);
        const inRange = cellDate >= startDate && cellDate <= today;
        const loc = inRange ? (locMap.get(dateStr) ?? 0) : 0;
        cells.push({ date: dateStr, loc, inRange, col, row });

        // record month label at first occurrence of each month in row=0
        if (row === 0 && inRange) {
          const monthKey = cellDate.getMonth();
          const existing = [...monthLabelMap.values()];
          const monthName = MONTH_NAMES[monthKey]!;
          if (!existing.includes(monthName)) {
            monthLabelMap.set(col, monthName);
          }
        }
      }
    }

    return { grid: cells, monthLabels: [...monthLabelMap.entries()] };
  }, [data]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">活跃度（过去 365 天）</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <svg
            width={SVG_WIDTH}
            height={SVG_HEIGHT}
            style={{ display: "block" }}
            onMouseLeave={() => setTooltip(null)}
          >
            {/* Month labels */}
            {monthLabels.map(([col, label]) => (
              <text
                key={`month-${col}`}
                x={WEEKDAY_LABEL_WIDTH + col * CELL_STEP}
                y={12}
                fontSize={10}
                fill="var(--heatmap-label)"
              >
                {label}
              </text>
            ))}

            {/* Weekday labels */}
            {WEEKDAY_LABELS.map((label, row) =>
              label ? (
                <text
                  key={`wd-${row}`}
                  x={0}
                  y={MONTH_LABEL_HEIGHT + row * CELL_STEP + CELL_SIZE - 1}
                  fontSize={9}
                  fill="var(--heatmap-label)"
                >
                  {label}
                </text>
              ) : null,
            )}

            {/* Cells */}
            {grid.map((cell) => {
              const x = WEEKDAY_LABEL_WIDTH + cell.col * CELL_STEP;
              const y = MONTH_LABEL_HEIGHT + cell.row * CELL_STEP;
              return (
                <rect
                  key={cell.date}
                  x={x}
                  y={y}
                  width={CELL_SIZE}
                  height={CELL_SIZE}
                  rx={2}
                  fill={cell.inRange ? locToColor(cell.loc) : "transparent"}
                  onMouseEnter={() => {
                    if (!cell.inRange) return;
                    setTooltip({
                      x: x + CELL_SIZE / 2,
                      y: y,
                      date: cell.date,
                      loc: cell.loc,
                    });
                  }}
                  style={{ cursor: cell.inRange ? "pointer" : "default" }}
                />
              );
            })}

            {/* Inline SVG tooltip — flips below the cell when near the top to avoid clipping */}
            {tooltip && (() => {
              const TOOLTIP_W = 110;
              const TOOLTIP_H = 22;
              const rectX = Math.max(
                0,
                Math.min(tooltip.x - TOOLTIP_W / 2, SVG_WIDTH - TOOLTIP_W),
              );
              const showBelow = tooltip.y < MONTH_LABEL_HEIGHT + TOOLTIP_H + 4;
              const rectY = showBelow
                ? tooltip.y + CELL_SIZE + 6
                : tooltip.y - TOOLTIP_H - 6;
              const textY = rectY + 15;
              return (
                <g pointerEvents="none">
                  <rect
                    x={rectX}
                    y={rectY}
                    width={TOOLTIP_W}
                    height={TOOLTIP_H}
                    rx={4}
                    fill="var(--heatmap-tooltip-bg)"
                    stroke="var(--heatmap-tooltip-border)"
                    strokeWidth={1}
                  />
                  <text
                    x={rectX + TOOLTIP_W / 2}
                    y={textY}
                    fontSize={10}
                    fill="var(--heatmap-tooltip-fg)"
                    textAnchor="middle"
                  >
                    {tooltip.date}: +{tooltip.loc.toLocaleString()} 行
                  </text>
                </g>
              );
            })()}
          </svg>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
          <span>较少</span>
          {LEGEND_TOKENS.map((token) => (
            <svg key={token} width={11} height={11}>
              <rect width={11} height={11} rx={2} fill={token} />
            </svg>
          ))}
          <span>较多</span>
        </div>
      </CardContent>
    </Card>
  );
}
