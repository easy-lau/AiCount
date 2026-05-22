import { useState } from "react";
import { Check, ChevronDown, FolderOpen } from "lucide-react";
import type { ProjectInfo } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ALL_PROJECTS } from "@/lib/constants";
import { basename } from "@/lib/path";
import { cn } from "@/lib/utils";

interface ProjectPickerProps {
  projects: ProjectInfo[];
  selected: string;
  onSelect: (value: string) => void;
}

export function ProjectPicker({
  projects,
  selected,
  onSelect,
}: ProjectPickerProps) {
  const [open, setOpen] = useState(false);
  const isAll = selected === ALL_PROJECTS;
  const label = isAll
    ? `全部项目（${projects.length}）`
    : basename(selected) || selected;

  const pick = (value: string) => {
    onSelect(value);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="justify-start gap-2 max-w-[260px]"
          title={isAll ? "全部项目" : selected}
        >
          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate flex-1 text-left">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-1" align="end">
        <div className="max-h-[320px] overflow-y-auto">
          <button
            type="button"
            onClick={() => pick(ALL_PROJECTS)}
            className={cn(
              "w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-left transition-colors",
              isAll ? "bg-accent text-accent-foreground" : "hover:bg-muted",
            )}
          >
            <Check
              className={cn(
                "h-4 w-4 shrink-0",
                isAll ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="flex-1 truncate">全部项目</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {projects.length}
            </span>
          </button>
          {projects.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              暂无项目
            </div>
          ) : (
            projects.map((p) => {
              const active = p.path === selected;
              return (
                <button
                  key={p.path}
                  type="button"
                  onClick={() => pick(p.path)}
                  title={p.path}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-left transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      active ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">
                      {basename(p.path) || p.path}
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {p.path}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {p.sessionCount}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
