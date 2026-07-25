import { AlertTriangle, ArrowUpRight } from "lucide-react";
import { motion } from "motion/react";
import { Link } from "react-router-dom";
import { GameArtwork } from "@/components/library/GameArtwork";
import { Badge } from "@/components/ui/badge";
import { libraryClient } from "@/data/library-client";
import { formatDate, pluralizeClips } from "@/lib/utils";
import type { Game } from "@/types/library";

export function GameCard({ game, index }: { game: Game; index: number }) {
  const posterUrl = libraryClient.assetUrl(game.posterPath);
  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay: Math.min(index * 0.045, 0.28), ease: [0.22, 1, 0.36, 1] }}
      className="group min-w-0"
    >
      <Link
        to={`/games/${game.id}`}
        className="block rounded-[1.25rem] outline-none focus-visible:ring-2 focus-visible:ring-primary/80 focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      >
        <div className="relative aspect-[3/4.25] overflow-hidden rounded-[1.2rem] border border-white/10 bg-card shadow-[0_24px_70px_rgba(0,0,0,.25)] transition duration-500 group-hover:-translate-y-1.5 group-hover:border-white/20 group-hover:shadow-[0_30px_80px_rgba(0,0,0,.45)]">
          <GameArtwork
            title={game.title}
            start={game.accentStart}
            end={game.accentEnd}
            imageUrl={posterUrl}
            className="size-full transition duration-700 group-hover:scale-[1.025]"
          />
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute right-3 top-3 grid size-9 translate-y-1 place-items-center rounded-full border border-white/15 bg-black/35 opacity-0 backdrop-blur-md transition group-hover:translate-y-0 group-hover:opacity-100">
            <ArrowUpRight className="size-4" />
          </div>
          {game.metadataStatus === "unresolved" ? (
            <Badge className="absolute left-3 top-3 border-amber-300/25 bg-amber-500/15 text-amber-100">
              <AlertTriangle className="mr-1.5 size-3" /> Match required
            </Badge>
          ) : null}
        </div>
        <div className="px-0.5 pb-2 pt-4">
          <h3 className="truncate text-[15px] font-semibold tracking-[-.015em] text-white">{game.title}</h3>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span>{pluralizeClips(game.clipCount)}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">Latest {formatDate(game.newestClipAt)}</span>
          </p>
        </div>
      </Link>
    </motion.article>
  );
}
