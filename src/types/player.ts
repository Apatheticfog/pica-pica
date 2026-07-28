export type ExternalPlayer = "mpv" | "vlc";

export interface ExternalPlayerStatus {
  player: ExternalPlayer;
  available: boolean;
  diagnostic: string | null;
}

export interface ExternalPlayerAvailability {
  players: ExternalPlayerStatus[];
  recommended: ExternalPlayer | null;
}

export interface ExternalPlaybackSession {
  sessionId: number;
  player: ExternalPlayer;
  processId: number;
  playlistLength: number;
  selectedIndex: number;
}
