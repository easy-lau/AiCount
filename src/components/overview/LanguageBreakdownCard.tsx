import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LanguageBreakdown } from "@/types";
import { ChartTooltip } from "@/components/overview/ChartTooltip";

const LANG_COLORS = [
  "#10b981", // emerald
  "#06b6d4", // cyan
  "#8b5cf6", // violet
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#14b8a6", // teal
  "#f97316", // orange
  "#6366f1", // indigo
];

const OTHER_COLOR = "#6b7280"; // gray-500

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

interface Props {
  data: LanguageBreakdown[];
}

export function LanguageBreakdownCard({ data }: Props) {
  const { pieData, tableRows } = useMemo(() => {
    if (data.length === 0) return { pieData: [], tableRows: [] };

    const sorted = [...data].sort((a, b) => b.loc - a.loc);
    const top8 = sorted.slice(0, 8);
    const rest = sorted.slice(8);

    const pie = top8.map((lang, i) => ({
      name: lang.language,
      value: lang.loc,
      color: LANG_COLORS[i % LANG_COLORS.length]!,
    }));

    if (rest.length > 0) {
      const otherLoc = rest.reduce((sum, l) => sum + l.loc, 0);
      pie.push({
        name: `其他（${rest.length}）`,
        value: otherLoc,
        color: OTHER_COLOR,
      });
    }

    const table = sorted.slice(0, 10);
    return { pieData: pie, tableRows: table };
  }, [data]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">语言分布</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            暂无语言数据
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start min-w-0">
            <div className="relative h-64 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`lang-cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} cursor={false} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-full">
              <div className="grid grid-cols-[1fr_5rem_4rem_3.5rem] gap-x-3 text-xs text-muted-foreground pb-2 border-b">
                <span>语言</span>
                <span className="text-right">代码行数</span>
                <span className="text-right">文件数</span>
                <span className="text-center">占比</span>
              </div>
              <ul className="divide-y">
                {tableRows.map((row, i) => {
                  const color = LANG_COLORS[i % LANG_COLORS.length] ?? OTHER_COLOR;
                  return (
                    <li key={row.extension} className="py-1.5 text-sm">
                      <div className="grid grid-cols-[1fr_5rem_4rem_3.5rem] gap-x-3 items-center">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="size-2.5 rounded-full shrink-0"
                            style={{ background: color }}
                          />
                          <span className="truncate" title={row.language}>
                            {row.language}
                          </span>
                        </div>
                        <span className="tabular-nums text-right">
                          {formatNumber(row.loc)}
                        </span>
                        <span className="tabular-nums text-right text-muted-foreground">
                          {row.fileCount}
                        </span>
                        <span className="tabular-nums text-center text-muted-foreground">
                          {row.percent.toFixed(1)}%
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
