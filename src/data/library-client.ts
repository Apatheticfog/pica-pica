import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { demoBootstrap, demoClipPage, demoLibrary } from "@/data/demo-library";
import type {
  ArtworkKind,
  BootstrapState,
  ClipCursor,
  ClipPage,
  LibrarySnapshot,
  MetadataSearchResult,
  MetadataUpdate,
  ProviderSettings,
  ScanResult,
} from "@/types/library";
import type { MpvAvailability, MpvSnapshot, MpvViewport } from "@/types/player";

const pause = (duration = 350) => new Promise((resolve) => window.setTimeout(resolve, duration));

export const libraryClient = {
  isDesktop: isTauri,

  async bootstrap(): Promise<BootstrapState> {
    if (!isTauri()) {
      await pause();
      return demoBootstrap;
    }
    return invoke<BootstrapState>("get_bootstrap");
  },

  async pickRoot(): Promise<string | null> {
    if (!isTauri()) return "/Demo/OBS Replay Buffer";
    const selected = await open({
      title: "Choose the folder containing your OBS clips",
      directory: true,
      multiple: false,
    });
    return typeof selected === "string" ? selected : null;
  },

  async configure(rootPath: string): Promise<ScanResult> {
    if (!isTauri()) {
      await pause(800);
      return {
        library: demoLibrary,
        gamesDiscovered: demoLibrary.games.length,
        clipsDiscovered: demoLibrary.games.reduce((sum, game) => sum + game.clipCount, 0),
        clipsProbed: 0,
        clipsReused: demoLibrary.games.reduce((sum, game) => sum + game.clipCount, 0),
        thumbnailsCreated: 0,
        warnings: [],
      };
    }
    return invoke<ScanResult>("configure_library", { rootPath });
  },

  async scan(): Promise<ScanResult> {
    if (!isTauri()) return this.configure(demoLibrary.rootPath);
    return invoke<ScanResult>("scan_library");
  },

  async snapshot(): Promise<LibrarySnapshot> {
    if (!isTauri()) return demoLibrary;
    return invoke<LibrarySnapshot>("get_library");
  },

  async gameClips(gameId: string, cursor: ClipCursor | null, limit = 48): Promise<ClipPage> {
    if (!isTauri()) {
      await pause(120);
      return demoClipPage(gameId, cursor, limit);
    }
    return invoke<ClipPage>("get_game_clips", { gameId, cursor, limit });
  },

  async mpvAvailability(): Promise<MpvAvailability> {
    if (!isTauri()) return { available: false, version: null, diagnostic: "Embedded libmpv is available in the Windows desktop build." };
    return invoke<MpvAvailability>("get_mpv_availability");
  },

  async mpvLoad(clipId: string, sessionId: number): Promise<MpvSnapshot> {
    return invoke<MpvSnapshot>("mpv_load_clip", { clipId, sessionId });
  },

  async mpvViewport(viewport: MpvViewport): Promise<void> {
    if (!isTauri()) return;
    return invoke<void>("mpv_set_viewport", { viewport });
  },

  async mpvSnapshot(): Promise<MpvSnapshot> {
    return invoke<MpvSnapshot>("get_mpv_snapshot");
  },

  async mpvPaused(sessionId: number, paused: boolean): Promise<MpvSnapshot> {
    return invoke<MpvSnapshot>("mpv_set_paused", { sessionId, paused });
  },

  async mpvSeek(sessionId: number, seconds: number): Promise<MpvSnapshot> {
    return invoke<MpvSnapshot>("mpv_seek", { sessionId, seconds });
  },

  async mpvPreviewSeek(sessionId: number, seconds: number): Promise<void> {
    return invoke<void>("mpv_preview_seek", { sessionId, seconds });
  },

  async mpvVolume(sessionId: number, volume: number): Promise<MpvSnapshot> {
    return invoke<MpvSnapshot>("mpv_set_volume", { sessionId, volume });
  },

  async mpvMuted(sessionId: number, muted: boolean): Promise<MpvSnapshot> {
    return invoke<MpvSnapshot>("mpv_set_muted", { sessionId, muted });
  },

  async mpvStop(sessionId: number): Promise<void> {
    if (!isTauri()) return;
    return invoke<void>("mpv_stop", { sessionId });
  },

  async setFullscreen(fullscreen: boolean): Promise<void> {
    if (isTauri()) {
      await getCurrentWindow().setFullscreen(fullscreen);
      return;
    }
    if (fullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen();
    if (!fullscreen && document.fullscreenElement) await document.exitFullscreen();
  },

  async updateMetadata(update: MetadataUpdate): Promise<LibrarySnapshot> {
    if (!isTauri()) {
      const game = demoLibrary.games.find((item) => item.id === update.gameId);
      if (game) {
        Object.assign(game, update, { metadataStatus: "manual" as const });
      }
      return structuredClone(demoLibrary);
    }
    return invoke<LibrarySnapshot>("update_game_metadata", { update });
  },

  async providerSettings(): Promise<ProviderSettings> {
    if (!isTauri()) return { rawgConfigured: false, steamGridDbConfigured: false };
    return invoke<ProviderSettings>("get_provider_settings");
  },

  async saveProviderKey(provider: "rawg" | "steamgriddb", apiKey: string): Promise<ProviderSettings> {
    if (!isTauri()) {
      await pause();
      return {
        rawgConfigured: provider === "rawg" && Boolean(apiKey.trim()),
        steamGridDbConfigured: provider === "steamgriddb" && Boolean(apiKey.trim()),
      };
    }
    return invoke<ProviderSettings>("save_provider_api_key", { update: { provider, apiKey } });
  },

  async searchMetadata(query: string): Promise<MetadataSearchResult[]> {
    if (!isTauri()) {
      await pause();
      return demoLibrary.games
        .filter((game) => game.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
        .map((game) => ({
          providerId: game.metadataProviderId ?? game.id,
          title: game.title,
          releaseYear: game.releaseYear,
          genres: game.genres,
          platforms: ["PC"],
        }));
    }
    return invoke<MetadataSearchResult[]>("search_game_metadata", { query });
  },

  async applyMetadata(gameId: string, rawgId: string): Promise<LibrarySnapshot> {
    if (!isTauri()) {
      await pause();
      const candidate = demoLibrary.games.find((game) => game.metadataProviderId === rawgId || game.id === rawgId);
      const target = demoLibrary.games.find((game) => game.id === gameId);
      if (candidate && target) Object.assign(target, candidate, { id: gameId, folderPath: target.folderPath, folderName: target.folderName, clipCount: target.clipCount });
      return structuredClone(demoLibrary);
    }
    return invoke<LibrarySnapshot>("apply_game_metadata", { selection: { gameId, rawgId } });
  },

  async pickArtwork(kind: ArtworkKind): Promise<string | null> {
    if (!isTauri()) return null;
    const selected = await open({
      title: kind === "hero" ? "Choose a custom hero banner" : "Choose a custom poster",
      directory: false,
      multiple: false,
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }],
    });
    return typeof selected === "string" ? selected : null;
  },

  async setCustomArtwork(gameId: string, kind: ArtworkKind, sourcePath: string): Promise<LibrarySnapshot> {
    if (!isTauri()) return structuredClone(demoLibrary);
    return invoke<LibrarySnapshot>("set_custom_artwork", { update: { gameId, kind, sourcePath } });
  },

  async openExternal(url: string): Promise<void> {
    const target = new URL(url);
    if (target.protocol !== "https:") throw new Error("Only secure HTTPS links can be opened.");
    if (isTauri()) {
      await openUrl(target.href);
      return;
    }
    const opened = window.open(target.href, "_blank");
    if (!opened) throw new Error("The browser blocked the new tab. Allow pop-ups and try again.");
    opened.opener = null;
  },

  assetUrl(path: string | null): string | null {
    if (!path || !isTauri()) return null;
    return convertFileSrc(path);
  },
};
