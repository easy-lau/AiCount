import { FolderOpen, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { ProjectInfo } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { basename } from "@/lib/path";
import { cn } from "@/lib/utils";

function formatNet(net: number): string {
  const sign = net >= 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("en-US").format(net)}`;
}

interface ProjectCardProps {
  project: ProjectInfo;
  onClick: () => void;
  onDelete: () => void;
}

export function ProjectCard({ project, onClick, onDelete }: ProjectCardProps) {
  const name = basename(project.path) || project.path;
  const relative = project.lastActiveAt
    ? formatDistanceToNow(new Date(project.lastActiveAt), { addSuffix: true })
    : "无活动";
  const netClass =
    project.netLoc >= 0
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-rose-600 dark:text-rose-400";

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="group cursor-pointer transition-colors hover:border-blue-500 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-2 min-w-0">
          <div className="size-8 rounded-md bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center shrink-0">
            <FolderOpen className="size-4 text-blue-600" />
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-sm font-semibold leading-tight"
              title={project.path}
            >
              {name}
            </div>
            <div
              className="truncate text-[11px] text-muted-foreground mt-0.5"
              title={project.path}
            >
              {project.path}
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label={`删除项目 ${name}`}
            title="删除该项目的所有会话"
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity rounded-md p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              会话
            </div>
            <div className="tabular-nums font-medium">
              {project.sessionCount}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              净 LOC
            </div>
            <div className={cn("tabular-nums font-medium", netClass)}>
              {formatNet(project.netLoc)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              活跃
            </div>
            <div
              className="truncate text-foreground/80"
              title={
                project.lastActiveAt
                  ? new Date(project.lastActiveAt).toLocaleString()
                  : ""
              }
            >
              {relative}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
