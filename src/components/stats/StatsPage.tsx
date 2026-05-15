import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, BarChart3, FolderOpen, FileCode } from "lucide-react";
import type { CodeStats, LocDelta, ProjectInfo } from "@/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { StatBar } from "./StatBar";
import { basename, formatNet, formatNumber, netDelta } from "./utils";

const ALL_PROJECTS = "__all__";

const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

function providerLabel(id: string): string {
  return PROVIDER_LABEL[id] ?? id;
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "未知错误";
}

interface SortedEntry {
  key: string;
  delta: LocDelta;
}

function sortByTotal(entries: Record<string, LocDelta>): SortedEntry[] {
  return Object.entries(entries)
    .map(([key, delta]) => ({ key, delta }))
    .sort((a, b) => b.delta.added + b.delta.removed - (a.delta.added + a.delta.removed));
}

interface StatsPageProps {
  /** When provided, use this project filter and hide the internal dropdown/header. */
  externalProject?: string;
}

export function StatsPage({ externalProject }: StatsPageProps = {}) {
  const embedded = externalProject !== undefined;
  const [stats, setStats] = useState<CodeStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [internalProject, setInternalProject] = useState<string>(ALL_PROJECTS);

  const selectedProject = embedded
    ? externalProject || ALL_PROJECTS
    : internalProject;

  useEffect(() => {
    if (embedded) return;
    let cancelled = false;
    invoke<ProjectInfo[]>("list_projects")
      .then((result) => {
        if (!cancelled) setProjects(result);
      })
      .catch(() => {
        // 项目列表加载失败不阻断主流程
      });
    return () => {
      cancelled = true;
    };
  }, [embedded]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    const args =
      selectedProject === ALL_PROJECTS ? {} : { project: selectedProject };
    invoke<CodeStats>("compute_code_stats", args)
      .then((result) => {
        if (!cancelled) setStats(result);
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProject]);

  const providerEntries = useMemo(
    () => (stats ? sortByTotal(stats.byProvider) : []),
    [stats],
  );

  const projectEntries = useMemo(
    () => (stats ? sortByTotal(stats.byProject).slice(0, 5) : []),
    [stats],
  );

  const providerMax = useMemo(
    () =>
      providerEntries.reduce(
        (acc, entry) =>
          Math.max(acc, entry.delta.added, entry.delta.removed),
        0,
      ),
    [providerEntries],
  );

  const projectMax = useMemo(
    () =>
      projectEntries.reduce(
        (acc, entry) =>
          Math.max(acc, entry.delta.added, entry.delta.removed),
        0,
      ),
    [projectEntries],
  );

  if (isLoading && !stats) {
    return (
      <div
        className={
          embedded
            ? "flex items-center gap-2 p-6 text-sm text-muted-foreground"
            : "flex items-center justify-center h-full w-full p-12 text-muted-foreground"
        }
      >
        <RefreshCw className="size-4 animate-spin mr-2" />
        <span className="text-sm">正在统计…</span>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="p-6">
        <div className="rounded-md bg-destructive/10 text-destructive px-3 py-2 text-sm">
          {error}
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-6 text-sm text-muted-foreground">暂无数据</div>
    );
  }

  const topFiles = stats.topFiles.slice(0, 10);

  const body = (
    <div
      className={
        embedded
          ? "space-y-6"
          : "mx-auto max-w-5xl px-6 py-6 space-y-6"
      }
    >
      {!embedded && (
        <header className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <BarChart3 className="size-5 text-muted-foreground shrink-0" />
              <h1 className="text-xl font-semibold">代码统计</h1>
              <Badge variant="secondary" className="text-xs">
                {formatNumber(stats.sessionCount)} 会话
              </Badge>
              {isLoading && (
                <RefreshCw className="size-3 animate-spin text-muted-foreground" />
              )}
            </div>
            <select
              className="h-9 max-w-[280px] truncate rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={selectedProject}
              onChange={(e) => setInternalProject(e.target.value)}
              title={
                selectedProject === ALL_PROJECTS
                  ? "全部项目"
                  : selectedProject
              }
            >
              <option value={ALL_PROJECTS}>
                全部项目（{projects.length}）
              </option>
              {projects.map((p) => (
                <option key={p.path} value={p.path} title={p.path}>
                  {basename(p.path) || p.path} · {p.sessionCount}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            Showing Claude + Codex. Gemini sessions don't log code edits.
          </p>
        </header>
      )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">总览</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SummaryTile label="累计净增" delta={stats.total} highlight />
            <SummaryTile label="近 7 天" delta={stats.thisWeek} />
            <SummaryTile label="近 30 天" delta={stats.thisMonth} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">按提供商</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {providerEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无数据</p>
            ) : (
              providerEntries.map((entry) => (
                <StatBar
                  key={entry.key}
                  label={providerLabel(entry.key)}
                  delta={entry.delta}
                  max={providerMax}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FolderOpen className="size-4 text-muted-foreground" />
              Top 5 项目
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {projectEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground">暂无项目数据</p>
            ) : (
              projectEntries.map((entry) => (
                <StatBar
                  key={entry.key}
                  label={basename(entry.key) || entry.key}
                  delta={entry.delta}
                  max={projectMax}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileCode className="size-4 text-muted-foreground" />
              Top 10 文件
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {topFiles.length === 0 ? (
              <p className="text-xs text-muted-foreground p-6">暂无文件数据</p>
            ) : (
              <ul className="divide-y">
                {topFiles.map((file) => (
                  <li
                    key={`${file.provider}::${file.path}`}
                    className="flex items-center justify-between gap-3 px-6 py-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs">
                        {file.path}
                      </div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        {providerLabel(file.provider)}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      +{formatNumber(file.delta.added)} / -
                      {formatNumber(file.delta.removed)}
                      <span className="ml-2 text-foreground">
                        {formatNet(file.delta)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
    </div>
  );

  if (embedded) {
    return body;
  }
  return <ScrollArea className="h-full">{body}</ScrollArea>;
}

interface SummaryTileProps {
  label: string;
  delta: LocDelta;
  highlight?: boolean;
}

function SummaryTile({ label, delta, highlight }: SummaryTileProps) {
  const net = netDelta(delta);
  return (
    <div className="rounded-md border bg-muted/30 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={
          "mt-1 text-2xl font-semibold tabular-nums " +
          (highlight
            ? net >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400"
            : "text-foreground")
        }
      >
        {formatNet(delta)}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
        +{formatNumber(delta.added)} / -{formatNumber(delta.removed)}
      </div>
    </div>
  );
}
