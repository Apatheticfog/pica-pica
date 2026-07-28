# Architecture

## Boundaries

Pica Pica keeps trusted filesystem traversal, persistence, video probing, thumbnail generation, and external-player hand-off in Rust. React and the platform WebView own compatible in-app playback and its control surface. The frontend reaches native operations through a small typed client in `src/data/library-client.ts`.

The browser demo adapter is selected only when the Tauri runtime is absent. It lets contributors build and review the interface without granting filesystem access or sharing private media.

## Storage decision

The primary database and derived cache live under Tauri's application data directory. Storing `.pica-pica` beside the selected root would make portable backups convenient, but it also fails on read-only folders, network mounts, and managed locations. A later portable mode can export or relocate the cache explicitly.

SQLite owns the durable index. `PRAGMA user_version` drives migrations, WAL permits responsive reads during updates, and paths are unique. Each scan uses a monotonically increasing generation: upserts mark current rows and a final delete removes stale clips and games only after a complete directory walk. Manual game metadata survives rescans.

Library bootstrap queries aggregate game summaries only. Clip records stay in SQLite until a detail page requests a bounded cursor page ordered by `(created_at, id)`. The matching multi-column index keeps later pages independent of their position in a large library.

## Scanning

Only direct children of the chosen root become games. Video lookup may recurse below each game folder. Symbolic links are not followed. The extension allow-list covers common OBS and desktop-capture containers including MP4, MOV, MKV, WebM, AVI, WMV, MPEG transport streams, and related variants.

The scanner compares the stable path ID, file size and modification time with the index before probing. Unchanged clips reuse cached media metadata and thumbnails; changed files invalidate stale thumbnails. New and changed clips are processed by a bounded worker pool with at most four concurrent FFmpeg/ffprobe jobs, preventing an unbounded process storm on large libraries.

## Video tools

`FfmpegTools` is the only module that invokes `ffmpeg` or `ffprobe`. It first checks the installed resource directory for bundled tools and then falls back to `PATH` for development. If neither pair is available, scanning remains functional and the UI uses generated artwork fallbacks.

Original video files are never passed as FFmpeg outputs. Thumbnail output targets only the application cache and never overwrites source media.
Probe, thumbnail, and tool-detection processes have fixed timeouts and are killed and reaped if they stop responding. On Windows, every media subprocess uses `CREATE_NO_WINDOW` so scans do not flash console windows.

## Playback

Playback is deliberately split by capability rather than by operating system. MP4/M4V/MOV clips probed as H.264/AVC with an 8-bit 4:2:0 pixel format and AAC-LC audio when present use the WebView's native HTML5 video element and the shared shadcn control surface. The element reports runtime decode errors, so a file that passes the conservative probe can still fall back cleanly instead of leaving a broken player.

The media profile is cached separately from the older container/codec flag. A schema upgrade invalidates legacy compatibility rows, and bootstrap requests an automatic background rescan when such rows remain and FFmpeg/ffprobe is available. Existing thumbnails and non-compatibility metadata remain cached while media work is limited to four concurrent workers. Rows stay pending while the tools are unavailable; successfully probed unsupported or malformed files are cached as external-only, avoiding repeat probes on every later scan.

Other formats are handed to an installed VLC or mpv executable. Rust resolves known installation locations and `PATH` entries without invoking a shell, validates the requested game and clip against SQLite, writes an application-owned temporary playlist, and launches the player with the selected clip at the front of the playable sequence. mpv receives an explicit playlist start index and a clean configuration so user shaders and scripts are not inherited. VLC receives the selected clip followed by the remaining queue because its desktop command line has no equally reliable cross-platform start-index contract.

Pica Pica does not download or bundle either external player. This keeps media decoding outside the WebView for incompatible files without making an unreviewed player build part of the installer. It also removes the native child-window, viewport synchronization, and fullscreen layering paths from Pica Pica. A separate process cannot isolate a kernel-level display-driver failure, so VLC and mpv remain explicit user choices rather than a claim of GPU fault containment.

## Metadata

The offline `MetadataProvider` handles zero-configuration folder matching. `OnlineMetadataService` owns all network traffic and provider-specific response models. RAWG search results require explicit user confirmation; only then are full metadata, SteamGridDB artwork and provider IDs persisted. Provider responses and images live under the application cache and manual artwork always wins.

API keys are user-owned and stored through the native credential service, never in SQLite or JSON. The frontend only receives booleans indicating whether each provider is configured. Network requests use fixed HTTPS origins, bounded timeouts and redirect limits. Artwork downloads accept only allow-listed RAWG/SteamGridDB hosts, supported image MIME types and bounded file sizes.

## Security

- Tauri commands expose purpose-specific operations instead of arbitrary filesystem reads.
- The native dialog grants runtime scope only to a user-selected folder.
- The exact library root stored in SQLite restores the asset scope at startup; no broad or serialized scope is persisted.
- The static asset scope is restricted to application data/cache paths.
- A content security policy limits images and media to local asset sources.
- Remote artwork is downloaded by Rust, validated and served through the local asset protocol; the WebView never receives provider credentials.
- Cache filenames are generated from hashes or validated identifiers, preventing path traversal.
