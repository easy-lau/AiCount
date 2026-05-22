import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { format } from "date-fns";
import { ExternalLink, FileCode, RefreshCw, Trash2, X } from "lucide-react";
import type { EditEventDto, SessionDetail } from "@/types";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { basename } from "@/lib/path";
import { cn } from "@/lib/utils";

const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
};

function formatTs(ts: number | null): string {
  if (!ts) return "—";
  return format(new Date(ts), "yyyy-MM-dd HH:mm:ss");
}

interface SessionDetailDrawerProps {
  sessionId: string | null;
  onClose: () => void;
}

export function SessionDetailDrawer({
  sessionId,
  onClose,
}: SessionDetailDrawerProps) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    invoke<SessionDetail>("get_session_detail", { id: sessionId })
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(typeof err === "string" ? err : String(err));
          setDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const open = sessionId !== null;
  const summary = detail?.summary;

  const revealInFinder = async () => {
    if (!sessionId) return;
    try {
      await revealItemInDir(sessionId);
    } catch (err) {
      console.error("revealItemInDir failed", err);
    }
  };

  const handleDelete = async () => {
    if (!sessionId) return;
    setIsDeleting(true);
    setError(null);
    try {
      await invoke<void>("delete_session", { id: sessionId });
      setShowConfirm(false);
      onClose();
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        className={cn(
          "left-auto top-0 right-0 translate-x-0 translate-y-0",
          "h-screen max-h-screen w-full max-w-[480px] rounded-none border-l p-0 flex flex-col",
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <DialogTitle className="text-sm font-semibold truncate">
              会话详情
            </DialogTitle>
            {summary && (
              <Badge variant="secondary" className="text-[10px] uppercase">
                {PROVIDER_LABEL[summary.provider] ?? summary.provider}
              </Badge>
            )}
          </div>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="关闭"
            >
              <X className="size-4" />
            </Button>
          </DialogClose>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-5 space-y-5">
            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="size-4 animate-spin" /> 加载中…
              </div>
            )}
            {error && (
              <div className="rounded-md bg-destructive/10 text-destructive px-3 py-2 text-xs">
                {error}
              </div>
            )}
            {summary && (
              <>
                <MetadataBlock summary={summary} />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={revealInFinder}
                    className="gap-2"
                  >
                    <ExternalLink className="size-3.5" />
                    在 Finder/资源管理器中显示
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowConfirm(true)}
                    className="gap-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  >
                    <Trash2 className="size-3.5" />
                    删除会话
                  </Button>
                </div>
                <EventTimeline events={detail?.events ?? []} />
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>

    <Dialog
      open={showConfirm}
      onOpenChange={(o) => {
        if (!o && !isDeleting) setShowConfirm(false);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>确认删除会话</DialogTitle>
          <DialogDescription>
            会话 JSONL 文件将从磁盘永久删除，无法恢复。该项目的统计数字会立即下降相应行数。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowConfirm(false)}
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
    </>
  );
}

function MetadataBlock({
  summary,
}: {
  summary: SessionDetail["summary"];
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-4 space-y-2 text-xs">
      <Row label="项目" value={summary.cwd ?? "未知"} title={summary.cwd ?? ""} />
      <Row label="模型" value={summary.model ?? "—"} />
      <Row label="起始" value={formatTs(summary.firstEventAt)} />
      <Row label="最近活跃" value={formatTs(summary.lastActiveAt)} />
      <Row label="文件数" value={summary.fileCount.toLocaleString()} />
      <Row
        label="代码变化"
        value={
          <>
            <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">
              +{summary.added.toLocaleString()}
            </span>{" "}
            <span className="text-rose-600 dark:text-rose-400 tabular-nums">
              -{summary.removed.toLocaleString()}
            </span>
          </>
        }
      />
    </div>
  );
}

function Row({
  label,
  value,
  title,
}: {
  label: string;
  value: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="flex-1 min-w-0 truncate" title={title}>
        {value}
      </span>
    </div>
  );
}

function EventTimeline({ events }: { events: EditEventDto[] }) {
  if (events.length === 0) {
    return (
      <div className="text-xs text-muted-foreground text-center py-6 border rounded-md">
        无事件
      </div>
    );
  }
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground pb-2">
        事件时间线（{events.length}）
      </div>
      <ul className="space-y-1.5">
        {events.map((e, i) => (
          <li
            key={i}
            className="rounded-md border px-3 py-2 text-xs flex items-start gap-2"
          >
            <FileCode className="size-3.5 mt-0.5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div
                className="truncate font-mono text-[11px]"
                title={e.filePath ?? ""}
              >
                {basename(e.filePath) || "—"}
              </div>
              <div className="text-[10px] text-muted-foreground truncate">
                {e.filePath ?? "未知文件"}
              </div>
            </div>
            <div className="shrink-0 tabular-nums text-right">
              <div>
                <span className="text-emerald-600 dark:text-emerald-400">
                  +{e.added.toLocaleString()}
                </span>{" "}
                <span className="text-rose-600 dark:text-rose-400">
                  -{e.removed.toLocaleString()}
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {e.timestampMs ? format(new Date(e.timestampMs), "HH:mm:ss") : ""}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
