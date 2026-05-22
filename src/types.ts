export interface LocDelta {
  added: number;
  removed: number;
}

export interface FileLoc {
  path: string;
  delta: LocDelta;
  provider: string;
}

export interface CodeStats {
  total: LocDelta;
  byProvider: Record<string, LocDelta>;
  byProject: Record<string, LocDelta>;
  topFiles: FileLoc[];
  thisWeek: LocDelta;
  thisMonth: LocDelta;
  sessionCount: number;
}

export interface ProjectInfo {
  path: string;
  sessionCount: number;
  lastActiveAt: number | null;
  netLoc: number;
}

export interface DailyBucket {
  date: string;
  loc: number;
  files: number;
}

export interface ModelBreakdown {
  model: string;
  loc: number;
  fileCount: number;
  percent: number;
}

export interface LanguageBreakdown {
  language: string;
  extension: string;
  loc: number;
  fileCount: number;
  percent: number;
}

export interface HeatmapCell {
  date: string;
  loc: number;
}

export interface HeatmapData {
  fromMs: number;
  toMs: number;
  cells: HeatmapCell[];
}

export interface Overview {
  totalLoc: number;
  totalFiles: number;
  locDeltaPercent: number | null;
  filesDeltaPercent: number | null;
  daily: DailyBucket[];
  byModel: ModelBreakdown[];
  byLanguage: LanguageBreakdown[];
  sessionCount: number;
  rangeFromMs: number;
  rangeToMs: number;
  totalProjectLoc: number;
  aiRatioPercent: number;
  aiRatioDeltaPercent: number | null;
}

export interface OverviewQuery {
  project?: string;
  fromMs: number;
  toMs: number;
}

export interface SessionSummary {
  id: string;
  provider: string;
  cwd: string | null;
  model: string | null;
  firstEventAt: number | null;
  lastActiveAt: number | null;
  added: number;
  removed: number;
  fileCount: number;
}

export interface EditEventDto {
  filePath: string | null;
  timestampMs: number | null;
  added: number;
  removed: number;
}

export interface SessionDetail {
  summary: SessionSummary;
  events: EditEventDto[];
}

export interface ListSessionsQuery {
  provider?: string;
  project?: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
  offset?: number;
}

export type UsageRangePreset = "today" | "1d" | "7d" | "14d" | "30d" | "custom";

export interface UsageRangeSelection {
  preset: UsageRangePreset;
  /** seconds since epoch (matches cc-switch convention) */
  customStartDate?: number;
  /** seconds since epoch */
  customEndDate?: number;
}
