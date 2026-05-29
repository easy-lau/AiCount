import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, RefreshCw, Settings } from "lucide-react";
import type { LanguageOption, UserSettings } from "@/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SaveState = "idle" | "saving" | "saved" | "error";

export function SettingsPage() {
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [save, setSave] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      invoke<UserSettings>("get_settings"),
      invoke<LanguageOption[]>("list_languages"),
    ])
      .then(([settings, langs]) => {
        if (cancelled) return;
        setExcluded(new Set(settings.excludedLanguages));
        setLanguages(langs);
      })
      .catch((err) => {
        if (!cancelled) setError(typeof err === "string" ? err : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Union of languages present in data and any excluded language, so excluded
  // entries stay visible even when they have no current LOC.
  const rows = useMemo(() => {
    const loc = new Map<string, number>();
    for (const l of languages) loc.set(l.language, l.loc);
    for (const ex of excluded) if (!loc.has(ex)) loc.set(ex, 0);
    return [...loc.entries()]
      .map(([language, lines]) => ({ language, lines }))
      .sort((a, b) => b.lines - a.lines || a.language.localeCompare(b.language));
  }, [languages, excluded]);

  async function persist(next: Set<string>) {
    setSave("saving");
    setError(null);
    try {
      await invoke("save_settings", {
        settings: { excludedLanguages: [...next] } satisfies UserSettings,
      });
      setSave("saved");
      window.setTimeout(() => setSave("idle"), 1500);
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
      setSave("error");
    }
  }

  function toggle(language: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(language)) next.delete(language);
      else next.add(language);
      void persist(next);
      return next;
    });
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl px-6 py-6 space-y-4">
        <header className="flex items-center gap-2">
          <Settings className="size-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">设置</h1>
        </header>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">代码量统计过滤</CardTitle>
              <SaveIndicator state={save} />
            </div>
            <p className="text-sm text-muted-foreground">
              取消勾选的语言不计入代码量统计（总量、每日趋势、热力图、模型与语言占比）。Markdown
              默认不参与统计。
            </p>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-3 rounded-md bg-destructive/10 text-destructive px-3 py-2 text-xs">
                {error}
              </div>
            )}

            {loading ? (
              <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
                <RefreshCw className="size-4 animate-spin" /> 加载中…
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
                暂无可统计的语言
              </div>
            ) : (
              <div className="rounded-md border divide-y">
                {rows.map(({ language, lines }) => {
                  const included = !excluded.has(language);
                  return (
                    <button
                      key={language}
                      type="button"
                      onClick={() => toggle(language)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors hover:bg-muted/50"
                      aria-pressed={included}
                    >
                      <span
                        className={cn(
                          "flex size-[18px] items-center justify-center rounded-[5px] border transition-colors shrink-0",
                          included
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input",
                        )}
                      >
                        {included && (
                          <Check className="size-3" strokeWidth={3} />
                        )}
                      </span>
                      <span
                        className={cn(
                          "flex-1 min-w-0 truncate",
                          !included && "text-muted-foreground line-through",
                        )}
                      >
                        {language}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {lines.toLocaleString()} 行
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving")
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <RefreshCw className="size-3 animate-spin" /> 保存中…
      </span>
    );
  if (state === "saved")
    return (
      <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <Check className="size-3" /> 已保存
      </span>
    );
  if (state === "error")
    return <span className="text-xs text-destructive">保存失败</span>;
  return null;
}
