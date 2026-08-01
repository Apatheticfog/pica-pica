export const PERFORMANCE_MODE_STORAGE_KEY = "pica-pica.performance-mode";

export function parsePerformanceMode(value: string | null): boolean {
  return value === "enabled";
}

export function serializePerformanceMode(enabled: boolean): string {
  return enabled ? "enabled" : "disabled";
}
