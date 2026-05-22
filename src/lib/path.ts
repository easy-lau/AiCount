export function basename(path: string | null | undefined): string {
  if (!path) return "";
  const parts = path.split(/[\\/]/);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i]) return parts[i];
  }
  return path;
}
