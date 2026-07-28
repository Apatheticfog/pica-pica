import type { BootstrapState, Clip, ClipCursor, ClipPage, Game, LibrarySnapshot } from "@/types/library";

const now = Date.now();

function clip(gameId: string, index: number, minutesAgo: number, duration: number): Clip {
  return {
    id: `${gameId}-clip-${index}`,
    gameId,
    path: "",
    fileName: `Replay ${new Date(now - minutesAgo * 60_000).toISOString().slice(0, 19).replace("T", " ")}.mp4`,
    extension: "mp4",
    sizeBytes: 118_000_000 + index * 23_000_000,
    createdAt: now - minutesAgo * 60_000,
    durationSeconds: duration,
    width: 1920,
    height: 1080,
    codec: "h264",
    compatible: true,
    thumbnailPath: null,
  };
}

const demoClips: Record<string, Clip[]> = {
  "overwatch-2": [clip("overwatch-2", 1, 34, 31), clip("overwatch-2", 2, 184, 46), clip("overwatch-2", 3, 1480, 28)],
  valorant: [clip("valorant", 1, 2540, 42), clip("valorant", 2, 4860, 37)],
  minecraft: [clip("minecraft", 1, 9200, 64)],
  "mystery-folder": [clip("mystery-folder", 1, 12_400, 24)],
};

const games: Game[] = [
  {
    id: "overwatch-2",
    folderPath: "/Demo/Overwatch 2",
    folderName: "Overwatch 2",
    title: "Overwatch 2",
    description: "A team-based hero shooter where every decision and every second can change the outcome of a match.",
    genres: ["Shooter", "Team", "Competitive"],
    releaseYear: 2022,
    metadataStatus: "matched",
    accentStart: "#ef6a35",
    accentEnd: "#273a67",
    metadataProvider: "rawg",
    metadataProviderId: "22509",
    artworkProvider: null,
    artworkProviderId: null,
    posterPath: null,
    heroPath: null,
    clipCount: demoClips["overwatch-2"].length,
    newestClipAt: now - 34 * 60_000,
  },
  {
    id: "valorant",
    folderPath: "/Demo/Valorant",
    folderName: "Valorant",
    title: "VALORANT",
    description: "Precise gunplay meets unique agent abilities in tactical five-versus-five rounds.",
    genres: ["Tactical", "Shooter"],
    releaseYear: 2020,
    metadataStatus: "matched",
    accentStart: "#ff4655",
    accentEnd: "#171b2c",
    metadataProvider: "rawg",
    metadataProviderId: "3498",
    artworkProvider: null,
    artworkProviderId: null,
    posterPath: null,
    heroPath: null,
    clipCount: demoClips.valorant.length,
    newestClipAt: now - 2540 * 60_000,
  },
  {
    id: "minecraft",
    folderPath: "/Demo/Minecraft",
    folderName: "Minecraft",
    title: "Minecraft",
    description: "A world of blocks, limitless ideas, and unexpected moments.",
    genres: ["Sandbox", "Adventure"],
    releaseYear: 2011,
    metadataStatus: "matched",
    accentStart: "#55a144",
    accentEnd: "#273a23",
    metadataProvider: "rawg",
    metadataProviderId: "3498",
    artworkProvider: null,
    artworkProviderId: null,
    posterPath: null,
    heroPath: null,
    clipCount: demoClips.minecraft.length,
    newestClipAt: now - 9200 * 60_000,
  },
  {
    id: "mystery-folder",
    folderPath: "/Demo/New Game 2026",
    folderName: "New Game 2026",
    title: "New Game 2026",
    description: null,
    genres: [],
    releaseYear: null,
    metadataStatus: "unresolved",
    accentStart: "#565b68",
    accentEnd: "#17191e",
    metadataProvider: null,
    metadataProviderId: null,
    artworkProvider: null,
    artworkProviderId: null,
    posterPath: null,
    heroPath: null,
    clipCount: demoClips["mystery-folder"].length,
    newestClipAt: now - 12_400 * 60_000,
  },
];

export const demoLibrary: LibrarySnapshot = {
  rootPath: "/Demo/OBS Replay Buffer",
  cachePath: "/Demo/Pica Pica Cache",
  lastScannedAt: now - 90_000,
  ffmpegAvailable: true,
  ffmpegSource: "bundled",
  games,
};

export const demoBootstrap: BootstrapState = {
  configured: true,
  rootPath: demoLibrary.rootPath,
  cachePath: demoLibrary.cachePath,
  ffmpegAvailable: true,
  ffmpegSource: "bundled",
  mediaCompatibilityScanRequired: false,
  library: demoLibrary,
};

export function demoClipPage(gameId: string, cursor: ClipCursor | null, limit: number): ClipPage {
  const clips = demoClips[gameId] ?? [];
  const cursorIndex = cursor ? clips.findIndex((clip) => clip.id === cursor.id) : -1;
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const page = clips.slice(start, start + limit);
  const hasMore = start + page.length < clips.length;
  const last = page.at(-1);
  return {
    clips: structuredClone(page),
    total: clips.length,
    nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}
