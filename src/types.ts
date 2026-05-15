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

export interface Overview {
  totalLoc: number;
  totalFiles: number;
  locDeltaPercent: number | null;
  filesDeltaPercent: number | null;
  daily: DailyBucket[];
  byModel: ModelBreakdown[];
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

export type UsageRangePreset = "today" | "1d" | "7d" | "14d" | "30d" | "custom";

export interface UsageRangeSelection {
  preset: UsageRangePreset;
  /** seconds since epoch (matches cc-switch convention) */
  customStartDate?: number;
  /** seconds since epoch */
  customEndDate?: number;
}
