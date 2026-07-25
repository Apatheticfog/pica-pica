export interface MpvAvailability {
  available: boolean;
  version: string | null;
  diagnostic: string | null;
  fallbackAvailable: boolean;
  fallbackDiagnostic: string | null;
}

export interface MpvViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  cornerRadius: number;
  clipTop: number;
  clipBottom: number;
}

export interface MpvSnapshot {
  sessionId: number;
  status: "idle" | "loading" | "playing" | "paused" | "ended" | "error";
  positionSeconds: number;
  durationSeconds: number | null;
  paused: boolean;
  seeking: boolean;
  volume: number;
  muted: boolean;
  error: string | null;
}
