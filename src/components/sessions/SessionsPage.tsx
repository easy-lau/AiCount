import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { History, RefreshCw } from "lucide-react";
import type {
  ListSessionsQuery,
  ProjectInfo,
  SessionSummary,
  UsageRangeSelection,
} from "@/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ProjectPicker } from "@/components/common/ProjectPicker";
import { UsageDateRangePicker } from "@/components/overview/UsageDateRangePicker";
import { formatRangeTrigger, resolveUsageRange } from "@/lib/usageRange";
import { ALL_PROJECTS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { SessionRow } from "./SessionRow";
import { SessionDetailDrawer } from "./SessionDetailDrawer";

type ProviderFilter = "all" | "claude" | "codex";

const PAGE_SIZE = 200;

const PROVIDER_TABS: { value: ProviderFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
];

export function SessionsPage() {
  const [provider, setProvider] = useState<ProviderFilter>("all");
  const [selectedProject, setSelectedProject] = useState<string>(ALL_PROJECTS);
  const [selection, setSelection] = useState<UsageRangeSelection>({
    preset: "30d",
  });
  const { fromMs, toMs } = useMemo(() => {
    const r = resolveUsageRange(selection);
    return { fromMs: r.startDate * 1000, toMs: r.endDate * 1000 };
  }, [selection]);

  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<ProjectInfo[]>("list_projects")
      .then((r) => {
        if (!cancelled) setProjects(r);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSessions = useCallback(
    (offset: number, append: boolean) => {
      setIsLoading(true);
      setError(null);
      const query: ListSessionsQuery = {
        limit: PAGE_SIZE,
        offset,
        fromMs,
        toMs,
      };
      if (provider !== "all") query.provider = provider;
      if (selectedProject !== ALL_PROJECTS) query.project = selectedProject;
      invoke<SessionSummary[]>("list_sessions", { query })
        .then((rows) => {
          setSessions((prev) => (append ? [...prev, ...rows] : rows));
          setHasMore(rows.length === PAGE_SIZE);
        })
        .catch((err) => {
          setError(typeof err === "string" ? err : String(err));
          if (!append) setSessions([]);
        })
        .finally(() => setIsLoading(false));
    },
    [provider, selectedProject, fromMs, toMs],
  );

  useEffect(() => {
    loadSessions(0, false);
  }, [loadSessions]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    listen("session-changed", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => loadSessions(0, false), 200);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (timer) clearTimeout(timer);
      unlisten?.();
    };
  }, [loadSessions]);

  const loadMore = () => loadSessions(sessions.length, true);

  return (
    <>
      <ScrollArea className="h-full">
        <div className="mx-auto max-w-7xl px-6 py-6 space-y-4">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <History className="size-5 text-muted-foreground" />
              <h1 className="text-2xl font-semibold">会话</h1>
              <span className="text-sm text-muted-foreground tabular-nums">
                （{sessions.length}
                {hasMore ? "+" : ""}）
              </span>
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
              <div className="inline-flex rounded-md border border-input overflow-hidden text-xs">
                {PROVIDER_TABS.map((tab, i) => (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setProvider(tab.value)}
                    className={cn(
                      "px-3 py-1.5 transition-colors",
                      i > 0 && "border-l border-input",
                      provider === tab.value
                        ? "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
                        : "bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </header>

          {error && (
            <div className="rounded-md bg-destructive/10 text-destructive px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {sessions.length === 0 && !isLoading ? (
            <div className="rounded-md border border-dashed py-16 text-center text-sm text-muted-foreground">
              暂无会话
            </div>
          ) : (
            <div className="rounded-md border bg-background overflow-hidden">
              <div className="grid grid-cols-[7rem_1fr_8rem_8rem_7rem] gap-3 px-4 py-2 border-b bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
                <span>来源</span>
                <span>项目</span>
                <span>模型</span>
                <span>最近活跃</span>
                <span className="text-right">代码变化</span>
              </div>
              {sessions.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  onClick={() => setActiveSessionId(s.id)}
                />
              ))}
            </div>
          )}

          {hasMore && (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={isLoading}
              >
                {isLoading ? "加载中…" : "加载更多"}
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
      <SessionDetailDrawer
        sessionId={activeSessionId}
        onClose={() => setActiveSessionId(null)}
      />
    </>
  );
}
