# Pica Pica

Pica Pica turns local OBS Replay Buffer clips into a fast, private game library. It scans game folders, builds thumbnails and video metadata locally, and presents everything in a responsive streaming-style desktop interface.

> Milestone 1 is a working local-first prototype. It never uploads, renames, moves, overwrites, or deletes original videos.

## Highlights

- Native Windows and Linux desktop foundation with Tauri 2 and Rust
- Responsive React 19 interface built from shadcn/ui primitives and shared layout tokens
- Native folder picker and asynchronous library scans
- SQLite index with idempotent migrations and stable path-based clip IDs
- Sidecar-first FFmpeg/ffprobe detection, bounded parallel probing, and cached thumbnails
- Optional RAWG metadata search and SteamGridDB artwork with user-owned API keys
- Custom poster and hero overrides copied into the local cache
- Safe unresolved-game workflow with editable local metadata
- Embedded libmpv playback on Windows for HEVC, multiple audio tracks, and other OBS formats without conversion
- Browser demo adapter for frontend development without private clip data
- Reduced-motion support, keyboard focus states, and responsive player layout

## Project status

The local vertical slice is implemented: onboarding → folder scan → game gallery → game detail → clip player. It now includes opt-in RAWG search, SteamGridDB artwork, secure OS-keychain storage, custom artwork, bundled checksum-verified FFmpeg tools, incremental probing and cursor-paginated clip pages. Automatic file watching, multiple libraries, code signing and stable installers remain follow-up work.

## Requirements

- Node.js 22 or newer
- pnpm 11 or newer
- Rust stable (1.77.2 minimum; current stable recommended)
- Platform-specific [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- Optional for development: `ffmpeg` and `ffprobe` on `PATH`; release builds bundle vetted binaries

Windows preview builds include libmpv and play local clips directly without creating compatibility copies. This covers HEVC independently of the WebView codecs and automatically mixes every audio stream in multi-track OBS recordings. Linux currently keeps the browser-compatible fallback player while a native Render API backend is developed.

## Development

```bash
pnpm install
pnpm dev
```

`pnpm dev` opens the browser-safe demo library. To run the native application:

```bash
pnpm tauri dev
```

Quality checks:

```bash
pnpm check
cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Build the desktop executable without packaging an installer:

```bash
pnpm tauri build --no-bundle
```

## Preview installers

The manual `Desktop Preview` GitHub Actions workflow builds two unsigned test packages:

- Windows x64: NSIS setup executable (`.exe`)
- Linux x64: AppImage (`.AppImage`)

Open the repository's **Actions** tab, select **Desktop Preview**, choose **Run workflow**, and download the resulting artifact after both jobs finish. Preview artifacts are retained for seven days.

Tagged versions are also published on the repository's [Releases page](https://github.com/Mortisshadow/pica-pica/releases). Preview releases remain unsigned, so Windows may display a SmartScreen warning. Release packages bundle pinned FFmpeg/ffprobe binaries and, on Windows, libmpv. The workflows verify fixed SHA-256 digests before packaging, include provenance records, and ship a `SHA256SUMS.txt` file for the finished installers. The maintainer procedure is documented in [docs/releasing.md](docs/releasing.md).

### Installing on Linux

Download the release asset ending in `.AppImage`. The `x64` (also called `x86_64` or `amd64`) build supports both 64-bit Intel and AMD processors; it is not limited to AMD hardware. It does not support ARM64 devices.

Do not run the Windows `.exe` installer on Linux. Desktop environments can launch it through Wine, which opens the Windows NSIS setup wizard and displays Windows paths such as `C:\\Users\\…`; that installs the Windows build into Wine rather than installing the native Linux application.

Make the AppImage executable, then launch it:

```bash
chmod +x Pica*.AppImage
./Pica*.AppImage
```

## Library layout and privacy

Pica Pica reads direct subfolders of the selected root as games:

```text
OBS Clips/
├── Overwatch 2/
│   ├── Replay 2026-07-18 21-44-03.mp4
│   └── Replay 2026-07-18 22-11-40.mp4
├── Valorant/
└── Minecraft/
```

The SQLite database and derived cache live in the platform-specific application data directory. This avoids modifying a clip folder that may be read-only, synchronized, or located on removable media. The selected root is persisted; original media remains untouched.

Typical cache contents:

```text
Pica Pica app data/
├── library.sqlite
└── cache/
    ├── artwork/
    ├── metadata/
    └── thumbnails/
```

## Architecture

- `src/app` — application composition and routing
- `src/components` — reusable shadcn-style UI, library, layout, and player components
- `src/features` — stateful library and metadata workflows
- `src/data` — typed native client plus isolated browser demo adapter
- `src-tauri/src/commands` — narrow frontend-to-native command boundary
- `src-tauri/src/library` — scanning and orchestration
- `src-tauri/src/database` — SQLite access and migrations
- `src-tauri/src/metadata` — provider abstraction and offline starter catalog
- `src-tauri/src/video` — FFmpeg/ffprobe adapter
- `src-tauri/src/player` — embedded libmpv adapter and native Windows video surface

See [docs/architecture.md](docs/architecture.md) for design decisions and extension points.
See [docs/scalability.md](docs/scalability.md) for the large-library data flow, performance boundaries and remaining background-job work.

## Metadata providers and secrets

The offline catalog remains the zero-configuration fallback. With user-provided keys, RAWG supplies normalized game metadata and SteamGridDB supplies posters and hero artwork. Provider IDs are stored separately so either service can be replaced. Normalized metadata and downloaded artwork are cached locally for offline use.

API keys are never written to SQLite, metadata JSON or the repository. Pica Pica stores them through the operating-system credential service: Windows Credential Manager, macOS Keychain or Linux Secret Service.

RAWG and SteamGridDB have their own attribution and non-commercial-use terms. Pica Pica does not redistribute their data or artwork in its installers.

## FFmpeg releases

Development builds use bundled tools when present and otherwise fall back to `PATH`. Public installers contain checksum-verified LGPL-compatible FFmpeg builds for probing and thumbnails. See [docs/ffmpeg-packaging.md](docs/ffmpeg-packaging.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. The project is free software under [GPL-3.0-or-later](LICENSE). Contributions use the same terms.
