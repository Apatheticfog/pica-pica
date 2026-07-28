export type MetadataStatus = "matched" | "manual" | "unresolved";

export interface Clip {
  id: string;
  gameId: string;
  path: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
  createdAt: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  compatible: boolean;
  thumbnailPath: string | null;
}

export interface Game {
  id: string;
  folderPath: string;
  folderName: string;
  title: string;
  description: string | null;
  genres: string[];
  releaseYear: number | null;
  metadataStatus: MetadataStatus;
  accentStart: string;
  accentEnd: string;
  metadataProvider: string | null;
  metadataProviderId: string | null;
  artworkProvider: string | null;
  artworkProviderId: string | null;
  posterPath: string | null;
  heroPath: string | null;
  clipCount: number;
  newestClipAt: number | null;
}

export interface ClipCursor {
  createdAt: number;
  id: string;
}

export interface ClipPage {
  clips: Clip[];
  total: number;
  nextCursor: ClipCursor | null;
}

export interface LibrarySnapshot {
  rootPath: string;
  cachePath: string;
  lastScannedAt: number | null;
  ffmpegAvailable: boolean;
  ffmpegSource: "bundled" | "system" | "missing" | string;
  games: Game[];
}

export interface BootstrapState {
  configured: boolean;
  rootPath: string | null;
  cachePath: string;
  ffmpegAvailable: boolean;
  ffmpegSource: "bundled" | "system" | "missing" | string;
  mediaCompatibilityScanRequired: boolean;
  library: LibrarySnapshot | null;
}

export interface ScanResult {
  library: LibrarySnapshot;
  gamesDiscovered: number;
  clipsDiscovered: number;
  clipsProbed: number;
  clipsReused: number;
  thumbnailsCreated: number;
  warnings: string[];
}

export interface MetadataUpdate {
  gameId: string;
  title: string;
  description: string | null;
  genres: string[];
  releaseYear: number | null;
}

export interface ProviderSettings {
  rawgConfigured: boolean;
  steamGridDbConfigured: boolean;
}

export interface MetadataSearchResult {
  providerId: string;
  title: string;
  releaseYear: number | null;
  genres: string[];
  platforms: string[];
}

export type ArtworkKind = "poster" | "hero";
