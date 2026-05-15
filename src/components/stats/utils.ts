import type { LocDelta } from "@/types";

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.trunc(value));
}

export function netDelta(delta: LocDelta): number {
  return delta.added - delta.removed;
}

export function formatNet(delta: LocDelta): string {
  const net = netDelta(delta);
  const sign = net > 0 ? "+" : net < 0 ? "" : "";
  return `${sign}${formatNumber(net)}`;
}

export function basename(path: string): string {
  if (!path) return path;
  const parts = path.split(/[\\/]/);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i]) return parts[i];
  }
  return path;
}
