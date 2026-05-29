import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Archive, Check, CheckCheck, FolderOpen } from "lucide-react";
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
import { basename } from "@/lib/path";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  projects: ProjectInfo[];
}

interface BackupResult {
  archived: number;
  skipped: number;
  dest: string;
}

export function BackupDialog({ open, onClose, projects }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<BackupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setStatus("idle");
      setResult(null);
      setError(null);
    }
  }, [open]);

  const allSelected = projects.length > 0 && selected.size === projects.length;

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(projects.map((p) => p.path)));
  }

  async function handleBackup() {
    const today = new Date().toISOString().slice(0, 10);
    const destPath = await save({
      defaultPath: `aicount-backup-${today}.zip`,
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
    });
    if (!destPath) return;

    setStatus("working");
    setError(null);
    try {
      const res = await invoke<BackupResult>("backup_sessions", {
        projects: Array.from(selected),
        dest: destPath,
      });
      setResult(res);
      setStatus("done");
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
      setStatus("error");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="size-4 text-muted-foreground" />
            备份会话
          </DialogTitle>
          <DialogDescription>
            选择项目，将其会话 JSONL 文件打包为 zip 归档。
          </DialogDescription>
        </DialogHeader>

        {status === "done" && result ? (
          <div className="px-6 py-6">
            <div className="rounded-md border bg-muted/30 p-5 space-y-3 text-sm">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <CheckCheck className="size-5 shrink-0" />
                <span className="text-base">
                  已备份{" "}
                  <strong className="tabular-nums">{result.archived}</strong>{" "}
                  个会话文件
                  {result.skipped > 0 && (
                    <span className="text-muted-foreground">
                      （跳过 {result.skipped} 个）
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-baseline gap-2 pt-1">
                <span className="shrink-0 text-xs text-muted-foreground">
                  保存至
                </span>
                <span
                  className="truncate font-mono text-[11px] text-muted-foreground"
                  title={result.dest}
                >
                  {result.dest}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                已选 <span className="tabular-nums">{selected.size}</span> /{" "}
                {projects.length} 个项目
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={toggleAll}
                disabled={projects.length === 0}
              >
                <CheckCheck className="size-3.5" />
                {allSelected ? "取消全选" : "全选"}
              </Button>
            </div>

            <div className="max-h-[380px] min-h-[160px] overflow-y-auto rounded-md border p-1">
              {projects.length === 0 ? (
                <div className="flex h-[152px] items-center justify-center text-xs text-muted-foreground">
                  暂无项目
                </div>
              ) : (
                projects.map((p) => {
                  const active = selected.has(p.path);
                  return (
                    <button
                      key={p.path}
                      type="button"
                      onClick={() => toggle(p.path)}
                      title={p.path}
                      className={cn(
                        "w-full flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm text-left transition-colors",
                        active
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-muted",
                      )}
                    >
                      <Check
                        className={cn(
                          "size-4 shrink-0",
                          active ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate">
                          {basename(p.path) || p.path}
                        </div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {p.path}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                        {p.sessionCount} 会话
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 text-destructive px-3 py-2 text-xs">
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {status === "done" ? (
            <Button type="button" onClick={onClose}>
              完成
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button
                type="button"
                onClick={handleBackup}
                disabled={selected.size === 0 || status === "working"}
                className="gap-1.5"
              >
                <Archive className="size-3.5" />
                {status === "working" ? "备份中…" : "开始备份"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
