import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { PERFORMANCE_MODE_STORAGE_KEY, parsePerformanceMode, serializePerformanceMode } from "./performance-mode";

interface PerformanceModeContextValue {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

const PerformanceModeContext = createContext<PerformanceModeContextValue | null>(null);

function readStoredMode(): boolean {
  try {
    return parsePerformanceMode(window.localStorage.getItem(PERFORMANCE_MODE_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function PerformanceModeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(readStoredMode);

  useLayoutEffect(() => {
    document.documentElement.dataset.performanceMode = enabled ? "true" : "false";
  }, [enabled]);

  const setEnabled = useCallback((nextEnabled: boolean) => {
    setEnabledState(nextEnabled);
    try {
      window.localStorage.setItem(PERFORMANCE_MODE_STORAGE_KEY, serializePerformanceMode(nextEnabled));
    } catch {
      // The mode still works for this session if WebKit denies local storage.
    }
  }, []);

  const value = useMemo(() => ({ enabled, setEnabled }), [enabled, setEnabled]);
  return <PerformanceModeContext.Provider value={value}>{children}</PerformanceModeContext.Provider>;
}

export function usePerformanceMode(): PerformanceModeContextValue {
  const context = useContext(PerformanceModeContext);
  if (!context) throw new Error("usePerformanceMode must be used inside PerformanceModeProvider");
  return context;
}
