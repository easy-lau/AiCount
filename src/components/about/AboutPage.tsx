import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Bug,
  ClipboardCopy,
  Code2,
  ExternalLink,
  FolderOpen,
  Github,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  Tag,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

const REPO_URL = "https://github.com/easy-lau/AiCount";
const ISSUE_URL = `${REPO_URL}/issues/new`;
const AUTHOR_EMAIL = "liuxing@authine.com";
const SLOGAN = "统计 Claude Code / Codex CLI 代码生成量";

interface DataDirs {
  claudeDir: string;
  codexDir: string;
}

interface LatestRelease {
  tag: string;
  name: string | null;
  html_url: string;
  published_at: string | null;
}

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "newer"; tag: string; url: string }
  | { kind: "error"; message: string };

export function AboutPage() {
  const [version, setVersion] = useState<string>("…");
  const [dirs, setDirs] = useState<DataDirs | null>(null);
  const [copied, setCopied] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState>({ kind: "idle" });

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("unknown"));
    invoke<DataDirs>("get_data_dirs")
      .then(setDirs)
      .catch(() => {
        // ignore — info will just show "—"
      });
  }, []);

  const openRepo = () => openUrl(REPO_URL).catch(() => {});
  const openIssue = () => openUrl(ISSUE_URL).catch(() => {});
  const mailAuthor = () => openUrl(`mailto:${AUTHOR_EMAIL}`).catch(() => {});

  const parseSemver = (raw: string): [number, number, number] | null => {
    const m = raw.replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };

  const isNewer = (latest: string, current: string) => {
    const a = parseSemver(latest);
    const b = parseSemver(current);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) {
      if (a[i] > b[i]) return true;
      if (a[i] < b[i]) return false;
    }
    return false;
  };

  const checkUpdate = async () => {
    setUpdateState({ kind: "checking" });
    try {
      const release = await invoke<LatestRelease>("check_latest_version", {
        appVersion: version,
      });
      if (isNewer(release.tag, version)) {
        setUpdateState({
          kind: "newer",
          tag: release.tag.replace(/^v/i, ""),
          url: release.html_url,
        });
      } else {
        setUpdateState({ kind: "latest" });
      }
    } catch (err) {
      setUpdateState({
        kind: "error",
        message: typeof err === "string" ? err : "未知错误",
      });
    }
  };

  const reveal = (path: string) => {
    if (!path) return;
    revealItemInDir(path).catch(() => {});
  };

  const diagnostic = `AICount v${version}
Platform: ${navigator.platform} (${navigator.userAgent.includes("Mac") ? "macOS" : navigator.userAgent.includes("Windows") ? "Windows" : "Linux"})
Claude dir: ${dirs?.claudeDir ?? "—"}
Codex dir: ${dirs?.codexDir ?? "—"}
User agent: ${navigator.userAgent}`;

  const copyDiagnostic = async () => {
    try {
      await navigator.clipboard.writeText(diagnostic);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("clipboard write failed", err);
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
        {/* Hero */}
        <div className="flex items-center gap-4">
          <div className="size-16 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shadow-md">
            <Code2 className="size-8" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold leading-tight">AICount</h1>
            <p className="text-sm text-muted-foreground mt-1">{SLOGAN}</p>
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
              <Tag className="size-3" />
              <span className="tabular-nums">v{version}</span>
              <span className="opacity-40">·</span>
              <span>MIT License</span>
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openRepo}
            className="gap-2"
          >
            <Github className="size-3.5" /> GitHub 仓库
            <ExternalLink className="size-3 opacity-50" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openIssue}
            className="gap-2"
          >
            <Bug className="size-3.5" /> 报告问题
            <ExternalLink className="size-3 opacity-50" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={mailAuthor}
            className="gap-2"
          >
            <Mail className="size-3.5" /> 邮件联系作者
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={checkUpdate}
            disabled={updateState.kind === "checking" || version === "…"}
            className="gap-2"
          >
            <RefreshCw
              className={`size-3.5 ${updateState.kind === "checking" ? "animate-spin" : ""}`}
            />
            {updateState.kind === "checking" ? "检查中…" : "检查更新"}
          </Button>
        </div>

        {updateState.kind !== "idle" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground -mt-2">
            {updateState.kind === "latest" && (
              <span className="text-emerald-600">
                ✓ 已是最新版本 (v{version})
              </span>
            )}
            {updateState.kind === "newer" && (
              <>
                <span className="text-amber-600">
                  有新版 v{updateState.tag}
                </span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() =>
                    openUrl(updateState.url).catch(() => {})
                  }
                >
                  打开 Releases ↗
                </Button>
              </>
            )}
            {updateState.kind === "error" && (
              <span className="text-destructive">
                检查失败：{updateState.message}
              </span>
            )}
          </div>
        )}

        {/* Privacy */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldCheck className="size-4 text-emerald-600" /> 隐私与数据
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <p className="text-muted-foreground leading-relaxed">
              AICount <span className="text-foreground font-medium">无后台联网</span>、
              全本地解析；仅在你主动点击「检查更新」时会访问 GitHub Releases API，
              不会发送任何会话内容。
            </p>
            <ul className="space-y-1.5 text-xs">
              <li className="flex items-start gap-2">
                <Lock className="size-3.5 mt-0.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">
                  仅以 <span className="font-mono text-foreground">只读</span> 方式扫描下列目录，不修改、不删除（删除会话功能需用户在抽屉中显式确认）
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Lock className="size-3.5 mt-0.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">
                  统计在内存中聚合，缓存按文件 mtime 失效；切换设置可触发清理
                </span>
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Data dirs */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FolderOpen className="size-4 text-muted-foreground" /> 当前数据目录
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DirectoryRow
              label="Claude Code"
              path={dirs?.claudeDir}
              onReveal={() => dirs && reveal(dirs.claudeDir)}
            />
            <DirectoryRow
              label="Codex CLI"
              path={dirs?.codexDir}
              onReveal={() => dirs && reveal(dirs.codexDir)}
            />
            <p className="text-[11px] text-muted-foreground pt-1">
              这是当前生效的实际路径（已应用「设置 → 数据源」里的覆盖值）
            </p>
          </CardContent>
        </Card>

        {/* Diagnostic */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">诊断信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="text-[11px] font-mono whitespace-pre-wrap break-all rounded-md bg-muted/40 p-3 leading-relaxed">
              {diagnostic}
            </pre>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyDiagnostic}
              className="gap-2"
            >
              <ClipboardCopy className="size-3.5" />
              {copied ? "已复制" : "复制全部"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              报告 bug 时把这段贴到 issue 里，便于复现环境
            </p>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}

interface DirectoryRowProps {
  label: string;
  path: string | undefined;
  onReveal: () => void;
}

function DirectoryRow({ label, path, onReveal }: DirectoryRowProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <code
        className="flex-1 min-w-0 truncate rounded-md bg-muted/40 px-2 py-1.5 text-[12px] font-mono"
        title={path ?? ""}
      >
        {path ?? "—"}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onReveal}
        disabled={!path}
        className="gap-1.5 shrink-0"
        title={`在 Finder/资源管理器中显示 ${label} 目录`}
      >
        <ExternalLink className="size-3.5" />
      </Button>
    </div>
  );
}
