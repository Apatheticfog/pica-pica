import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { libraryClient } from "@/data/library-client";
import { cn, formatDuration } from "@/lib/utils";
import type { Clip } from "@/types/library";

const CONTROLS_HIDE_DELAY = 1_500;

interface HtmlVideoPlayerProps {
  clip: Clip;
  src: string;
  poster: string | null;
  active: boolean;
  previousClip: Clip | null;
  nextAvailable: boolean;
  navigationPending: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPlaybackError: (message: string) => void;
  onSurfaceHeight: (height: number) => void;
}

export function HtmlVideoPlayer({
  clip,
  src,
  poster,
  active,
  previousClip,
  nextAvailable,
  navigationPending,
  onPrevious,
  onNext,
  onPlaybackError,
  onSurfaceHeight,
}: HtmlVideoPlayerProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const previewSeekFrameRef = useRef<number | null>(null);
  const pendingPreviewSeekRef = useRef<number | null>(null);
  const seekSettleTimerRef = useRef<number | null>(null);
  const seekingInteractionRef = useRef(false);
  const controlsTimerRef = useRef<number | null>(null);
  const seekTargetRef = useRef<number | null>(null);
  const fullscreenRef = useRef(false);
  const [duration, setDuration] = useState(clip.durationSeconds ?? 0);
  const [position, setPosition] = useState(0);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [paused, setPaused] = useState(true);
  const [waiting, setWaiting] = useState(true);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  const clearControlsTimer = useCallback(() => {
    if (controlsTimerRef.current === null) return;
    window.clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = null;
  }, []);

  const scheduleControlsHide = useCallback(() => {
    clearControlsTimer();
    if (paused) {
      setControlsVisible(true);
      return;
    }
    controlsTimerRef.current = window.setTimeout(() => {
      const controlsActive = controlsRef.current?.matches(":hover, :focus-within") ?? false;
      if (!controlsActive) setControlsVisible(false);
      controlsTimerRef.current = null;
    }, CONTROLS_HIDE_DELAY);
  }, [clearControlsTimer, paused]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleControlsHide();
  }, [scheduleControlsHide]);

  const holdControls = useCallback(() => {
    clearControlsTimer();
    setControlsVisible(true);
  }, [clearControlsTimer]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const reportHeight = () => onSurfaceHeight(surface.getBoundingClientRect().height);
    const observer = new ResizeObserver(reportHeight);
    observer.observe(surface);
    reportHeight();
    return () => observer.disconnect();
  }, [onSurfaceHeight]);

  useLayoutEffect(() => {
    if (previewSeekFrameRef.current !== null) window.cancelAnimationFrame(previewSeekFrameRef.current);
    if (seekSettleTimerRef.current !== null) window.clearTimeout(seekSettleTimerRef.current);
    previewSeekFrameRef.current = null;
    pendingPreviewSeekRef.current = null;
    seekSettleTimerRef.current = null;
    seekingInteractionRef.current = false;
    seekTargetRef.current = null;
  }, [clip.id, src]);

  useEffect(() => {
    fullscreenRef.current = fullscreen;
  }, [fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    document.documentElement.dataset.playerFullscreen = "true";
    return () => {
      delete document.documentElement.dataset.playerFullscreen;
    };
  }, [fullscreen]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || active) return;
    video.pause();
    if (fullscreen) {
      void libraryClient
        .setFullscreen(false)
        .then(() => {
          setFullscreen(false);
          setControlsVisible(true);
        })
        .catch(() => undefined);
    }
  }, [active, clip.id, fullscreen, src]);

  useEffect(() => {
    if (paused) {
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      return;
    }

    const updatePosition = () => {
      const video = videoRef.current;
      if (video && seekTargetRef.current === null) {
        setPosition((current) => Math.abs(current - video.currentTime) >= 0.015 ? video.currentTime : current);
      }
      animationFrameRef.current = window.requestAnimationFrame(updatePosition);
    };
    animationFrameRef.current = window.requestAnimationFrame(updatePosition);
    return () => {
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
  }, [paused]);

  useEffect(() => {
    clearControlsTimer();
    if (!paused) {
      controlsTimerRef.current = window.setTimeout(() => {
        const controlsActive = controlsRef.current?.matches(":hover, :focus-within") ?? false;
        if (!controlsActive) setControlsVisible(false);
        controlsTimerRef.current = null;
      }, CONTROLS_HIDE_DELAY);
    }
    return clearControlsTimer;
  }, [clearControlsTimer, fullscreen, paused]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !active
        || event.defaultPrevented
        || event.repeat
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
      ) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;

      if (event.key === "Escape" && fullscreen) {
        event.preventDefault();
        void libraryClient
          .setFullscreen(false)
          .then(() => {
            setFullscreen(false);
            setControlsVisible(true);
          })
          .catch(() => undefined);
        return;
      }

      if (event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        const next = !fullscreen;
        void libraryClient
          .setFullscreen(next)
          .then(() => {
            setFullscreen(next);
            setControlsVisible(true);
          })
          .catch(() => undefined);
      }
    };

    const onFullscreenChange = () => {
      if (libraryClient.isDesktop()) return;
      const next = document.fullscreenElement === document.documentElement;
      fullscreenRef.current = next;
      setFullscreen(next);
      if (!next) setControlsVisible(true);
    };

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [active, fullscreen]);

  useEffect(() => () => {
    clearControlsTimer();
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    if (previewSeekFrameRef.current !== null) window.cancelAnimationFrame(previewSeekFrameRef.current);
    if (seekSettleTimerRef.current !== null) window.clearTimeout(seekSettleTimerRef.current);
    if (fullscreenRef.current) void libraryClient.setFullscreen(false).catch(() => undefined);
  }, [clearControlsTimer]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  };

  const previewSeek = (value: number) => {
    if (!videoRef.current) return;
    seekingInteractionRef.current = true;
    seekTargetRef.current = value;
    setSeekDraft(value);
    setPosition(value);
    pendingPreviewSeekRef.current = value;
    if (previewSeekFrameRef.current !== null) return;
    previewSeekFrameRef.current = window.requestAnimationFrame(() => {
      previewSeekFrameRef.current = null;
      const video = videoRef.current;
      const target = pendingPreviewSeekRef.current;
      pendingPreviewSeekRef.current = null;
      if (video && target !== null) video.currentTime = target;
    });
  };

  const commitSeek = (value: number) => {
    const video = videoRef.current;
    if (!video) return;
    if (previewSeekFrameRef.current !== null) window.cancelAnimationFrame(previewSeekFrameRef.current);
    if (seekSettleTimerRef.current !== null) window.clearTimeout(seekSettleTimerRef.current);
    previewSeekFrameRef.current = null;
    pendingPreviewSeekRef.current = null;
    seekingInteractionRef.current = false;
    seekTargetRef.current = value;
    setSeekDraft(value);
    setPosition(value);
    video.currentTime = value;
    seekSettleTimerRef.current = window.setTimeout(() => {
      seekSettleTimerRef.current = null;
      settleSeek();
    }, 180);
  };

  const settleSeek = () => {
    const video = videoRef.current;
    const target = seekTargetRef.current;
    if (
      !video
      || seekingInteractionRef.current
      || target === null
      || Math.abs(video.currentTime - target) > 0.75
    ) return;
    seekTargetRef.current = null;
    setSeekDraft(null);
    setPosition(video.currentTime);
  };

  const updateVolume = (value: number) => {
    const video = videoRef.current;
    if (!video) return;
    const next = Math.max(0, Math.min(100, value));
    video.volume = next / 100;
    if (next > 0 && video.muted) video.muted = false;
    setVolume(next);
    setMuted(video.muted);
  };

  const toggleMuted = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  };

  const toggleFullscreen = () => {
    const next = !fullscreen;
    void libraryClient
      .setFullscreen(next)
      .then(() => {
        setFullscreen(next);
        setControlsVisible(true);
      })
      .catch(() => undefined);
  };

  const playbackPosition = seekDraft ?? position;

  return (
    <div
      ref={surfaceRef}
      data-player-surface
      onPointerEnter={revealControls}
      onPointerMove={revealControls}
      className={cn(
        "group/player relative aspect-video overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#050506] shadow-[0_24px_80px_rgba(0,0,0,.35)]",
        fullscreen && "fixed inset-0 z-[100] aspect-auto rounded-none border-0 shadow-none",
        fullscreen && !controlsVisible && "cursor-none",
      )}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster ?? undefined}
        preload="metadata"
        autoPlay={active}
        playsInline
        className="size-full bg-black object-contain"
        onClick={togglePlayback}
        onLoadStart={() => {
          setDuration(clip.durationSeconds ?? 0);
          setPosition(0);
          setSeekDraft(null);
          setPaused(true);
          setWaiting(true);
        }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          setDuration(Number.isFinite(video.duration) ? video.duration : clip.durationSeconds ?? 0);
          setPosition(0);
          setWaiting(false);
        }}
        onDurationChange={(event) => {
          const next = event.currentTarget.duration;
          if (Number.isFinite(next)) setDuration(next);
        }}
        onPlay={() => {
          setPaused(false);
          setWaiting(false);
        }}
        onPause={() => {
          setPaused(true);
          setControlsVisible(true);
        }}
        onPlaying={() => setWaiting(false)}
        onWaiting={() => setWaiting(true)}
        onSeeking={() => {
          if (!seekingInteractionRef.current) setWaiting(true);
        }}
        onSeeked={() => {
          setWaiting(false);
          settleSeek();
        }}
        onTimeUpdate={(event) => {
          if (seekTargetRef.current === null) setPosition(event.currentTarget.currentTime);
        }}
        onVolumeChange={(event) => {
          setVolume(Math.round(event.currentTarget.volume * 100));
          setMuted(event.currentTarget.muted);
        }}
        onError={(event) => {
          const mediaError = event.currentTarget.error;
          onPlaybackError(mediaError?.message || "This clip could not be decoded by the native HTML player.");
          setWaiting(false);
        }}
      />

      {waiting && seekDraft === null ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/10">
          <Spinner className="size-6 text-white" />
        </div>
      ) : null}

      <div
        aria-hidden={!controlsVisible}
        inert={!controlsVisible}
        className={cn(
          "absolute inset-x-0 bottom-0 z-10 p-3 sm:p-4",
          fullscreen && "px-[clamp(1rem,3vw,3rem)] pb-5",
          !controlsVisible && "pointer-events-none opacity-0",
          "transition-opacity duration-200 ease-out",
        )}
      >
        <div
          ref={controlsRef}
          onPointerEnter={holdControls}
          onPointerMove={holdControls}
          onPointerLeave={scheduleControlsHide}
          onFocusCapture={holdControls}
          onBlurCapture={scheduleControlsHide}
          className="mx-auto flex w-full max-w-[72rem] flex-col gap-2.5 rounded-2xl border border-white/15 bg-black/85 p-3 shadow-2xl"
        >
          <Slider
            aria-label="Playback position"
            min={0}
            max={Math.max(duration, 1)}
            step={0.05}
            value={[Math.min(playbackPosition, duration || playbackPosition)]}
            aria-valuetext={`${formatDuration(playbackPosition)} of ${formatDuration(duration)}`}
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
            <Button size="icon" variant="secondary" aria-label={paused ? "Play" : "Pause"} onClick={togglePlayback}>
              {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
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
            <span className="w-28 shrink-0 text-center text-xs tabular-nums text-white/65">
              {formatDuration(playbackPosition)} / {formatDuration(duration)}
            </span>
            <div className="min-w-2 flex-1" />
            <Button size="icon" variant="ghost" aria-label={muted ? "Unmute" : "Mute"} onClick={toggleMuted}>
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </Button>
            <Slider
              aria-label="Volume"
              min={0}
              max={100}
              step={1}
              value={[volume]}
              onValueChange={([value]) => updateVolume(value)}
              className="w-24 shrink-0"
            />
            <Button
              size="icon"
              variant="ghost"
              aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen (F)"}
              onClick={toggleFullscreen}
            >
              {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>
          </div>
        </div>
      </div>

      {fullscreen && !controlsVisible ? (
        <div aria-hidden="true" className="fixed inset-x-0 bottom-0 z-20 h-1" onPointerEnter={revealControls} />
      ) : null}
    </div>
  );
}
