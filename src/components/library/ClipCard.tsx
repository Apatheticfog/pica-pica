import { Play } from "lucide-react";
import { libraryClient } from "@/data/library-client";
import { cn, formatBytes, formatDate, formatDuration } from "@/lib/utils";
import type { Clip, Game } from "@/types/library";
import { GameArtwork } from "./GameArtwork";

interface ClipCardProps {
  clip: Clip;
  game: Game;
  active?: boolean;
  onSelect: () => void;
}

export function ClipCard({ clip, game, active, onSelect }: ClipCardProps) {
  const thumbnail = libraryClient.assetUrl(clip.thumbnailPath);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Play ${clip.fileName}`}
      aria-pressed={active}
      className={cn(
        "clip-card group w-full overflow-hidden rounded-2xl border p-0 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-primary/70",
        active ? "border-primary/35 bg-primary/[.07]" : "border-transparent bg-white/[.025] hover:border-white/10 hover:bg-white/[.055]",
      )}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        {thumbnail ? (
          <img src={thumbnail} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover transition duration-500 group-hover:scale-[1.03]" />
        ) : (
          <GameArtwork title={game.title} start={game.accentStart} end={game.accentEnd} variant="thumbnail" className="size-full" />
        )}
        <div className="absolute inset-0 bg-black/10 transition group-hover:bg-black/25" />
        <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          {formatDuration(clip.durationSeconds)}
        </span>
        <span className="absolute left-1/2 top-1/2 grid size-10 -translate-x-1/2 -translate-y-1/2 scale-90 place-items-center rounded-full bg-white text-black opacity-0 shadow-xl transition group-hover:scale-100 group-hover:opacity-100">
          <Play className="ml-0.5 size-4 fill-current" />
        </span>
      </div>
      <div className="min-w-0 px-3 pb-3 pt-3">
        <p className="truncate text-[13px] font-medium text-white">{clip.fileName}</p>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{formatDate(clip.createdAt, true)}</span>
          <span>·</span>
          <span>{formatBytes(clip.sizeBytes)}</span>
        </p>
      </div>
    </button>
  );
}
