# Architecture

## Boundaries

Pica Pica keeps trusted filesystem traversal, persistence, video probing, thumbnail generation, and playback control in Rust. The frontend talks to that boundary through a small typed client in `src/data/library-client.ts`.

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

Original video files are never passed as FFmpeg outputs. Thumbnail output always targets the application cache and is finalized through a temporary file.
Probe, thumbnail, and tool-detection processes have fixed timeouts and are killed and reaped if they stop responding. On Windows, every media subprocess uses `CREATE_NO_WINDOW` so scans do not flash console windows.

## Playback

Windows uses libmpv in-process. Rust creates an input-disabled, non-activating child Win32 surface inside the Tauri window, passes its handle to libmpv before initialization, and disables libmpv's own cursor handling. React measures the reserved player rectangle in physical pixels and keeps the native surface aligned while scrolling or resizing. This keeps wheel, pointer, and focus ownership in the WebView. In windowed playback, controls remain directly below the native surface. Fullscreen keeps the native video at full-window geometry and clips only the temporary control strip from its Win32 region, allowing the shadcn controls to fade over that strip without changing the video's aspect ratio.

libmpv reads the original clip directly, so HEVC and multiple audio tracks do not require large cached conversions. When a clip exposes multiple audio streams, the player builds one mix automatically and leaves playback position untouched; there is no per-clip audio-selection state in React. Session identifiers reject stale controls after rapidly switching clips, and the native surface is hidden while it is off-screen or a modal is open. Linux currently uses the browser-compatible fallback; a native Linux implementation will require a platform Render API surface rather than the Windows child-window path.

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
