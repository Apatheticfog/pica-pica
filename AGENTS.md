# Pica Pica agent guide

## Product contract

Pica Pica is a free, GPL-licensed, local-first desktop library for OBS Replay Buffer clips. Preserve these invariants:

- Original clips are read-only. Never rename, move, overwrite, transcode, upload, or delete them.
- No telemetry, advertising, account requirement, or background network traffic.
- Online metadata is optional and user initiated. RAWG provides game metadata; SteamGridDB provides artwork.
- API keys belong in the operating-system credential store, never in SQLite, JSON, logs, fixtures, or Git.
- Derived files belong in the platform application-data directory.
- The application UI and source comments are English.

## Repository map

- `src/app` — routing and application composition
- `src/components/ui` — shared shadcn/Radix primitives
- `src/components/library` — game and clip presentation
- `src/components/player` — HTML and external-player experiences
- `src/features` — stateful library and metadata workflows
- `src/data/library-client.ts` — typed frontend/native boundary and browser demo adapter
- `src-tauri/src/commands` — narrow Tauri commands
- `src-tauri/src/library` — scanning and bounded media work
- `src-tauri/src/database` — SQLite and migrations
- `src-tauri/src/metadata` — offline, RAWG, and SteamGridDB providers
- `src-tauri/src/video` — the only FFmpeg/ffprobe adapter
- `src-tauri/src/player` — installed VLC/mpv discovery, playlists, and process cleanup
- `docs` — architecture, scalability, packaging, security, and release decisions

Read `README.md`, `docs/architecture.md`, and `docs/ai-handoff.md` before changing architecture.

## Playback architecture

- Use the WebView HTML5 player only for conservatively probed MP4/M4V/MOV clips containing H.264/AVC 8-bit 4:2:0 video and AAC-LC audio when audio is present.
- Runtime HTML decode errors must fall back to external playback.
- All other media is handed to an already installed VLC or mpv as an ordered playlist.
- Do not restore embedded libmpv, native child-window embedding, shader inheritance, or persistent compatibility transcodes without an explicit product decision.
- VLC and mpv are not downloaded or bundled.
- Keep custom player controls based on the shared shadcn primitives.

## UI conventions

- Maintain the black-and-white visual system and streaming-library feel.
- Prefer existing shadcn/Radix primitives and shared tokens over one-off controls.
- Keep spacing, aspect ratios, focus states, reduced-motion behavior, and responsive layouts consistent from 320 px through ultrawide and 4K displays.
- Avoid unbounded poster or video growth; preserve sensible maximum content widths.
- Clip previews are 16:9 and must not overflow their containers.

## Data and performance

- Keep library bootstrap summarized; never serialize the complete clip catalog into the WebView.
- Preserve cursor pagination and bounded page sizes.
- Treat 100 clips per game as normal and target at least 10,000 clips per library.
- Reuse cached probes and thumbnails for unchanged files.
- Keep FFmpeg/ffprobe work bounded to at most four concurrent workers with timeouts and process cleanup.
- Use idempotent SQLite migrations and preserve manual metadata across rescans.

## Dependencies and security

- Do not add, execute, or update dependencies casually.
- Review provenance, maintenance, license, lockfile impact, lifecycle/build scripts, and transitive risk before proposing a dependency change.
- Preserve checksum-pinned FFmpeg downloads and provenance notices in release workflows.
- Never weaken Tauri filesystem scope, CSP, provider host allow-lists, URL validation, or process argument validation for convenience.
- Never commit secrets, personal paths, user recordings, generated installers, or cache/database files.

## GitHub workflow

- Use `codex/` branches for Codex-authored work; do not develop directly on `main`.
- Keep changes focused and avoid mixing unrelated user work.
- Pull requests must pass frontend checks plus Rust format, Clippy, and tests on Windows and Linux.
- Run those checks in GitHub Actions by default.
- The manual `Desktop Preview` workflow creates temporary Windows NSIS and Linux AppImage artifacts.
- Preview releases come only from immutable `v*-preview.*` tags on a green `main` commit.
- Keep versions aligned in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- Never reuse or move a published tag. Follow `docs/releasing.md`.

## Change expectations

- Update relevant documentation when behavior, storage, security, packaging, or architecture changes.
- Diagnose from evidence before changing code.
- Keep frontend/native types synchronized.
- Add or update focused tests for regressions, but execute them only in an approved environment.
- Report what was statically verified, what GitHub Actions verified, and what still needs real-device testing.
