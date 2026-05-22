import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  Area,
  CartesianGrid,
  Cell,
  ComposedChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import {
  Code2,
  FileText,
  Home,
  Layers,
  PieChart as PieChartIcon,
  RefreshCw,
} from "lucide-react";
import type {
  HeatmapData,
  ModelBreakdown,
  Overview,
  OverviewQuery,
  ProjectInfo,
  UsageRangeSelection,
} from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatsPage } from "@/components/stats/StatsPage";
import { ProjectPicker } from "@/components/common/ProjectPicker";
import { UsageDateRangePicker } from "@/components/overview/UsageDateRangePicker";
import { LanguageBreakdownCard } from "@/components/overview/LanguageBreakdownCard";
import { ActivityHeatmap } from "@/components/overview/ActivityHeatmap";
import { ExportButton } from "@/components/overview/ExportButton";
import { ChartTooltip } from "@/components/overview/ChartTooltip";
import { formatRangeTrigger, resolveUsageRange } from "@/lib/usageRange";
import { cn } from "@/lib/utils";
import { ALL_PROJECTS } from "@/lib/constants";

const MODEL_COLORS = ["#3b82f6", "#10b981", "#a855f7", "#f59e0b", "#9ca3af"];

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "未知错误";
}

interface WeeklyBucket {
  date: string;
  loc: number;
  files: number;
}

function aggregateWeekly(
  daily: { date: string; loc: number; files: number }[],
): WeeklyBucket[] {
  const out: WeeklyBucket[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    const chunk = daily.slice(i, i + 7);
    if (chunk.length === 0) continue;
    const loc = chunk.reduce((acc, b) => acc + b.loc, 0);
    const files = chunk.reduce((acc, b) => acc + b.files, 0);
    out.push({ date: chunk[0]!.date, loc, files });
  }
  return out;
}

interface OverviewPageProps {
  selectedProject?: string;
  onSelectedProjectChange?: (value: string) => void;
}

