import { AlertCircle, CheckCircle2, ExternalLink, ListVideo, MonitorPlay, Play } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GameArtwork } from "@/components/library/GameArtwork";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { libraryClient } from "@/data/library-client";
import type { Clip, Game } from "@/types/library";
import type {
  ExternalPlaybackSession,
  ExternalPlayer,
  ExternalPlayerAvailability,
} from "@/types/player";

interface ExternalPlayerPanelProps {
  game: Game;
  clip: Clip;
  poster: string | null;
  nativeError?: string | null;
  onSurfaceHeight: (height: number) => void;
}

interface ScopedLaunch {
  clipId: string;
  requestId: number;
  player: ExternalPlayer;
}

interface ScopedLaunchError {
  clipId: string;
  message: string;
}

interface ScopedSession {
  clipId: string;
  value: ExternalPlaybackSession;
}

export function ExternalPlayerPanel({ game, clip, poster, nativeError = null, onSurfaceHeight }: ExternalPlayerPanelProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const launchGenerationRef = useRef(0);
  const launchInFlightRef = useRef<number | null>(null);
  const [availability, setAvailability] = useState<ExternalPlayerAvailability | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [launching, setLaunching] = useState<ScopedLaunch | null>(null);
  const [launchError, setLaunchError] = useState<ScopedLaunchError | null>(null);
  const [session, setSession] = useState<ScopedSession | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const gameHeroUrl = libraryClient.assetUrl(game.heroPath);
  const currentLaunch = launching?.clipId === clip.id ? launching : null;
  const currentLaunchError = launchError?.clipId === clip.id ? launchError.message : null;
  const currentSession = session?.clipId === clip.id ? session.value : null;

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
    let mounted = true;
    void libraryClient
      .externalPlayerAvailability()
      .then((result) => {
        if (mounted) setAvailability(result);
      })
      .catch((cause) => {
        if (mounted) setAvailabilityError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
  }, []);

  useLayoutEffect(() => {
    launchGenerationRef.current += 1;
    return () => {
      launchGenerationRef.current += 1;
    };
  }, [clip.id, game.id]);

  const players = useMemo(() => {
    if (!availability) return [];
    return [...availability.players].sort((left, right) => {
      const leftRecommended = left.player === availability.recommended;
      const rightRecommended = right.player === availability.recommended;
      if (leftRecommended !== rightRecommended) return leftRecommended ? -1 : 1;
      return left.player.localeCompare(right.player);
    });
  }, [availability]);

  const availablePlayers = players.filter((item) => item.available);
  const availableDiagnostics = players.filter((item) => item.available && item.diagnostic);

  const launch = async (player: ExternalPlayer) => {
    if (launchInFlightRef.current !== null) return;
    const clipId = clip.id;
    const gameId = game.id;
    const requestId = ++launchGenerationRef.current;
    launchInFlightRef.current = requestId;
    setLaunching({ clipId, requestId, player });
    setLaunchError(null);
    setSession((current) => current?.clipId === clipId ? null : current);
    try {
      const result = await libraryClient.openExternalPlaylist(gameId, clipId, player);
      if (launchGenerationRef.current !== requestId) {
        return;
      }
      setSession({ clipId, value: result });
    } catch (cause) {
      if (launchGenerationRef.current === requestId) {
        setSession((current) => current?.clipId === clipId ? null : current);
        setLaunchError({
          clipId,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    } finally {
      if (launchInFlightRef.current === requestId) launchInFlightRef.current = null;
      setLaunching((current) => current?.requestId === requestId ? null : current);
    }
  };

  const openInstallPage = async (url: string) => {
    setLinkError(null);
    try {
      await libraryClient.openExternal(url);
    } catch (cause) {
      setLinkError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div
      ref={surfaceRef}
      data-player-surface
      className="relative aspect-video overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#050506] shadow-[0_24px_80px_rgba(0,0,0,.35)]"
    >
      {poster ? (
        <img src={poster} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full object-cover opacity-35 blur-sm scale-[1.02]" />
      ) : (
        <GameArtwork
          title={game.title}
          start={game.accentStart}
          end={game.accentEnd}
          variant="hero"
          imageUrl={gameHeroUrl}
          className="pointer-events-none absolute inset-0 size-full opacity-35"
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,.08),transparent_40%),linear-gradient(to_bottom,rgba(0,0,0,.42),rgba(0,0,0,.88))]" />

      <div className="absolute inset-0 grid place-items-center overflow-y-auto px-5 py-6 text-center sm:px-8">
        <div className="w-full max-w-xl">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/[.07] shadow-xl">
            <MonitorPlay className="size-5 text-white" />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Badge className="uppercase">{clip.codec ?? clip.extension}</Badge>
            <Badge>External playback</Badge>
          </div>
          <h3 className="mt-4 text-xl font-bold tracking-[-.03em]">
            {nativeError ? "Built-in playback is unavailable" : "Open this clip in your video player"}
          </h3>
          <p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-white/55 sm:text-sm sm:leading-6">
            {nativeError
              ? "The system HTML player could not decode this clip reliably. External playback keeps the original file untouched."
              : "This format is intentionally kept out of Pica Pica\u2019s built-in HTML player. Your original file stays untouched."}
          </p>

          {!availability && !availabilityError ? (
            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-white/55">
              <Spinner /> Looking for VLC and mpv …
            </div>
          ) : null}

          {availablePlayers.length ? (
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {availablePlayers.map((item, index) => {
                const isRecommended = item.player === availability?.recommended;
                const playerName = item.player === "vlc" ? "VLC" : "mpv";
                return (
                  <Button
                    key={item.player}
                    variant={index === 0 ? "default" : "secondary"}
                    disabled={launching !== null}
                    onClick={() => void launch(item.player)}
                  >
                    {currentLaunch?.player === item.player ? <Spinner /> : <Play className="size-4" />}
                    Open in {playerName}
                    {isRecommended ? <span className="text-[10px] font-bold uppercase tracking-wide opacity-60">Recommended</span> : null}
                  </Button>
                );
              })}
            </div>
          ) : availability ? (
            <div className="mx-auto mt-6 max-w-lg">
              <Alert variant="warning" className="text-left">
                <AlertCircle className="mt-0.5 size-4" />
                <AlertTitle>No external player found</AlertTitle>
                <AlertDescription>
                  Install VLC or mpv, then restart Pica Pica. No codec pack or conversion is required.
                </AlertDescription>
              </Alert>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => void openInstallPage("https://www.videolan.org/vlc/")}>
                  Get VLC <ExternalLink className="size-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void openInstallPage("https://mpv.io/installation/")}>
                  Get mpv <ExternalLink className="size-3.5" />
                </Button>
              </div>
            </div>
          ) : null}

          {availableDiagnostics.length ? (
            <div className="mx-auto mt-4 max-w-lg space-y-2 text-left" aria-label="External player notes">
              {availableDiagnostics.map((item) => (
                <p
                  key={item.player}
                  className="flex items-start gap-2 rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-2 text-[11px] leading-4 text-white/50"
                >
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-white/35" />
                  <span>{item.diagnostic}</span>
                </p>
              ))}
            </div>
          ) : null}

          {players.some((item) => !item.available && item.diagnostic) && availablePlayers.length ? (
            <p className="mt-4 text-[11px] text-white/40">
              {players
                .filter((item) => !item.available)
                .map((item) => `${item.player === "vlc" ? "VLC" : "mpv"} was not found`)
                .join(" · ")}
            </p>
          ) : null}

          {availabilityError || currentLaunchError || linkError ? (
            <Alert variant="destructive" className="mx-auto mt-5 max-w-lg text-left">
              <AlertCircle className="mt-0.5 size-4" />
              <AlertTitle>{linkError ? "Could not open the website" : "Could not open the clip"}</AlertTitle>
              <AlertDescription>{currentLaunchError ?? availabilityError ?? linkError}</AlertDescription>
            </Alert>
          ) : null}

          {currentSession ? (
            <div className="mx-auto mt-5 flex max-w-lg items-start gap-3 rounded-2xl border border-white/10 bg-black/45 p-3 text-left">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-white" />
              <div className="min-w-0">
                <p className="text-xs font-semibold">
                  Opened in {currentSession.player === "vlc" ? "VLC" : "mpv"}
                </p>
                <p className="mt-1 text-[11px] leading-4 text-white/50">
                  {currentSession.player === "mpv"
                    ? `${currentSession.playlistLength} ${currentSession.playlistLength === 1 ? "clip was" : "clips were"} added in library order. Previous and Next work in mpv.`
                    : `${currentSession.playlistLength} ${currentSession.playlistLength === 1 ? "clip is" : "clips are"} queued from this point. Continue with Next in VLC.`}
                </p>
              </div>
              <ListVideo className="ml-auto size-4 shrink-0 text-white/45" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
