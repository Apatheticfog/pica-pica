import { AlertCircle, ChevronLeft, ChevronRight, Film, LayoutGrid, Maximize2, Minimize2, MonitorPlay, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ClipCard } from "@/components/library/ClipCard";
import { GameArtwork } from "@/components/library/GameArtwork";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { libraryClient } from "@/data/library-client";
import { cn, formatBytes, formatDate, formatDuration } from "@/lib/utils";
import type { Clip, Game } from "@/types/library";
import type { MpvAvailability, MpvSnapshot } from "@/types/player";

let nextPlayerSession = 0;
const FULLSCREEN_CONTROLS_HIDE_DELAY = 1_400;
const FULLSCREEN_CONTROLS_FADE_DURATION = 220;

type SeekDraft = {
  sessionId: number;
  value: number;
  phase: "dragging" | "queued" | "settling";
  operationId: number;
};

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

export function VideoPlayer({ game, clips, totalCount, selected, hasMore, loadingMore, playerActive = true, onLoadMore, onSelect }: VideoPlayerProps) {
  const recentClips = clips.slice(0, 12);
  const showQueue = totalCount > 1;
  const [playerSurfaceHeight, setPlayerSurfaceHeight] = useState<number | null>(null);
  const aspectRatio = selected?.width && selected.height ? `${selected.width} / ${selected.height}` : "16 / 9";
  const selectedIndex = selected ? clips.findIndex((clip) => clip.id === selected.id) : -1;
  const previousClip = selectedIndex > 0 ? clips[selectedIndex - 1] : null;
  const nextClip = selectedIndex >= 0 ? clips[selectedIndex + 1] ?? null : null;

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
      document.getElementById("clip-player")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div>
    <div id="clip-player" className={`mx-auto grid w-full scroll-mt-24 max-w-[min(100%,calc(177.78vh+102px))] items-start gap-5 ${showQueue ? "xl:grid-cols-[minmax(0,1fr)_clamp(340px,20vw,480px)]" : ""}`}>
      <div className="min-w-0">
        <NativeMpvPlayer
          game={game}
          selected={selected}
          active={playerActive}
          aspectRatio={aspectRatio}
          previousClip={previousClip}
          nextAvailable={Boolean(nextClip || hasMore)}
          navigationPending={loadingMore}
          onPrevious={() => previousClip && onSelect(previousClip)}
          onNext={() => void selectNextClip()}
          onSurfaceHeight={setPlayerSurfaceHeight}
        />
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

      {showQueue ? <aside data-clip-queue style={{ height: playerSurfaceHeight ?? undefined }} className="hidden min-w-0 flex-col overflow-hidden rounded-[1.35rem] border border-white/[.08] bg-white/[.025] p-3 xl:flex">
        <div className="flex shrink-0 items-center justify-between px-2 pb-3 pt-1">
          <div className="flex items-center gap-2 text-sm font-semibold"><Film className="size-4 text-primary" /> Recent clips</div>
          <span className="text-xs text-muted-foreground">{Math.min(totalCount, 12)} of {totalCount}</span>
        </div>
        <div className="grid min-h-0 gap-2 sm:grid-cols-2 xl:auto-rows-max xl:flex-1 xl:content-start xl:grid-cols-1 xl:overflow-y-auto xl:overscroll-contain xl:pr-1">
          {recentClips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} game={game} active={clip.id === selected?.id} onSelect={() => onSelect(clip)} />
          ))}
        </div>
      </aside> : null}
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

interface NativeMpvPlayerProps {
  game: Game;
  selected: Clip | null;
  active: boolean;
  aspectRatio: string;
  previousClip: Clip | null;
  nextAvailable: boolean;
  navigationPending: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onSurfaceHeight: (height: number) => void;
}