export function OverviewPage({
  selectedProject: externalSelected,
  onSelectedProjectChange,
}: OverviewPageProps = {}) {
  const [selection, setSelection] = useState<UsageRangeSelection>({
    preset: "today",
  });
  const { fromMs, toMs } = useMemo(() => {
    const r = resolveUsageRange(selection);
    return { fromMs: r.startDate * 1000, toMs: r.endDate * 1000 };
  }, [selection]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [internalSelected, setInternalSelected] =
    useState<string>(ALL_PROJECTS);
  const selectedProject = externalSelected ?? internalSelected;
  const setSelectedProject = (value: string) => {
    if (onSelectedProjectChange) onSelectedProjectChange(value);
    else setInternalSelected(value);
  };
  const [overview, setOverview] = useState<Overview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<"day" | "week">("day");
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<ProjectInfo[]>("list_projects")
      .then((result) => {
        if (!cancelled) setProjects(result);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadOverview = useCallback(() => {
    setIsLoading(true);
    setError(null);
    const query: { project?: string; fromMs: number; toMs: number } = {
      fromMs,
      toMs,
    };
    if (selectedProject !== ALL_PROJECTS) query.project = selectedProject;
    invoke<Overview>("compute_overview", { query })
      .then((result) => {
        setOverview(result);
      })
      .catch((err) => {
        setError(extractErrorMessage(err));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [selectedProject, fromMs, toMs]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const loadHeatmap = useCallback(() => {
    const project =
      selectedProject !== ALL_PROJECTS ? selectedProject : undefined;
    invoke<HeatmapData>("compute_heatmap", { project })
      .then((result) => {
        setHeatmapData(result);
      })
      .catch(() => {
        // ignore heatmap errors silently
      });
  }, [selectedProject]);

  useEffect(() => {
    loadHeatmap();
  }, [loadHeatmap]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    listen("session-changed", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        loadOverview();
        loadHeatmap();
      }, 200);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (timer) clearTimeout(timer);
      unlisten?.();
    };
  }, [loadOverview, loadHeatmap]);

  const trendData = useMemo(() => {
    if (!overview) return [];
    const series =
      granularity === "week"
        ? aggregateWeekly(overview.daily)
        : overview.daily;
    return series.map((bucket) => ({
      ...bucket,
      label: format(parseISO(bucket.date), "MM-dd"),
    }));
  }, [overview, granularity]);

  const pieData = useMemo(() => {
    if (!overview) return [];
    return overview.byModel.map((m, i) => ({
      name: m.model,
      value: m.loc,
      color: MODEL_COLORS[i % MODEL_COLORS.length],
    }));
  }, [overview]);

  const overviewQuery: OverviewQuery = useMemo(() => {
    const q: OverviewQuery = { fromMs, toMs };
    if (selectedProject !== ALL_PROJECTS) q.project = selectedProject;
    return q;
  }, [selectedProject, fromMs, toMs]);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Home className="size-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">概况</h1>
            {isLoading && (
              <RefreshCw className="size-4 animate-spin text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <UsageDateRangePicker
              selection={selection}
              onApply={setSelection}
              triggerLabel={formatRangeTrigger(selection)}
            />
            <ProjectPicker
              projects={projects}
              selected={selectedProject}
              onSelect={setSelectedProject}
            />
            <ExportButton query={overviewQuery} />
          </div>
        </header>

        {error && !overview && (
          <div className="rounded-md bg-destructive/10 text-destructive px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard
            label="总代码数"
            value={overview?.totalProjectLoc ?? 0}
            icon={<Layers className="size-5 text-purple-600" />}
            iconBg="bg-purple-50 dark:bg-purple-950/40"
          />
          <MetricCard
            label="生成代码行数"
            value={overview?.totalLoc ?? 0}
            icon={<Code2 className="size-5 text-blue-600" />}
            iconBg="bg-blue-50 dark:bg-blue-950/40"
          />
          <MetricCard
            label="AI 生成代码占比"
            value={overview?.aiRatioPercent ?? 0}
            icon={<PieChartIcon className="size-5 text-orange-600" />}
            iconBg="bg-orange-50 dark:bg-orange-950/40"
            valueFormatter={(n) => `${n.toFixed(2)}%`}
          />
          <MetricCard
            label="生成文件数量"
            value={overview?.totalFiles ?? 0}
            icon={<FileText className="size-5 text-emerald-600" />}
            iconBg="bg-emerald-50 dark:bg-emerald-950/40"
          />
        </div>

        {heatmapData && <ActivityHeatmap data={heatmapData} />}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base font-medium">生成趋势</CardTitle>
            <div className="inline-flex rounded-md border border-input overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setGranularity("day")}
                className={cn(
                  "px-3 py-1 transition-colors",
                  granularity === "day"
                    ? "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
                    : "bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                按天
              </button>
              <button
                type="button"
                onClick={() => setGranularity("week")}
                className={cn(
                  "px-3 py-1 transition-colors border-l border-input",
                  granularity === "week"
                    ? "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
                    : "bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                按周
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={trendData}
                  margin={{ top: 12, right: 16, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="locGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient
                      id="filesGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(148, 163, 184, 0.08)" }} />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="loc"
                    name="代码行数"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fill="url(#locGradient)"
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="files"
                    name="文件数"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#filesGradient)"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">
              模型分布（按生成代码行数）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center min-w-0">
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
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(148, 163, 184, 0.08)" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="text-xs text-muted-foreground">总行数</div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {formatNumber(overview?.totalLoc ?? 0)}
                  </div>
                </div>
              </div>
              <ModelBreakdownTable
                rows={overview?.byModel ?? []}
                colors={MODEL_COLORS}
              />
            </div>
          </CardContent>
        </Card>

        <LanguageBreakdownCard data={overview?.byLanguage ?? []} />

        <StatsPage externalProject={selectedProject} />
      </div>
    </ScrollArea>
  );
}

interface MetricCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  iconBg: string;
  valueFormatter?: (n: number) => string;
}

function MetricCard({
  label,
  value,
  icon,
  iconBg,
  valueFormatter,
}: MetricCardProps) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <div
            className={cn(
              "size-8 rounded-md flex items-center justify-center shrink-0",
              iconBg,
            )}
          >
            {icon}
          </div>
          <span className="text-sm text-muted-foreground truncate">
            {label}
          </span>
        </div>
        <div className="text-3xl font-semibold tabular-nums truncate">
          {valueFormatter ? valueFormatter(value) : formatNumber(value)}
        </div>
      </CardContent>
    </Card>
  );
}

interface ModelBreakdownTableProps {
  rows: ModelBreakdown[];
  colors: string[];
}

function ModelBreakdownTable({ rows, colors }: ModelBreakdownTableProps) {
  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        暂无模型数据
      </div>
    );
  }
  return (
    <div className="w-full">
      <div className="grid grid-cols-[1fr_6rem_3.5rem] gap-x-4 text-xs text-muted-foreground pb-2 border-b">
        <span>模型</span>
        <span className="text-right">代码行数</span>
        <span className="text-center">占比</span>
      </div>
      <ul className="divide-y">
        {rows.map((row, i) => {
          const color = colors[i % colors.length];
          return (
            <li key={row.model} className="py-2 text-sm">
              <div className="grid grid-cols-[1fr_6rem_3.5rem] gap-x-4 items-center">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="size-2.5 rounded-full shrink-0"
                    style={{ background: color }}
                  />
                  <span className="truncate" title={row.model}>
                    {row.model}
                  </span>
                </div>
                <span className="tabular-nums text-right">
                  {formatNumber(row.loc)}
                </span>
                <span className="tabular-nums text-center text-muted-foreground">
                  {row.percent.toFixed(1)}%
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, Math.max(0, row.percent))}%`,
                    background: color,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
