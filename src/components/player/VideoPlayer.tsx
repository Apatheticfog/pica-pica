import { Film, LayoutGrid, MonitorPlay } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { ExternalPlayerPanel } from "@/components/player/ExternalPlayerPanel";
import { HtmlVideoPlayer } from "@/components/player/HtmlVideoPlayer";
import { ClipCard } from "@/components/library/ClipCard";
import { GameArtwork } from "@/components/library/GameArtwork";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { libraryClient } from "@/data/library-client";
import { usePerformanceMode } from "@/features/performance/PerformanceModeProvider";
import { formatBytes, formatDate, formatDuration } from "@/lib/utils";
import type { Clip, Game } from "@/types/library";

interface VideoPlayerProps {
  game: Game;
  clips: Clip[];
  totalCount: number;
  selected: Clip | null;
  hasMore: boolean;
  loadingMore: boolean;
  playerActive?: boolean;
  onLoadMore: () => Promise<Clip[]>;
  onSelect: (clip: Clip) => void;
}

export function VideoPlayer({
  game,
  clips,
  totalCount,
  selected,
  hasMore,
  loadingMore,
  playerActive = true,
  onLoadMore,
  onSelect,
}: VideoPlayerProps) {
  const { enabled: performanceMode } = usePerformanceMode();
  const recentClips = clips.slice(0, 12);
  const showQueue = totalCount > 1;
  const [playerSurfaceHeight, setPlayerSurfaceHeight] = useState<number | null>(null);
  const [playbackError, setPlaybackError] = useState<{ clipId: string; message: string } | null>(null);
  const selectedIndex = selected ? clips.findIndex((clip) => clip.id === selected.id) : -1;
  const previousClip = selectedIndex > 0 ? clips[selectedIndex - 1] : null;
  const nextClip = selectedIndex >= 0 ? clips[selectedIndex + 1] ?? null : null;
  const videoUrl = libraryClient.assetUrl(selected?.compatible ? selected.path : null);
  const posterUrl = libraryClient.assetUrl(selected?.thumbnailPath ?? null);
  const nativePlaybackError =
    playbackError && playbackError.clipId === selected?.id ? playbackError.message : null;

  const selectNextClip = async () => {
    if (nextClip) {
      onSelect(nextClip);
      return;
    }
    if (!hasMore) return;
    const loaded = await onLoadMore();
    if (loaded[0]) onSelect(loaded[0]);
  };

  const selectFromGrid = (clip: Clip) => {
    onSelect(clip);
    window.requestAnimationFrame(() => {
      document.getElementById("clip-player")?.scrollIntoView({ behavior: performanceMode ? "auto" : "smooth", block: "start" });
    });
  };

  const player = !selected ? (
    <PlayerPlaceholder game={game} onSurfaceHeight={setPlayerSurfaceHeight} />
  ) : selected.compatible && videoUrl && !nativePlaybackError ? (
    <HtmlVideoPlayer
      clip={selected}
      src={videoUrl}
      poster={posterUrl}
      active={playerActive}
      previousClip={previousClip}
      nextAvailable={Boolean(nextClip || hasMore)}
      navigationPending={loadingMore}
      onPrevious={() => previousClip && onSelect(previousClip)}
      onNext={() => void selectNextClip()}
      onPlaybackError={(message) => setPlaybackError({ clipId: selected.id, message })}
      onSurfaceHeight={setPlayerSurfaceHeight}
    />
  ) : selected.compatible && !videoUrl && !libraryClient.isDesktop() ? (
    <PlayerPlaceholder
      game={game}
      selected={selected}
      message="Native video playback is available in the desktop app. The browser preview does not receive access to your local clip."
      onSurfaceHeight={setPlayerSurfaceHeight}
    />
  ) : (
    <ExternalPlayerPanel
      game={game}
      clip={selected}
      poster={posterUrl}
      nativeError={nativePlaybackError}
      onSurfaceHeight={setPlayerSurfaceHeight}
    />
  );

  return (
    <div>
      <div
        id="clip-player"
        className={`mx-auto grid w-full scroll-mt-24 max-w-[min(100%,calc(177.78vh+102px))] items-start gap-5 ${showQueue ? "xl:grid-cols-[minmax(0,1fr)_clamp(340px,20vw,480px)]" : ""}`}
      >
        <div className="min-w-0">
          {player}
          {selected ? (
            <div className="mt-5 flex flex-col justify-between gap-4 px-1 sm:flex-row sm:items-start">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold tracking-[-.02em]">{selected.fileName}</h2>
                <p className="mt-1.5 text-xs text-muted-foreground">Recorded {formatDate(selected.createdAt, true)}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Badge>{formatDuration(selected.durationSeconds)}</Badge>
                {selected.width && selected.height ? <Badge>{selected.width} × {selected.height}</Badge> : null}
                <Badge>{formatBytes(selected.sizeBytes)}</Badge>
                {selected.codec ? <Badge className="uppercase">{selected.codec}</Badge> : null}
                <Badge>{selected.compatible && !nativePlaybackError ? "Built-in" : "External"}</Badge>
              </div>
            </div>
          ) : null}
        </div>

        {showQueue ? (
          <aside
            data-clip-queue
            style={{ height: playerSurfaceHeight ?? undefined }}
            className="hidden min-w-0 flex-col overflow-hidden rounded-[1.35rem] border border-white/[.08] bg-white/[.025] p-3 xl:flex"
          >
            <div className="flex shrink-0 items-center justify-between px-2 pb-3 pt-1">
              <div className="flex items-center gap-2 text-sm font-semibold"><Film className="size-4 text-primary" /> Recent clips</div>
              <span className="text-xs text-muted-foreground">{Math.min(totalCount, 12)} of {totalCount}</span>
            </div>
            <div className="grid min-h-0 gap-2 sm:grid-cols-2 xl:auto-rows-max xl:flex-1 xl:content-start xl:grid-cols-1 xl:overflow-y-auto xl:overscroll-contain xl:pr-1">
              {recentClips.map((clip) => (
                <ClipCard key={clip.id} clip={clip} game={game} active={clip.id === selected?.id} onSelect={() => onSelect(clip)} />
              ))}
            </div>
          </aside>
        ) : null}
      </div>

      <section id="all-clips" className="mt-12 scroll-mt-24 border-t border-white/[.07] pt-9" aria-labelledby="all-clips-title">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Your collection</p>
            <h2 id="all-clips-title" className="mt-2 text-2xl font-black tracking-[-.04em]">All clips</h2>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><LayoutGrid className="size-4" /> {clips.length} of {totalCount}</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 [@media(min-width:2200px)]:grid-cols-5 [@media(min-width:3000px)]:grid-cols-6">
          {clips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} game={game} active={clip.id === selected?.id} onSelect={() => selectFromGrid(clip)} />
          ))}
        </div>
        {hasMore ? (
          <div className="mt-8 flex justify-center">
            <Button variant="secondary" onClick={() => void onLoadMore()} disabled={loadingMore}>
              {loadingMore ? <Spinner /> : <LayoutGrid className="size-4" />}
              {loadingMore ? "Loading more clips …" : "Load more clips"}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function PlayerPlaceholder({
  game,
  selected = null,
  message = "Choose a clip from Recent clips or the grid below to start playback.",
  onSurfaceHeight,
}: {
  game: Game;
  selected?: Clip | null;
  message?: string;
  onSurfaceHeight: (height: number) => void;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const gameHeroUrl = libraryClient.assetUrl(game.heroPath);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const reportHeight = () => onSurfaceHeight(surface.getBoundingClientRect().height);
    const observer = new ResizeObserver(reportHeight);
    observer.observe(surface);
    reportHeight();
    return () => observer.disconnect();
  }, [onSurfaceHeight]);

  return (
    <div
      ref={surfaceRef}
      data-player-surface
      className="relative aspect-video overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#050506] shadow-[0_24px_80px_rgba(0,0,0,.35)]"
    >
      <GameArtwork
        title={game.title}
        start={game.accentStart}
        end={game.accentEnd}
        variant="hero"
        imageUrl={gameHeroUrl}
        className="absolute inset-0 size-full opacity-45"
      />
      <div className="absolute inset-0 bg-black/60" />
      <div className="absolute inset-0 grid place-items-center px-8 text-center">
        <div className="max-w-lg">
          <MonitorPlay className="mx-auto size-9 text-white/75" />
          <p className="mt-4 text-base font-semibold">{selected ? "Desktop playback" : "Choose a local clip"}</p>
          <p className="mt-2 text-xs leading-5 text-white/50">{message}</p>
        </div>
      </div>
    </div>
  );
}
