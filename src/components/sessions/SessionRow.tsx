import { format } from "date-fns";
import { Bot, FileCode } from "lucide-react";
import type { SessionSummary } from "@/types";
import { Badge } from "@/components/ui/badge";
import { basename } from "@/lib/path";
import { cn } from "@/lib/utils";

const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
};

const PROVIDER_BADGE: Record<string, string> = {
  claude:
    "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  codex:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
};

function formatTs(ts: number | null): string {
  if (!ts) return "—";
  return format(new Date(ts), "MM-dd HH:mm");
}

interface SessionRowProps {
  session: SessionSummary;
  onClick: () => void;
}

export function SessionRow({ session, onClick }: SessionRowProps) {
  const providerLabel = PROVIDER_LABEL[session.provider] ?? session.provider;
  const badgeClass =
    PROVIDER_BADGE[session.provider] ?? "bg-muted text-foreground/70";
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left grid grid-cols-[7rem_1fr_8rem_8rem_7rem] gap-3 items-center px-4 py-3 border-b last:border-b-0 hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Badge
          variant="secondary"
          className={cn("text-[10px] uppercase tracking-wide", badgeClass)}
        >
          {providerLabel}
        </Badge>
      </div>
      <div className="min-w-0">
        <div
          className="truncate text-sm font-medium"
          title={session.cwd ?? "未知项目"}
        >
          {basename(session.cwd) || "未知项目"}
        </div>
        <div
          className="truncate text-[11px] text-muted-foreground"
          title={session.cwd ?? ""}
        >
          {session.cwd ?? "未知项目"}
        </div>
      </div>
      <div className="text-xs text-muted-foreground truncate" title={session.model ?? ""}>
        <Bot className="size-3 inline mr-1" />
        {session.model ?? "—"}
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        {formatTs(session.lastActiveAt)}
      </div>
      <div className="text-xs tabular-nums text-right">
        <span className="text-emerald-600 dark:text-emerald-400">
          +{session.added.toLocaleString()}
        </span>{" "}
        <span className="text-rose-600 dark:text-rose-400">
          -{session.removed.toLocaleString()}
        </span>
        <div className="text-[10px] text-muted-foreground">
          <FileCode className="size-3 inline mr-0.5" />
          {session.fileCount} 文件
        </div>
      </div>
    </button>
  );
}
