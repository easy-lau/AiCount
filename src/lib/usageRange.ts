import type { UsageRangePreset, UsageRangeSelection } from "@/types";

const DAY_SECONDS = 24 * 60 * 60;
const DAY_MS = DAY_SECONDS * 1000;

export interface ResolvedUsageRange {
  /** seconds since epoch */
  startDate: number;
  /** seconds since epoch */
  endDate: number;
}

function getStartOfLocalDayDate(nowMs: number): Date {
  const date = new Date(nowMs);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getPresetLookbackStart(
  preset: Exclude<UsageRangePreset, "today" | "1d" | "custom">,
  nowMs: number,
): number {
  const dayCount = preset === "7d" ? 7 : preset === "14d" ? 14 : 30;
  return Math.floor(
    getStartOfLocalDayDate(nowMs - (dayCount - 1) * DAY_MS).getTime() / 1000,
  );
}

export function resolveUsageRange(
  selection: UsageRangeSelection,
  nowMs: number = Date.now(),
): ResolvedUsageRange {
  const endDate = Math.floor(nowMs / 1000);
  // For calendar-day presets, extend the upper bound to the end of today
  // (23:59:59) instead of the current instant. Otherwise the bound freezes at
  // the moment the page resolved the range, and code generated later the same
  // day falls outside the window — so new edits stop counting until the app is
  // reopened, even though a manual refresh re-runs the query.
  const startOfTodaySec = Math.floor(
    getStartOfLocalDayDate(nowMs).getTime() / 1000,
  );
  const endOfTodaySec = startOfTodaySec + DAY_SECONDS - 1;

  switch (selection.preset) {
    case "today":
      return {
        startDate: startOfTodaySec,
        endDate: endOfTodaySec,
      };
    case "1d":
      return {
        startDate: endDate - DAY_SECONDS,
        endDate,
      };
    case "7d":
    case "14d":
    case "30d":
      return {
        startDate: getPresetLookbackStart(selection.preset, nowMs),
        endDate: endOfTodaySec,
      };
    case "custom": {
      const startDate = selection.customStartDate ?? endDate - DAY_SECONDS;
      const customEndDate = selection.customEndDate ?? endOfTodaySec;
      return {
        startDate,
        endDate: customEndDate,
      };
    }
  }
}

export function getUsageRangePresetLabel(preset: UsageRangePreset): string {
  switch (preset) {
    case "today":
      return "当天";
    case "1d":
      return "1d";
    case "7d":
      return "7d";
    case "14d":
      return "14d";
    case "30d":
      return "30d";
    case "custom":
      return "日历筛选";
  }
}

export function formatRangeTrigger(selection: UsageRangeSelection): string {
  if (selection.preset !== "custom") {
    return getUsageRangePresetLabel(selection.preset);
  }
  const { startDate, endDate } = resolveUsageRange(selection);
  const fmt = (sec: number) => {
    const d = new Date(sec * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  return `${fmt(startDate)} ~ ${fmt(endDate)}`;
}
