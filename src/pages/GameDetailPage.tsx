import { AlertTriangle, ArrowLeft, Calendar, Edit3, Film } from "lucide-react";
import { motion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { GameArtwork } from "@/components/library/GameArtwork";
import { VideoPlayer } from "@/components/player/VideoPlayer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useLibrary } from "@/features/library/LibraryProvider";
import { MetadataEditor } from "@/features/metadata/MetadataEditor";
import { libraryClient } from "@/data/library-client";
import { pluralizeClips } from "@/lib/utils";
import type { Clip, ClipCursor } from "@/types/library";

const CLIP_PAGE_SIZE = 48;

export function GameDetailPage() {
  const { gameId } = useParams();
  const location = useLocation();
  const { library } = useLibrary();
  const game = library?.games.find((item) => item.id === gameId);
  const [clips, setClips] = useState<Clip[]>([]);
  const [nextCursor, setNextCursor] = useState<ClipCursor | null>(null);
  const [clipsLoading, setClipsLoading] = useState(true);
  const [clipError, setClipError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const focusedNavigationRef = useRef<string | null>(null);
  const clipLoadGenerationRef = useRef(0);
  const loadMorePromiseRef = useRef<Promise<Clip[]> | null>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const artworkOpacity = useTransform(scrollYProgress, [0, 0.72, 1], [1, 0.35, 0]);
  const artworkScale = useTransform(scrollYProgress, [0, 1], [1, 1.06]);
  const contentY = useTransform(scrollYProgress, [0, 1], [0, 42]);
  const navigationState = location.state as { clipId?: string; focusPlayer?: boolean } | null;
  const requestedClipId = navigationState?.clipId ?? null;

  useEffect(() => {
    const generation = ++clipLoadGenerationRef.current;
    loadMorePromiseRef.current = null;
    if (!gameId) return;
    void Promise.resolve().then(() => {
      if (clipLoadGenerationRef.current !== generation) return;
      setClips([]);
      setNextCursor(null);
      setSelectedId(null);
      setClipError(null);
      setClipsLoading(true);
    });
    const request = libraryClient
      .gameClips(gameId, null, CLIP_PAGE_SIZE)
      .then((page) => {
        if (clipLoadGenerationRef.current !== generation) return [];
        setClips(page.clips);
        setNextCursor(page.nextCursor);
        setClipError(null);
        setSelectedId(page.clips.some((clip) => clip.id === requestedClipId) ? requestedClipId : null);
        return [];
      })
      .catch((cause) => {
        if (clipLoadGenerationRef.current === generation) setClipError(String(cause));
        return [];
      })
      .finally(() => {
        if (loadMorePromiseRef.current === request) loadMorePromiseRef.current = null;
        if (clipLoadGenerationRef.current === generation) setClipsLoading(false);
      });
    loadMorePromiseRef.current = request;
    return () => {
      if (clipLoadGenerationRef.current === generation) clipLoadGenerationRef.current += 1;
    };
  }, [gameId, library?.lastScannedAt, requestedClipId]);

  const currentClips = gameId ? clips.filter((clip) => clip.gameId === gameId) : [];
  const selected: Clip | null = currentClips.find((clip) => clip.id === selectedId) ?? null;

  useEffect(() => {
    if (!navigationState?.focusPlayer || !selected?.id || focusedNavigationRef.current === location.key) return;
    focusedNavigationRef.current = location.key;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("clip-player")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.key, navigationState?.focusPlayer, selected?.id]);

  function loadMore(): Promise<Clip[]> {
    if (loadMorePromiseRef.current) return loadMorePromiseRef.current;
    if (!gameId || !nextCursor || clipsLoading) return Promise.resolve([]);
    const generation = clipLoadGenerationRef.current;
    const cursor = nextCursor;
    const knownIds = new Set(currentClips.map((clip) => clip.id));
    setClipsLoading(true);
    setClipError(null);
    const request = libraryClient
      .gameClips(gameId, cursor, CLIP_PAGE_SIZE)
      .then((page) => {
        if (clipLoadGenerationRef.current !== generation) return [];
        const appended = page.clips.filter((clip) => {
          if (knownIds.has(clip.id)) return false;
          knownIds.add(clip.id);
          return true;
        });
        setClips((current) => {
          const currentIds = new Set(current.map((clip) => clip.id));
          const unique = appended.filter((clip) => {
            if (currentIds.has(clip.id)) return false;
            currentIds.add(clip.id);
            return true;
          });
          return unique.length ? [...current, ...unique] : current;
        });
        setNextCursor(page.nextCursor);
        return appended;
      })
      .catch((cause) => {
        if (clipLoadGenerationRef.current === generation) setClipError(String(cause));
        return [];
      })
      .finally(() => {
        if (loadMorePromiseRef.current === request) loadMorePromiseRef.current = null;
        if (clipLoadGenerationRef.current === generation) setClipsLoading(false);
      });
    loadMorePromiseRef.current = request;
    return request;
  }

  if (!game) {
    return (
      <div className="grid min-h-[70vh] place-items-center px-6 text-center">
        <Empty className="max-w-lg flex-none">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Film className="size-5" /></EmptyMedia>
            <EmptyTitle>Game not found</EmptyTitle>
            <EmptyDescription>This entry is no longer part of your current library.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button asChild variant="secondary"><Link to="/library">Back to library</Link></Button></EmptyContent>
        </Empty>
      </div>
    );
  }

  const heroUrl = libraryClient.assetUrl(game.heroPath);

  return (
    <div className="relative -mt-[69px]">
      <section ref={heroRef} className="relative isolate flex min-h-[clamp(42rem,72svh,62rem)] items-end overflow-hidden pt-[69px]">
        <motion.div className="absolute inset-0" style={{ opacity: artworkOpacity, scale: artworkScale }}>
          <GameArtwork title={game.title} start={game.accentStart} end={game.accentEnd} variant="hero" imageUrl={heroUrl} className="size-full" />
        </motion.div>
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,9,11,.94)_0%,rgba(8,9,11,.62)_42%,rgba(8,9,11,.12)_72%)]" />
        <div className="noise" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[58%] bg-gradient-to-b from-transparent via-[#08090b]/75 to-[#08090b]" />
        <div className="absolute inset-x-0 top-[69px] z-[3] mx-auto w-full max-w-[3200px] px-5 pt-8 sm:px-8 lg:px-10">
          <Button asChild variant="secondary" size="sm" className="border-white/10 bg-background/90 shadow-lg backdrop-blur-md hover:bg-background">
            <Link to="/library"><ArrowLeft className="size-4" /> Library</Link>
          </Button>
        </div>
        <motion.div style={{ y: contentY }} className="relative z-[2] mx-auto w-full max-w-[3200px] px-5 pb-20 pt-32 sm:px-8 lg:px-10 lg:pb-24">
          <motion.div initial={{ opacity: 0, y: 25 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              {game.metadataStatus === "unresolved" ? (
                <Badge className="border-amber-300/25 bg-amber-400/10 text-amber-100"><AlertTriangle className="mr-1.5 size-3" /> Not matched</Badge>
              ) : null}
              {game.releaseYear ? <Badge><Calendar className="mr-1.5 size-3" /> {game.releaseYear}</Badge> : null}
            </div>
            <h1 className="mt-5 text-5xl font-black leading-[.9] tracking-[-.07em] sm:text-7xl lg:text-8xl">{game.title}</h1>
            <div className="mt-6 flex flex-wrap gap-2">{game.genres.map((genre) => <Badge key={genre}>{genre}</Badge>)}</div>
            <p className="mt-6 max-w-2xl overflow-hidden text-sm leading-7 text-white/65 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:4] sm:text-base">
              {game.description ?? `The “${game.folderName}” folder is ready. Add game details to complete your library.`}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button disabled={!currentClips.length} onClick={() => document.getElementById("all-clips")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                <Film className="size-4" /> View {pluralizeClips(game.clipCount)}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(true)}><Edit3 className="size-4" /> Edit metadata</Button>
            </div>
          </motion.div>
        </motion.div>
      </section>

      <section id="clips" className="relative z-10 -mt-24 mx-auto max-w-[3200px] px-5 pb-24 pt-28 sm:px-8 lg:px-10 lg:pt-32">
        <div className="pointer-events-none absolute inset-x-0 -top-32 h-48 bg-gradient-to-b from-transparent via-background/90 to-background" />
        <div className="relative mb-7">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-primary">Replay Buffer</p>
          <h2 className="mt-2 text-3xl font-black tracking-[-.045em]">Your latest moments</h2>
        </div>
        <div className="relative">
        {clipError ? (
          <Alert variant="warning" className="mb-6">
            <AlertTriangle className="mt-0.5 size-4" />
            <AlertTitle>Could not load clips</AlertTitle>
            <AlertDescription>{clipError}</AlertDescription>
          </Alert>
        ) : null}
        {currentClips.length ? (
          <VideoPlayer
            game={game}
            clips={currentClips}
            totalCount={game.clipCount}
            selected={selected}
            hasMore={Boolean(nextCursor)}
            loadingMore={clipsLoading}
            playerActive={!editing}
            onLoadMore={loadMore}
            onSelect={(clip) => setSelectedId(clip.id)}
          />
        ) : clipsLoading ? (
          <div className="grid min-h-72 place-items-center rounded-3xl border border-white/10 bg-white/[.02]">
            <div className="flex items-center gap-3 text-sm text-muted-foreground"><Spinner /> Loading clips …</div>
          </div>
        ) : (
          <Empty className="min-h-72 rounded-3xl border border-white/10 bg-white/[.02]">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Film className="size-5" /></EmptyMedia>
              <EmptyTitle>No clips in this folder yet</EmptyTitle>
              <EmptyDescription>New OBS replays will appear here automatically after the next scan.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        </div>
      </section>
      {editing ? <MetadataEditor game={game} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
