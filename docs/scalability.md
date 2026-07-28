# Large-library scalability

Pica Pica treats 100 clips per game as ordinary use and targets libraries with at least 10,000 clips without loading the complete clip catalog into the webview.

## Implemented data flow

1. Bootstrap loads game summaries with `clip_count` and `newest_clip_at`, not nested clip arrays.
2. A game detail page requests clips in pages of 48.
3. Pages use a stable `(created_at, id)` cursor backed by the `clips_game_created_id_idx` SQLite index. This avoids the increasing cost of large `OFFSET` values.
4. The frontend keeps the right-hand queue to at most 12 entries and loads thumbnails lazily with asynchronous decoding.
5. Off-screen clip cards use browser-native `content-visibility` containment to skip unnecessary layout and paint work.
6. Rescans compare path-derived ID, file size and modification timestamp with cached probe data. Unchanged clips do not start `ffprobe` again.
7. Changed files invalidate their old thumbnail. FFmpeg and ffprobe are killed after bounded timeouts.
8. New or changed clips use at most four concurrent probe/thumbnail workers; unchanged clips do not start media subprocesses.
9. Compatible clips play directly through HTML5; other originals are handed to an external player, avoiding compatibility-copy CPU and storage costs.
10. An incomplete directory walk never prunes database rows that were not observed during that failed scan.

## Performance invariants

- `LibrarySnapshot` contains no serialized clip details.
- Clip page size is limited by the native command to at most 100.
- Cursor ordering is deterministic even when multiple files share a timestamp.
- A fully unchanged scan starts zero probe processes.
- SQLite writes remain transactional and use a monotonically increasing scan generation.
- Media subprocesses cannot block a scan indefinitely.

The Rust test suite creates 10,000 synthetic clip rows and verifies that bootstrap remains summarized while two cursor pages return distinct bounded results.

## Next scaling stage

Filesystem notifications should only trigger a debounced incremental reconciliation; they must not replace startup or manual scans because operating-system watchers can lose events on large, networked or unusual filesystems.

Thumbnail generation can later move from the current bounded scan workers into a persistent background queue with progress events and retry status. A future infinite-scroll experience can add row-level TanStack Virtual virtualization while retaining the cursor API; pagination remains necessary so the JavaScript heap never owns the whole catalog.
