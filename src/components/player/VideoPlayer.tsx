import { AlertCircle, Film, Headphones, LayoutGrid, Maximize2, Minimize2, MonitorPlay, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ClipCard } from "@/components/library/ClipCard";
import { GameArtwork } from "@/components/library/GameArtwork";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { libraryClient } from "@/data/library-client";
import { cn, formatBytes, formatDate, formatDuration } from "@/lib/utils";
import type { Clip, Game } from "@/types/library";
import type { MpvAvailability, MpvSnapshot } from "@/types/player";

let nextPlayerSession = 0;

interface VideoPlayerProps {
  game: Game;
  clips: Clip[];
  totalCount: number;
  selected: Clip | null;
  hasMore: boolean;
  loadingMore: boolean;
  playerActive?: boolean;
  onLoadMore: () => void;
  onSelect: (clip: Clip) => void;
}

export function VideoPlayer({ game, clips, totalCount, selected, hasMore, loadingMore, playerActive = true, onLoadMore, onSelect }: VideoPlayerProps) {
  const otherClips = clips.slice(0, 12);
  const [playerSurfaceHeight, setPlayerSurfaceHeight] = useState<number | null>(null);
  const aspectRatio = selected?.width && selected.height ? `${selected.width} / ${selected.height}` : "16 / 9";

  return (
    <div>
    <div className={`grid w-full items-start gap-5 ${otherClips.length ? "xl:grid-cols-[minmax(0,1fr)_clamp(340px,20vw,480px)]" : ""}`}>
      <div className="min-w-0">
        <NativeMpvPlayer game={game} selected={selected} active={playerActive} aspectRatio={aspectRatio} onSurfaceHeight={setPlayerSurfaceHeight} />
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
            </div>
          </div>
        ) : null}
      </div>

      {otherClips.length ? <aside data-clip-queue style={{ height: playerSurfaceHeight ?? undefined }} className="hidden min-w-0 flex-col overflow-hidden rounded-[1.35rem] border border-white/[.08] bg-white/[.025] p-3 xl:flex">
        <div className="flex shrink-0 items-center justify-between px-2 pb-3 pt-1">
          <div className="flex items-center gap-2 text-sm font-semibold"><Film className="size-4 text-primary" /> More clips</div>
          <span className="text-xs text-muted-foreground">{Math.min(totalCount, 12)} of {totalCount}</span>
        </div>
        <div className="grid min-h-0 gap-2 sm:grid-cols-2 xl:auto-rows-max xl:flex-1 xl:content-start xl:grid-cols-1 xl:overflow-y-auto xl:overscroll-contain xl:pr-1">
          {otherClips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} game={game} active={clip.id === selected?.id} onSelect={() => onSelect(clip)} />
          ))}
        </div>
      </aside> : null}
    </div>

    <section className="mt-12 border-t border-white/[.07] pt-9" aria-labelledby="all-clips-title">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Your collection</p>
          <h2 id="all-clips-title" className="mt-2 text-2xl font-black tracking-[-.04em]">All clips</h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><LayoutGrid className="size-4" /> {clips.length} of {totalCount}</div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 [@media(min-width:2200px)]:grid-cols-5 [@media(min-width:3000px)]:grid-cols-6">
        {clips.map((clip) => (
          <ClipCard key={clip.id} clip={clip} game={game} active={clip.id === selected?.id} onSelect={() => onSelect(clip)} />
        ))}
      </div>
      {hasMore ? (
        <div className="mt-8 flex justify-center">
          <Button variant="secondary" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? <Spinner /> : <LayoutGrid className="size-4" />}
            {loadingMore ? "Loading more clips …" : "Load more clips"}
          </Button>
        </div>
      ) : null}
    </section>
    </div>
  );
}

