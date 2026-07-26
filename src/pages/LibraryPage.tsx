import { AlertTriangle, ArrowDownAZ, Film, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FeaturedClip, FeaturedClipSkeleton } from "@/components/library/FeaturedClip";
import { GameCard } from "@/components/library/GameCard";
import { PageContainer } from "@/components/layout/PageContainer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { libraryClient } from "@/data/library-client";
import { useLibrary } from "@/features/library/LibraryProvider";
import { pluralizeClips } from "@/lib/utils";
import type { Clip } from "@/types/library";

type SortMode = "recent" | "title" | "clips";

export function LibraryPage() {
  const { library, scanning, rescan, error } = useLibrary();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const [featuredResult, setFeaturedResult] = useState<{ key: string; clip: Clip | null } | null>(null);

  const featuredGame = useMemo(() => [...(library?.games ?? [])]
    .filter((game) => game.clipCount > 0 && game.newestClipAt !== null)
    .sort((a, b) => (b.newestClipAt ?? 0) - (a.newestClipAt ?? 0))[0] ?? null, [library]);
  const featuredGameId = featuredGame?.id ?? null;
  const featuredClipTimestamp = featuredGame?.newestClipAt ?? null;
  const featuredKey = featuredGameId ? `${featuredGameId}:${featuredClipTimestamp ?? "none"}` : null;

  useEffect(() => {
    let active = true;
    if (!featuredGameId) return () => { active = false; };

    void libraryClient.gameClips(featuredGameId, null, 1)
      .then((page) => {
        if (active && featuredKey) setFeaturedResult({ key: featuredKey, clip: page.clips[0] ?? null });
      })
      .catch(() => {
        if (active && featuredKey) setFeaturedResult({ key: featuredKey, clip: null });
      });

    return () => { active = false; };
  }, [featuredGameId, featuredClipTimestamp, featuredKey, library?.lastScannedAt]);

  const games = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return [...(library?.games ?? [])]
      .filter((game) => !normalized || game.title.toLocaleLowerCase().includes(normalized) || game.folderName.toLocaleLowerCase().includes(normalized))
      .sort((a, b) => {
        if (sort === "title") return a.title.localeCompare(b.title);
        if (sort === "clips") return b.clipCount - a.clipCount;
        return (b.newestClipAt ?? 0) - (a.newestClipAt ?? 0);
      });
  }, [library, query, sort]);

  const totalClips = library?.games.reduce((sum, game) => sum + game.clipCount, 0) ?? 0;
  const unresolved = library?.games.filter((game) => game.metadataStatus === "unresolved").length ?? 0;
  const featuredClip = featuredResult?.key === featuredKey ? featuredResult.clip : null;
  const featuredPending = Boolean(featuredGame && featuredKey && featuredResult?.key !== featuredKey);

  return (
    <PageContainer className="pb-20 pt-8 lg:pt-10">
      <h1 className="sr-only">Library</h1>
      {featuredGame && featuredClip?.gameId === featuredGame.id && featuredClip.createdAt === featuredGame.newestClipAt ? (
        <FeaturedClip game={featuredGame} clip={featuredClip} />
      ) : featuredGame && featuredPending ? (
        <FeaturedClipSkeleton game={featuredGame} />
      ) : null}

      <section className="mt-12" aria-labelledby="games-title">
        <div className="flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[.2em] text-primary">Your collection</p>
            <h2 id="games-title" className="mt-2 text-4xl font-black tracking-[-.055em] sm:text-5xl">Games</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {library?.games.length ?? 0} {library?.games.length === 1 ? "game" : "games"}
              <span className="mx-1.5">·</span>
              {pluralizeClips(totalClips)}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <InputGroup className="sm:w-72">
              <InputGroupAddon><Search className="size-4" /></InputGroupAddon>
              <InputGroupInput aria-label="Search games" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search games …" />
            </InputGroup>
            <div className="relative">
              <ArrowDownAZ className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
              <NativeSelect
                value={sort}
                onChange={(event) => setSort(event.target.value as SortMode)}
                className="pl-10 sm:w-auto"
                aria-label="Sort order"
              >
                <NativeSelectOption value="recent">Recently played</NativeSelectOption>
                <NativeSelectOption value="title">Title</NativeSelectOption>
                <NativeSelectOption value="clips">Most clips</NativeSelectOption>
              </NativeSelect>
            </div>
            <Button variant="secondary" onClick={() => void rescan()} disabled={scanning}>
              {scanning ? <Spinner /> : <RefreshCw className="size-4" />} {scanning ? "Scanning …" : "Rescan"}
            </Button>
          </div>
        </div>

        {unresolved > 0 ? (
          <Alert variant="warning" className="mt-8">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
            <AlertTitle>{unresolved} {unresolved === 1 ? "folder needs" : "folders need"} your help</AlertTitle>
            <AlertDescription>Open a marked game and complete its match. Pica Pica does not guess when a result is uncertain.</AlertDescription>
          </Alert>
        ) : null}

        {error ? <Alert variant="destructive" className="mt-6"><AlertTriangle className="mt-0.5 size-4" /><AlertTitle>Scan failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

        {games.length > 0 ? (
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-5 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 [@media(min-width:1900px)]:grid-cols-7 [@media(min-width:2250px)]:grid-cols-8 [@media(min-width:2600px)]:grid-cols-9 [@media(min-width:2950px)]:grid-cols-10">
            {games.map((game, index) => <GameCard key={game.id} game={game} index={index} />)}
          </div>
        ) : (
          <Empty className="mt-14 min-h-80 rounded-3xl border border-white/10 bg-white/[.02]">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Film className="size-5" /></EmptyMedia>
              <EmptyTitle>No games found</EmptyTitle>
              <EmptyDescription>
                {query ? "No game matches your search." : "Add game subfolders containing video files to your selected clips folder."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </PageContainer>
  );
}
