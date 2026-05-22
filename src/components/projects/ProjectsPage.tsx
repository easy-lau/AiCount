import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  FolderOpen,
  RefreshCw,
  Search,
} from "lucide-react";
import type { ProjectInfo } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { basename } from "@/lib/path";
import { cn } from "@/lib/utils";
import { ProjectCard } from "./ProjectCard";

type SortKey = "lastActive" | "name" | "sessionCount";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "lastActive", label: "最近活跃" },
  { value: "name", label: "名称" },
  { value: "sessionCount", label: "会话数" },
];

function useDebouncedValue<T>(value: T, delay = 150): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

interface ProjectsPageProps {
  onJump?: (projectPath: string) => void;
}

export function ProjectsPage({ onJump }: ProjectsPageProps = {}) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("lastActive");
  const debouncedQuery = useDebouncedValue(query, 150);
  const [deleteTarget, setDeleteTarget] = useState<ProjectInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadProjects = useCallback(() => {
    setIsLoading(true);
    invoke<ProjectInfo[]>("list_projects")
      .then((result) => setProjects(result))
      .catch(() => {
        // ignore
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    listen("session-changed", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => loadProjects(), 200);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (timer) clearTimeout(timer);
      unlisten?.();
    };
  }, [loadProjects]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await invoke<{ deleted: number; failed: number }>("delete_project", {
        project: deleteTarget.path,
      });
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(typeof err === "string" ? err : String(err));
    } finally {
      setIsDeleting(false);
    }
  };

  const filtered = useMemo(() => {
    const needle = debouncedQuery.trim().toLowerCase();
    const matched = needle
      ? projects.filter((p) => p.path.toLowerCase().includes(needle))
      : projects.slice();
    matched.sort((a, b) => {
      switch (sort) {
        case "name":
          return (
            basename(a.path).localeCompare(basename(b.path)) ||
            a.path.localeCompare(b.path)
          );
        case "sessionCount":
          return b.sessionCount - a.sessionCount;
        case "lastActive":
        default:
          return (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0);
      }
    });
    return matched;
  }, [projects, debouncedQuery, sort]);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="size-5 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">项目</h1>
            <span className="text-sm text-muted-foreground tabular-nums">
              （{projects.length}）
            </span>
            {isLoading && (
              <RefreshCw className="size-4 animate-spin text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索路径…"
                className="h-9 w-[220px] rounded-md border border-input bg-background pl-7 pr-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <SortDropdown value={sort} onChange={setSort} />
          </div>
        </header>

        {filtered.length === 0 ? (
          <div className="rounded-md border border-dashed py-16 text-center text-sm text-muted-foreground">
            {projects.length === 0 ? "暂无项目" : "没有匹配的项目"}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((p) => (
              <ProjectCard
                key={p.path}
                project={p}
                onClick={() => onJump?.(p.path)}
                onDelete={() => setDeleteTarget(p)}
              />
            ))}
          </div>
        )}
      </div>
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o && !isDeleting) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除项目</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  项目「<span className="font-mono">{basename(deleteTarget.path) || deleteTarget.path}</span>
                  」下的{" "}
                  <span className="font-semibold text-foreground">
                    {deleteTarget.sessionCount}
                  </span>{" "}
                  个会话 JSONL 文件将从磁盘永久删除，
                  <span className="text-foreground">
                    {deleteTarget.netLoc >= 0 ? "+" : ""}
                    {deleteTarget.netLoc.toLocaleString()}
                  </span>{" "}
                  行的统计记录将一并消失。此操作不可恢复。
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <div className="rounded-md bg-destructive/10 text-destructive px-3 py-2 text-xs">
              {deleteError}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteError(null);
              }}
              disabled={isDeleting}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "删除中…" : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  );
}

interface SortDropdownProps {
  value: SortKey;
  onChange: (value: SortKey) => void;
}

function SortDropdown({ value, onChange }: SortDropdownProps) {
  const [open, setOpen] = useState(false);
  const current = SORT_OPTIONS.find((o) => o.value === value) ?? SORT_OPTIONS[0];
  const pick = (next: SortKey) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="justify-start gap-2"
        >
          <ArrowUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-left">按 {current.label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[180px] p-1" align="end">
        {SORT_OPTIONS.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => pick(o.value)}
              className={cn(
                "w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-left transition-colors",
                active ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
            >
              <Check
                className={cn(
                  "h-4 w-4 shrink-0",
                  active ? "opacity-100" : "opacity-0",
                )}
              />
              <span className="flex-1 truncate">按 {o.label}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