function NativeMpvPlayer({ game, selected, active, aspectRatio, onSurfaceHeight }: { game: Game; selected: Clip | null; active: boolean; aspectRatio: string; onSurfaceHeight: (height: number) => void }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [availability, setAvailability] = useState<MpvAvailability | null>(null);
  const [playback, setPlayback] = useState<{ clipId: string; sessionId: number; snapshot: MpvSnapshot | null; error: string | null } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsHeight, setControlsHeight] = useState(80);
  const current = playback?.clipId === selected?.id ? playback : null;
  const snapshot = current?.snapshot ?? null;
  const playerReady = Boolean(snapshot);
  const error = current?.error ?? null;
  const fallbackUrl = libraryClient.assetUrl(selected?.compatible ? selected.path : null);
  const posterUrl = libraryClient.assetUrl(selected?.thumbnailPath ?? null);

  useEffect(() => {
    let mounted = true;
    void libraryClient
      .mpvAvailability()
      .then((result) => mounted && setAvailability(result))
      .catch((cause) => mounted && setAvailability({
        available: false,
        version: null,
        diagnostic: cause instanceof Error ? cause.message : String(cause),
        fallbackAvailable: false,
        fallbackDiagnostic: "Pica Pica could not verify the Linux video runtime.",
      }));
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const reportHeight = () => onSurfaceHeight(surface.getBoundingClientRect().height);
    const observer = new ResizeObserver(reportHeight);
    observer.observe(surface);
    reportHeight();
    return () => observer.disconnect();
  }, [onSurfaceHeight]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const reportHeight = () => setControlsHeight(Math.ceil(controls.getBoundingClientRect().height));
    const observer = new ResizeObserver(reportHeight);
    observer.observe(controls);
    reportHeight();
    return () => observer.disconnect();
  }, [availability?.available]);

  useEffect(() => {
    if (!selected || !availability?.available) return;
    let mounted = true;
    const sessionId = ++nextPlayerSession;
    void libraryClient
      .mpvLoad(selected.id, sessionId)
      .then((result) => {
        if (mounted) setPlayback({ clipId: selected.id, sessionId, snapshot: result, error: null });
      })
      .catch((cause) => {
        if (mounted) setPlayback({ clipId: selected.id, sessionId, snapshot: null, error: cause instanceof Error ? cause.message : String(cause) });
      });
    return () => {
      mounted = false;
      void libraryClient.mpvStop(sessionId).catch(() => undefined);
    };
  }, [availability?.available, selected]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && fullscreen) {
        void libraryClient.setFullscreen(false).then(() => setFullscreen(false));
      } else if (event.key.toLocaleLowerCase() === "f" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        if (target?.matches("input, textarea, select")) return;
        const next = !fullscreen;
        void libraryClient.setFullscreen(next).then(() => setFullscreen(next));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  useEffect(() => () => {
    if (fullscreen) void libraryClient.setFullscreen(false);
  }, [fullscreen]);

  useEffect(() => {
    if (!current?.sessionId || !playerReady) return;
    let mounted = true;
    const poll = window.setInterval(() => {
      void libraryClient
        .mpvSnapshot()
        .then((result) => {
          if (mounted && result.sessionId === current.sessionId) {
            setPlayback((value) => value?.sessionId === current.sessionId ? { ...value, snapshot: result } : value);
          }
        })
        .catch(() => undefined);
    }, 350);
    return () => {
      mounted = false;
      window.clearInterval(poll);
    };
  }, [current?.sessionId, playerReady]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !availability?.available || !current?.sessionId || !playerReady) return;
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rect = surface.getBoundingClientRect();
        const scale = window.devicePixelRatio || 1;
        const visibleLeft = Math.max(rect.left, 0);
        const visibleTop = Math.max(rect.top, fullscreen ? 0 : 69);
        const visibleRight = Math.min(rect.right, window.innerWidth);
        const visibleBottom = Math.min(rect.bottom, window.innerHeight);
        const visibleArea = Math.max(0, visibleRight - visibleLeft) * Math.max(0, visibleBottom - visibleTop);
        void libraryClient.mpvViewport({
          x: Math.round(rect.left * scale),
          y: Math.round(rect.top * scale),
          width: Math.round(rect.width * scale),
          height: Math.round(rect.height * scale),
          visible: active && (fullscreen || visibleArea > 0),
          cornerRadius: fullscreen ? 0 : Math.round(22 * scale),
          clipTop: fullscreen ? 0 : Math.round(Math.max(0, 69 - rect.top) * scale),
          clipBottom: fullscreen ? Math.round(controlsHeight * scale) : 0,
        }).catch(() => undefined);
      });
    };
    const resizeObserver = new ResizeObserver(update);
    const intersectionObserver = new IntersectionObserver(update, { threshold: [0, 1] });
    resizeObserver.observe(surface);
    intersectionObserver.observe(surface);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    update();
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      void libraryClient.mpvViewport({ x: 0, y: 0, width: 0, height: 0, visible: false, cornerRadius: 0, clipTop: 0, clipBottom: 0 }).catch(() => undefined);
    };
  }, [active, availability?.available, controlsHeight, current?.sessionId, fullscreen, onSurfaceHeight, playerReady]);

  const updateSnapshot = (operation: Promise<MpvSnapshot>) => {
    const sessionId = current?.sessionId;
    if (!sessionId) return;
    void operation
      .then((result) => {
        if (result.sessionId === sessionId) {
          setPlayback((value) => value?.sessionId === sessionId ? { ...value, snapshot: result, error: null } : value);
        }
      })
      .catch((cause) => setPlayback((value) => value?.sessionId === sessionId ? { ...value, error: cause instanceof Error ? cause.message : String(cause) } : value));
  };

  const selectedAudioIds = snapshot?.audioTracks.filter((track) => track.selected).map((track) => track.id) ?? [];

  const toggleAudioTrack = (trackId: number, selected: boolean) => {
    if (!snapshot) return;
    const nextIds = selected
      ? [...new Set([...selectedAudioIds, trackId])]
      : selectedAudioIds.filter((id) => id !== trackId);
    if (!nextIds.length) return;
    updateSnapshot(libraryClient.mpvAudioTracks(snapshot.sessionId, nextIds));
  };

  const toggleFullscreen = () => {
    const next = !fullscreen;
    void libraryClient
      .setFullscreen(next)
      .then(() => setFullscreen(next))
      .catch(() => undefined);
  };

  return (
    <div>
      <div
        ref={surfaceRef}
        data-player-surface
        style={{ aspectRatio: fullscreen ? "auto" : aspectRatio }}
        className={cn(
          "relative overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#050506] shadow-[0_24px_80px_rgba(0,0,0,.35)]",
          fullscreen && "fixed inset-0 z-[100] rounded-none border-0 shadow-none",
        )}
      >
        {!availability ? (
          <div className="absolute inset-0 grid place-items-center"><Spinner className="size-6" /></div>
        ) : !availability.available && availability.fallbackAvailable && fallbackUrl ? (
          <ManagedVideo key={fallbackUrl} src={fallbackUrl} poster={posterUrl} />
        ) : !availability.available || error || !selected ? (
          <>
            <GameArtwork title={game.title} start={game.accentStart} end={game.accentEnd} variant="hero" className="absolute inset-0 size-full opacity-45" />
            <div className="absolute inset-0 bg-black/60" />
            <div className="absolute inset-0 grid place-items-center px-8 text-center">
              <div className="max-w-lg">
                {error || !availability.available ? <AlertCircle className="mx-auto size-8 text-amber-300" /> : <MonitorPlay className="mx-auto size-9 text-white/75" />}
                <p className="mt-4 text-base font-semibold">
                  {error ? "libmpv could not play this clip" : selected && !availability.fallbackAvailable ? "Linux video support is incomplete" : selected ? "Embedded libmpv is unavailable" : "Choose a local clip"}
                </p>
                <p className="mt-2 text-xs leading-5 text-white/50">
                  {error ?? availability.fallbackDiagnostic ?? availability.diagnostic ?? "The Windows preview includes libmpv for direct local playback."}
                </p>
              </div>
            </div>
          </>
        ) : !current?.snapshot ? (
          <div className="absolute inset-0 grid place-items-center"><div className="flex items-center gap-3 text-sm text-white/60"><Spinner /> Starting libmpv …</div></div>
        ) : null}
      </div>

      {availability?.available ? (
        <div ref={controlsRef} className={cn(
          "mt-3 flex min-h-16 flex-col gap-3 rounded-2xl border border-white/[.08] bg-white/[.025] p-3 sm:flex-row sm:items-center",
          fullscreen && "fixed inset-x-0 bottom-0 z-[101] m-0 min-h-20 rounded-none border-x-0 border-b-0 bg-background/35 px-5 backdrop-blur-xl",
        )}>
          {snapshot ? <>
          <Button
            size="icon"
            variant="secondary"
            aria-label={snapshot.paused ? "Play" : "Pause"}
            onClick={() => updateSnapshot(libraryClient.mpvPaused(snapshot.sessionId, !snapshot.paused))}
          >
            {snapshot.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          </Button>
          <span className="w-24 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
            {formatDuration(snapshot.positionSeconds)} / {formatDuration(snapshot.durationSeconds)}
          </span>
          <input
            aria-label="Playback position"
            type="range"
            min={0}
            max={Math.max(snapshot.durationSeconds ?? 0, 1)}
            step={0.1}
            value={Math.min(snapshot.positionSeconds, snapshot.durationSeconds ?? snapshot.positionSeconds)}
            onChange={(event) => updateSnapshot(libraryClient.mpvSeek(snapshot.sessionId, Number(event.target.value)))}
            className="h-2 min-w-0 flex-1 cursor-pointer accent-white"
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label={snapshot.muted ? "Unmute" : "Mute"}
            onClick={() => updateSnapshot(libraryClient.mpvMuted(snapshot.sessionId, !snapshot.muted))}
          >
            {snapshot.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>
          <input
            aria-label="Volume"
            type="range"
            min={0}
            max={100}
            value={snapshot.volume}
            onChange={(event) => updateSnapshot(libraryClient.mpvVolume(snapshot.sessionId, Number(event.target.value)))}
            className="h-2 w-24 cursor-pointer accent-white"
          />
          {snapshot.audioTracks.length > 1 ? (
            <div className="flex min-w-0 max-w-[min(30rem,38vw)] items-center gap-2" role="group" aria-label="Included audio tracks">
              <Headphones className="size-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5">
                {snapshot.audioTracks.map((track, index) => (
                  <label key={track.id} className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-white/[.09] bg-white/[.035] px-2.5 py-2 text-xs text-white/75 transition hover:bg-white/[.07]">
                    <input
                      type="checkbox"
                      checked={track.selected}
                      disabled={track.selected && selectedAudioIds.length === 1}
                      onChange={(event) => toggleAudioTrack(track.id, event.target.checked)}
                      className="size-3.5 accent-white"
                    />
                    <span>{track.title ?? track.language ?? `Audio ${index + 1}`}</span>
                    {track.codec ? <span className="text-[10px] uppercase text-muted-foreground">{track.codec}</span> : null}
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <Button size="icon" variant="ghost" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen (F)"} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
          </> : <div className="flex w-full items-center justify-center gap-2 text-xs text-muted-foreground"><Spinner /> Loading player …</div>}
        </div>
      ) : null}
    </div>
  );
}

function ManagedVideo({ src, poster }: { src: string; poster: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLVideoElement>(null);
  const resumeWhenVisibleRef = useRef(false);
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [suspended, setSuspended] = useState(false);

  useEffect(() => {
    const video = ref.current;
    const container = containerRef.current;
    if (!video || !container) return;

    const observer = new IntersectionObserver(([entry]) => {
      const root = entry.rootBounds;
      const rect = entry.boundingClientRect;
      const completelyOutside = root
        ? rect.bottom <= root.top || rect.top >= root.bottom || rect.right <= root.left || rect.left >= root.right
        : !entry.isIntersecting;

      if (completelyOutside) {
        resumeWhenVisibleRef.current = !video.paused;
        setSuspended(true);
        video.pause();
      } else {
        setSuspended(false);
        if (resumeWhenVisibleRef.current) {
          resumeWhenVisibleRef.current = false;
          void video.play().catch(() => undefined);
        }
      }
    }, { threshold: [0, 0.001] });
    observer.observe(container);

    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === container);
    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      observer.disconnect();
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);

  const togglePlayback = () => {
    const video = ref.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void container.requestFullscreen();
  };

  return (
    <div ref={containerRef} className="group/html-video absolute inset-0 isolate overflow-hidden bg-black">
      {poster ? <img src={poster} alt="" className="absolute inset-0 size-full object-contain" /> : null}
      <video
        ref={ref}
        src={src}
        poster={poster ?? undefined}
        preload="metadata"
        autoPlay
        onClick={togglePlayback}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume);
          setMuted(event.currentTarget.muted);
        }}
        className={cn(
          "relative z-10 size-full cursor-pointer bg-transparent object-contain transform-gpu [backface-visibility:hidden]",
          suspended && "invisible",
        )}
      />
      <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/55 via-black/15 to-transparent px-3 pb-3 pt-12 sm:px-4">
        <input
          aria-label="Playback position"
          type="range"
          min={0}
          max={Math.max(duration, 1)}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (ref.current) ref.current.currentTime = next;
            setCurrentTime(next);
          }}
          className="video-control-range w-full"
        />
        <div className="mt-1 flex items-center gap-2">
          <Button type="button" size="icon" variant="ghost" className="shrink-0 bg-transparent text-white opacity-100 hover:bg-white/10" aria-label={paused ? "Play" : "Pause"} onClick={togglePlayback}>
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          </Button>
          <span className="shrink-0 text-xs tabular-nums text-white/85">
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>
          <div className="min-w-2 flex-1" />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="shrink-0 bg-transparent text-white opacity-100 hover:bg-white/10"
            aria-label={muted ? "Unmute" : "Mute"}
            onClick={() => {
              if (ref.current) ref.current.muted = !ref.current.muted;
            }}
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>
          <input
            aria-label="Volume"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (ref.current) {
                ref.current.volume = next;
                ref.current.muted = false;
              }
              setVolume(next);
            }}
            className="video-control-range hidden w-20 sm:block"
          />
          <Button type="button" size="icon" variant="ghost" className="shrink-0 bg-transparent text-white opacity-100 hover:bg-white/10" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