function NativeMpvPlayer({ game, selected, active, aspectRatio, previousClip, nextAvailable, navigationPending, onPrevious, onNext, onSurfaceHeight }: NativeMpvPlayerProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const snapshotEpochRef = useRef(0);
  const viewportUpdateRef = useRef<() => void>(() => undefined);
  const nextOperationIdRef = useRef(0);
  const latestSeekOperationRef = useRef(0);
  const volumeRequestRef = useRef(0);
  const previewSeekTimerRef = useRef<number | null>(null);
  const seekSettleTimerRef = useRef<number | null>(null);
  const pendingPreviewSeekRef = useRef<{ sessionId: number; value: number; operationId: number } | null>(null);
  const pendingExactSeekRef = useRef<{ sessionId: number; value: number; operationId: number } | null>(null);
  const seekCommandInFlightRef = useRef(false);
  const [availability, setAvailability] = useState<MpvAvailability | null>(null);
  const [playback, setPlayback] = useState<{ clipId: string; sessionId: number; snapshot: MpvSnapshot | null; error: string | null } | null>(null);
  const [fallback, setFallback] = useState<{ clipId: string; url: string | null; preparing: boolean; error: string | null } | null>(null);
  const [htmlVideoFailure, setHtmlVideoFailure] = useState<{ clipId: string; message: string } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsHeight, setControlsHeight] = useState(96);
  const [fullscreenControlsVisible, setFullscreenControlsVisible] = useState(true);
  const [fullscreenControlsReserved, setFullscreenControlsReserved] = useState(true);
  const fullscreenControlsTimerRef = useRef<number | null>(null);
  const fullscreenClipReleaseTimerRef = useRef<number | null>(null);
  const [seekDraft, setSeekDraft] = useState<SeekDraft | null>(null);
  const [volumeDraft, setVolumeDraft] = useState<{ sessionId: number; value: number } | null>(null);
  const current = playback?.clipId === selected?.id ? playback : null;
  const snapshot = current?.snapshot ?? null;
  const playerReady = Boolean(snapshot);
  const error = current?.error ?? null;
  const preparedFallbackUrl = fallback && fallback.clipId === selected?.id ? fallback.url : null;
  const fallbackUrl = preparedFallbackUrl;
  const fallbackPreparing = Boolean(fallback && fallback.clipId === selected?.id && fallback.preparing);
  const fallbackError = fallback && fallback.clipId === selected?.id ? fallback.error : null;
  const htmlVideoError = htmlVideoFailure && htmlVideoFailure.clipId === selected?.id ? htmlVideoFailure.message : null;
  const playerError = error ?? fallbackError ?? htmlVideoError;
  const posterUrl = libraryClient.assetUrl(selected?.thumbnailPath ?? null);
  const gameHeroUrl = libraryClient.assetUrl(game.heroPath);
  const viewportConfigRef = useRef({
    active,
    controlsHeight,
    fullscreen,
    fullscreenControlsReserved,
  });

  const clearFullscreenControlTimers = useCallback(() => {
    if (fullscreenControlsTimerRef.current !== null) {
      window.clearTimeout(fullscreenControlsTimerRef.current);
      fullscreenControlsTimerRef.current = null;
    }
    if (fullscreenClipReleaseTimerRef.current !== null) {
      window.clearTimeout(fullscreenClipReleaseTimerRef.current);
      fullscreenClipReleaseTimerRef.current = null;
    }
  }, []);

  const hideFullscreenControls = useCallback(() => {
    setFullscreenControlsVisible(false);
    if (fullscreenClipReleaseTimerRef.current !== null) window.clearTimeout(fullscreenClipReleaseTimerRef.current);
    fullscreenClipReleaseTimerRef.current = window.setTimeout(() => {
      setFullscreenControlsReserved(false);
      fullscreenClipReleaseTimerRef.current = null;
    }, FULLSCREEN_CONTROLS_FADE_DURATION);
  }, []);

  const scheduleFullscreenControlsHide = useCallback(() => {
    if (fullscreenControlsTimerRef.current !== null) window.clearTimeout(fullscreenControlsTimerRef.current);
    fullscreenControlsTimerRef.current = null;
    if (!snapshot?.paused) {
      fullscreenControlsTimerRef.current = window.setTimeout(() => {
        hideFullscreenControls();
        fullscreenControlsTimerRef.current = null;
      }, FULLSCREEN_CONTROLS_HIDE_DELAY);
    }
  }, [hideFullscreenControls, snapshot?.paused]);

  const resetFullscreenControls = useCallback(() => {
    clearFullscreenControlTimers();
    setFullscreenControlsReserved(true);
    setFullscreenControlsVisible(true);
  }, [clearFullscreenControlTimers]);

  const revealFullscreenControls = useCallback(() => {
    if (!fullscreen) return;
    if (fullscreenClipReleaseTimerRef.current !== null) {
      window.clearTimeout(fullscreenClipReleaseTimerRef.current);
      fullscreenClipReleaseTimerRef.current = null;
    }
    setFullscreenControlsReserved(true);
    setFullscreenControlsVisible(true);
    scheduleFullscreenControlsHide();
  }, [fullscreen, scheduleFullscreenControlsHide]);

  const holdFullscreenControls = useCallback(() => {
    if (!fullscreen) return;
    clearFullscreenControlTimers();
    setFullscreenControlsReserved(true);
    setFullscreenControlsVisible(true);
  }, [clearFullscreenControlTimers, fullscreen]);
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
    if (!selected || availability?.available || !availability?.fallbackAvailable) {
      return;
    }

    let mounted = true;
    let objectUrl: string | null = null;
    void Promise.resolve().then(async () => {
      if (!mounted) return;
      setFallback({ clipId: selected.id, url: null, preparing: true, error: null });
      try {
        const path = selected.compatible
          ? selected.path
          : await libraryClient.prepareCompatibleClip(selected.id);
        const assetUrl = libraryClient.assetUrl(path);
        if (!assetUrl) throw new Error("Pica Pica could not create a local playback URL.");
        const response = await fetch(assetUrl);
        if (!response.ok) throw new Error(`Pica Pica could not read the local clip (${response.status}).`);
        objectUrl = URL.createObjectURL(await response.blob());
        if (mounted) {
          setFallback({ clipId: selected.id, url: objectUrl, preparing: false, error: null });
        } else {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
      } catch (cause) {
        if (mounted) {
          setFallback({
            clipId: selected.id,
            url: null,
            preparing: false,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    });
    return () => {
      mounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [availability?.available, availability?.fallbackAvailable, selected]);

  useLayoutEffect(() => {
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
    snapshotEpochRef.current += 1;
    volumeRequestRef.current += 1;
    if (previewSeekTimerRef.current !== null) window.clearTimeout(previewSeekTimerRef.current);
    if (seekSettleTimerRef.current !== null) window.clearTimeout(seekSettleTimerRef.current);
    previewSeekTimerRef.current = null;
    seekSettleTimerRef.current = null;
    pendingPreviewSeekRef.current = null;
    pendingExactSeekRef.current = null;
    latestSeekOperationRef.current = 0;
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
      if (previewSeekTimerRef.current !== null) window.clearTimeout(previewSeekTimerRef.current);
      if (seekSettleTimerRef.current !== null) window.clearTimeout(seekSettleTimerRef.current);
      previewSeekTimerRef.current = null;
      seekSettleTimerRef.current = null;
      pendingPreviewSeekRef.current = null;
      pendingExactSeekRef.current = null;
      void libraryClient.mpvStop(sessionId).catch(() => undefined);
    };
  }, [availability?.available, selected]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Tab" && fullscreen && !fullscreenControlsVisible) {
        event.preventDefault();
        resetFullscreenControls();
        return;
      }
      if (event.key === "Escape" && fullscreen) {
        void libraryClient.setFullscreen(false).then(() => {
          setFullscreen(false);
          resetFullscreenControls();
        });
      } else if (event.key.toLocaleLowerCase() === "f" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
        const next = !fullscreen;
        void libraryClient.setFullscreen(next).then(() => {
          setFullscreen(next);
          resetFullscreenControls();
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen, fullscreenControlsVisible, resetFullscreenControls]);

  useEffect(() => () => {
    clearFullscreenControlTimers();
    if (fullscreen) void libraryClient.setFullscreen(false);
  }, [clearFullscreenControlTimers, fullscreen]);

  useEffect(() => {
    if (fullscreenControlsTimerRef.current !== null) window.clearTimeout(fullscreenControlsTimerRef.current);
    fullscreenControlsTimerRef.current = null;
    const controlsAreActive = controlsRef.current?.matches(":hover, :focus-within") ?? false;
    if (fullscreen && !snapshot?.paused && !controlsAreActive) {
      fullscreenControlsTimerRef.current = window.setTimeout(() => {
        hideFullscreenControls();
        fullscreenControlsTimerRef.current = null;
      }, FULLSCREEN_CONTROLS_HIDE_DELAY);
    }
    return () => {
      if (fullscreenControlsTimerRef.current !== null) {
        window.clearTimeout(fullscreenControlsTimerRef.current);
        fullscreenControlsTimerRef.current = null;
      }
    };
  }, [fullscreen, hideFullscreenControls, snapshot?.paused]);

  useEffect(() => {
    if (!current?.sessionId || !playerReady) return;
    let mounted = true;
    let pollTimer: number | null = null;
    const poll = () => {
      const snapshotEpoch = snapshotEpochRef.current;
      void libraryClient
        .mpvSnapshot()
        .then((result) => {
          if (mounted && snapshotEpoch === snapshotEpochRef.current && result.sessionId === current.sessionId) {
            setPlayback((value) => value?.sessionId === current.sessionId ? { ...value, snapshot: result } : value);
            setSeekDraft((draft) => {
              if (!draft || draft.phase !== "settling" || draft.sessionId !== result.sessionId || result.seeking) return draft;
              return null;
            });
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (mounted) pollTimer = window.setTimeout(poll, 350);
        });
    };
    pollTimer = window.setTimeout(poll, 350);
    return () => {
      mounted = false;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
    };
  }, [current?.sessionId, playerReady]);

  useEffect(() => {
    viewportConfigRef.current = {
      active,
      controlsHeight,
      fullscreen,
      fullscreenControlsReserved,
    };
    viewportUpdateRef.current();
  }, [active, controlsHeight, fullscreen, fullscreenControlsReserved]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !availability?.available || !current?.sessionId || !playerReady) {
      void libraryClient.mpvViewport({ x: 0, y: 0, width: 0, height: 0, visible: false, cornerRadius: 0, clipTop: 0, clipBottom: 0 }).catch(() => undefined);
      return;
    }
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const config = viewportConfigRef.current;
        const rect = surface.getBoundingClientRect();
        const scale = window.devicePixelRatio || 1;
        const visibleLeft = Math.max(rect.left, 0);
        const visibleTop = Math.max(rect.top, config.fullscreen ? 0 : 69);
        const visibleRight = Math.min(rect.right, window.innerWidth);
        const visibleBottom = Math.min(rect.bottom, window.innerHeight);
        const visibleArea = Math.max(0, visibleRight - visibleLeft) * Math.max(0, visibleBottom - visibleTop);
        const fullscreenClipBottom = config.fullscreenControlsReserved
          ? Math.round(config.controlsHeight * scale)
          : Math.max(1, Math.round(2 * scale));
        void libraryClient.mpvViewport({
          x: Math.round(rect.left * scale),
          y: Math.round(rect.top * scale),
          width: Math.round(Math.max(0, rect.width) * scale),
          height: Math.round(Math.max(0, rect.height) * scale),
          visible: config.active && (config.fullscreen || visibleArea > 0),
          cornerRadius: config.fullscreen ? 0 : Math.round(22 * scale),
          clipTop: config.fullscreen ? 0 : Math.round(Math.max(0, 69 - rect.top) * scale),
          clipBottom: config.fullscreen ? fullscreenClipBottom : 0,
        }).catch(() => undefined);
      });
    };
    viewportUpdateRef.current = update;
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
      viewportUpdateRef.current = () => undefined;
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      void libraryClient.mpvViewport({ x: 0, y: 0, width: 0, height: 0, visible: false, cornerRadius: 0, clipTop: 0, clipBottom: 0 }).catch(() => undefined);
    };
  }, [availability?.available, current?.sessionId, playerReady]);

  const updateSnapshot = (operation: Promise<MpvSnapshot>) => {
    const sessionId = current?.sessionId;
    if (!sessionId) return;
    snapshotEpochRef.current += 1;
    void operation
      .then((result) => {
        snapshotEpochRef.current += 1;
        if (result.sessionId === sessionId) {
          setPlayback((value) => value?.sessionId === sessionId ? { ...value, snapshot: result, error: null } : value);
        }
      })
      .catch((cause) => {
        snapshotEpochRef.current += 1;
        setPlayback((value) => value?.sessionId === sessionId ? { ...value, error: cause instanceof Error ? cause.message : String(cause) } : value);
      });
  };

  const activeSeekDraft = seekDraft && seekDraft.sessionId === snapshot?.sessionId ? seekDraft.value : null;
  const activeVolumeDraft = volumeDraft && volumeDraft.sessionId === snapshot?.sessionId ? volumeDraft.value : null;

  const holdSeekPosition = (sessionId: number, value: number, phase: SeekDraft["phase"], operationId: number) => {
    setSeekDraft({ sessionId, value, phase, operationId });
    if (seekSettleTimerRef.current !== null) window.clearTimeout(seekSettleTimerRef.current);
    seekSettleTimerRef.current = window.setTimeout(() => {
      setSeekDraft((draft) => draft?.sessionId === sessionId && draft.operationId === operationId ? null : draft);
      seekSettleTimerRef.current = null;
    }, 5_000);
  };

  const markSeekSettling = (sessionId: number, operationId: number) => {
    setSeekDraft((draft) => draft?.sessionId === sessionId
      && draft.phase === "queued"
      && draft.operationId === operationId
      ? { ...draft, phase: "settling" }
      : draft);
  };

  const reportPlayerError = (sessionId: number, cause: unknown) => {
    setPlayback((currentPlayback) => currentPlayback?.sessionId === sessionId
      ? { ...currentPlayback, error: cause instanceof Error ? cause.message : String(cause) }
      : currentPlayback);
  };

  const schedulePreviewSeek = () => {
    if (previewSeekTimerRef.current !== null || pendingExactSeekRef.current || seekCommandInFlightRef.current) return;
    previewSeekTimerRef.current = window.setTimeout(() => {
      previewSeekTimerRef.current = null;
      drainSeekQueue();
    }, 75);
  };

  const drainSeekQueue = () => {
    if (seekCommandInFlightRef.current) return;
    const exact = pendingExactSeekRef.current;
    if (exact) {
      pendingExactSeekRef.current = null;
      pendingPreviewSeekRef.current = null;
      seekCommandInFlightRef.current = true;
      snapshotEpochRef.current += 1;
      void libraryClient
        .mpvSeek(exact.sessionId, exact.value)
        .then(() => {
          snapshotEpochRef.current += 1;
          if (latestSeekOperationRef.current !== exact.operationId) return;
          setPlayback((currentPlayback) => currentPlayback?.sessionId === exact.sessionId ? { ...currentPlayback, error: null } : currentPlayback);
          markSeekSettling(exact.sessionId, exact.operationId);
        })
        .catch((cause) => {
          snapshotEpochRef.current += 1;
          if (latestSeekOperationRef.current !== exact.operationId) return;
          reportPlayerError(exact.sessionId, cause);
          setSeekDraft((draft) => draft?.sessionId === exact.sessionId
            && draft.phase === "queued"
            && draft.operationId === exact.operationId
            ? null
            : draft);
        })
        .finally(() => {
          seekCommandInFlightRef.current = false;
          if (pendingExactSeekRef.current) drainSeekQueue();
          else if (pendingPreviewSeekRef.current) schedulePreviewSeek();
        });
      return;
    }

    const preview = pendingPreviewSeekRef.current;
    if (!preview) return;
    pendingPreviewSeekRef.current = null;
    seekCommandInFlightRef.current = true;
    snapshotEpochRef.current += 1;
    void libraryClient
      .mpvPreviewSeek(preview.sessionId, preview.value)
      .then(() => {
        snapshotEpochRef.current += 1;
      })
      .catch((cause) => {
        snapshotEpochRef.current += 1;
        if (latestSeekOperationRef.current !== preview.operationId) return;
        reportPlayerError(preview.sessionId, cause);
        setSeekDraft((draft) => draft?.sessionId === preview.sessionId && draft.operationId === preview.operationId ? null : draft);
      })
      .finally(() => {
        seekCommandInFlightRef.current = false;
        if (pendingExactSeekRef.current) drainSeekQueue();
        else if (pendingPreviewSeekRef.current) schedulePreviewSeek();
      });
  };

  const previewSeek = (value: number) => {
    if (!snapshot) return;
    const sessionId = snapshot.sessionId;
    const operationId = ++nextOperationIdRef.current;
    latestSeekOperationRef.current = operationId;
    snapshotEpochRef.current += 1;
    holdSeekPosition(sessionId, value, "dragging", operationId);
    pendingPreviewSeekRef.current = { sessionId, value, operationId };
    schedulePreviewSeek();
  };

  const commitSeek = (value: number) => {
    if (!snapshot) return;
    const sessionId = snapshot.sessionId;
    const operationId = ++nextOperationIdRef.current;
    latestSeekOperationRef.current = operationId;
    if (previewSeekTimerRef.current !== null) window.clearTimeout(previewSeekTimerRef.current);
    previewSeekTimerRef.current = null;
    pendingPreviewSeekRef.current = null;
    pendingExactSeekRef.current = { sessionId, value, operationId };
    snapshotEpochRef.current += 1;
    holdSeekPosition(sessionId, value, "queued", operationId);
    drainSeekQueue();
  };

  const commitVolume = (value: number) => {
    if (!snapshot) return;
    const sessionId = snapshot.sessionId;
    const requestId = ++volumeRequestRef.current;
    snapshotEpochRef.current += 1;
    setVolumeDraft({ sessionId, value });
    void libraryClient
      .mpvVolume(sessionId, value)
      .then((result) => {
        snapshotEpochRef.current += 1;
        if (result.sessionId === sessionId) {
          setPlayback((currentPlayback) => currentPlayback?.sessionId === sessionId ? { ...currentPlayback, snapshot: result, error: null } : currentPlayback);
        }
      })
      .catch((cause) => {
        snapshotEpochRef.current += 1;
        setPlayback((currentPlayback) => currentPlayback?.sessionId === sessionId ? { ...currentPlayback, error: cause instanceof Error ? cause.message : String(cause) } : currentPlayback);
      })
      .finally(() => {
        if (volumeRequestRef.current === requestId) setVolumeDraft((draft) => draft?.sessionId === sessionId ? null : draft);
      });
  };

  const toggleFullscreen = () => {
    const next = !fullscreen;
    void libraryClient
      .setFullscreen(next)
      .then(() => {
        setFullscreen(next);
        resetFullscreenControls();
      })
      .catch(() => undefined);
  };

  return (
    <div>
      <div
        ref={surfaceRef}
        data-player-surface
        onPointerMove={revealFullscreenControls}
        style={{ aspectRatio: fullscreen ? "auto" : aspectRatio }}
        className={cn(
          "group/player relative overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#050506] shadow-[0_24px_80px_rgba(0,0,0,.35)]",
          fullscreen && "fixed inset-0 z-[100] rounded-none border-0 shadow-none",
        )}
      >
        {!availability ? (
          <div className="absolute inset-0 grid place-items-center"><Spinner className="size-6" /></div>
        ) : !availability.available && availability.fallbackAvailable && fallbackUrl && !htmlVideoError ? (
          <ManagedVideo
            key={fallbackUrl}
            src={fallbackUrl}
            poster={posterUrl}
            knownDuration={selected?.durationSeconds ?? null}
            onError={(message) => selected && setHtmlVideoFailure({ clipId: selected.id, message })}
          />
        ) : !availability.available && fallbackPreparing ? (
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex items-center gap-3 text-sm text-white/65"><Spinner /> Preparing an H.264 playback copy …</div>
          </div>
        ) : !availability.available || playerError || !selected ? (
          <>
            <GameArtwork title={game.title} start={game.accentStart} end={game.accentEnd} variant="hero" imageUrl={gameHeroUrl} className="absolute inset-0 size-full opacity-45" />
            <div className="absolute inset-0 bg-black/60" />
            <div className="absolute inset-0 grid place-items-center px-8 text-center">
              <div className="max-w-lg">
                {playerError || !availability.available ? <AlertCircle className="mx-auto size-8 text-amber-300" /> : <MonitorPlay className="mx-auto size-9 text-white/75" />}
                <p className="mt-4 text-base font-semibold">
                  {playerError ? availability.available ? "libmpv could not play this clip" : "Linux could not play this clip" : selected && !availability.fallbackAvailable ? "Linux video support is incomplete" : selected ? "Embedded libmpv is unavailable" : "Choose a local clip"}
                </p>
                <p className="mt-2 text-xs leading-5 text-white/50">
                  {playerError
                    ?? availability.fallbackDiagnostic
                    ?? availability.diagnostic
                    ?? "Choose a clip from Recent clips or the grid below to start playback."}
                </p>
              </div>
            </div>
          </>
        ) : !current?.snapshot ? (
          <div className="absolute inset-0 grid place-items-center"><div className="flex items-center gap-3 text-sm text-white/60"><Spinner /> Starting libmpv …</div></div>
        ) : null}
      </div>

      {availability?.available ? (
        <div
          ref={controlsRef}
          onPointerEnter={holdFullscreenControls}
          onPointerMove={holdFullscreenControls}
          onPointerLeave={revealFullscreenControls}
          onFocusCapture={holdFullscreenControls}
          onBlurCapture={revealFullscreenControls}
          aria-hidden={fullscreen && !fullscreenControlsVisible}
          inert={fullscreen && !fullscreenControlsVisible}
          className={cn(
            "mt-3 flex min-h-24 flex-col gap-3 rounded-2xl border border-white/[.08] bg-white/[.025] p-3",
            fullscreen && "fixed inset-x-0 bottom-0 z-[101] m-0 rounded-none border-0 bg-gradient-to-t from-black via-black/95 to-black/45 px-5 pb-5 pt-9 transition duration-200",
            fullscreen && !fullscreenControlsVisible && "pointer-events-none translate-y-3 opacity-0",
          )}
        >
          {snapshot ? (
            <>
              <Slider
                aria-label="Playback position"
                min={0}
                max={Math.max(snapshot.durationSeconds ?? 0, 1)}
                step={0.1}
                value={[Math.min(activeSeekDraft ?? snapshot.positionSeconds, snapshot.durationSeconds ?? activeSeekDraft ?? snapshot.positionSeconds)]}
                aria-valuetext={`${formatDuration(activeSeekDraft ?? snapshot.positionSeconds)} of ${formatDuration(snapshot.durationSeconds)}`}
                onValueChange={([value]) => previewSeek(value)}
                onValueCommit={([value]) => commitSeek(value)}
                className="h-4"
              />
              <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Previous clip"
                  title={previousClip ? `Previous: ${previousClip.fileName}` : "No previous clip"}
                  disabled={!previousClip}
                  onClick={onPrevious}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="secondary"
                  aria-label={snapshot.paused ? "Play" : "Pause"}
                  onClick={() => updateSnapshot(libraryClient.mpvPaused(snapshot.sessionId, !snapshot.paused))}
                >
                  {snapshot.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Next clip"
                  title={nextAvailable ? "Next clip" : "No next clip"}
                  disabled={!nextAvailable || navigationPending}
                  onClick={onNext}
                >
                  {navigationPending ? <Spinner className="size-4" /> : <ChevronRight className="size-4" />}
                </Button>
                <span className="w-28 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                  {formatDuration(activeSeekDraft ?? snapshot.positionSeconds)} / {formatDuration(snapshot.durationSeconds)}
                </span>
                <div className="min-w-2 flex-1" />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={snapshot.muted ? "Unmute" : "Mute"}
                  onClick={() => updateSnapshot(libraryClient.mpvMuted(snapshot.sessionId, !snapshot.muted))}
                >
                  {snapshot.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                </Button>
                <Slider
                  aria-label="Volume"
                  min={0}
                  max={100}
                  step={1}
                  value={[activeVolumeDraft ?? snapshot.volume]}
                  onValueChange={([value]) => setVolumeDraft({ sessionId: snapshot.sessionId, value })}
                  onValueCommit={([value]) => commitVolume(value)}
                  className="w-24 shrink-0"
                />
                <Button size="icon" variant="ghost" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen (F)"} onClick={toggleFullscreen}>
                  {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </Button>
              </div>
            </>
          ) : <div className="flex w-full flex-1 items-center justify-center gap-2 text-xs text-muted-foreground"><Spinner /> Loading player …</div>}
        </div>
      ) : null}
      {fullscreen && !fullscreenControlsVisible ? (
        <div
          aria-hidden="true"
          className="fixed inset-x-0 bottom-0 z-[102] h-0.5"
          onPointerEnter={revealFullscreenControls}
        />
      ) : null}
    </div>
  );
}

function ManagedVideo({ src, poster, knownDuration, onError }: { src: string; poster: string | null; knownDuration: number | null; onError: (message: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLVideoElement>(null);
  const resumeWhenVisibleRef = useRef(false);
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(knownDuration ?? 0);
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
        onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : (knownDuration ?? 0))}
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : (knownDuration ?? 0))}
        onError={(event) => {
          const code = event.currentTarget.error?.code;
          onError(`The WebKit video backend rejected the prepared clip${code ? ` (media error ${code})` : ""}.`);
        }}
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
