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

export interface MpvAudioTrack {
  id: number;
  title: string | null;
  language: string | null;
  codec: string | null;
  channels: string | null;
  selected: boolean;
}

export interface MpvSnapshot {
  sessionId: number;
  status: "idle" | "loading" | "playing" | "paused" | "ended" | "error";
  positionSeconds: number;
  durationSeconds: number | null;
  paused: boolean;
  volume: number;
  muted: boolean;
  audioTracks: MpvAudioTrack[];
  error: string | null;
}
