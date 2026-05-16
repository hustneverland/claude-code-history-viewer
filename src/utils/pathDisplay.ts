/**
 * 从绝对路径取最后一级目录名作为展示名。空 / 无可用段时回退到 fallbackName。
 * 同时识别 Windows ("\") 和 POSIX ("/") 分隔符。
 */
export function getProjectDisplayName(
  actualPath: string | null | undefined,
  fallbackName: string
): string {
  if (!actualPath || !actualPath.trim()) {
    return fallbackName;
  }
  const segments = actualPath.split(/[\\/]/).filter((s) => s.length > 0);
  if (segments.length === 0) {
    return fallbackName;
  }
  return segments[segments.length - 1];
}
