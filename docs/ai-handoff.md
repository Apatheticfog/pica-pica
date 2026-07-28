# AI handoff

This document preserves product and engineering context that previously lived in long Codex conversations. It is intentionally free of personal data, secrets, and machine-specific paths.

## Snapshot

- Repository: `Mortisshadow/pica-pica`
- Default branch: `main`
- Current public preview at the time of writing: `v0.1.0-preview.6`
- Preview 6 contains Windows x64 NSIS and Linux x64 AppImage packages plus SHA-256 checksums.
- The release was created from merge commit `0b4167c`.
- Frontend checks, Rust formatting, Clippy, and Rust tests passed on Windows and Linux before release.
- PR #28 introduced the current playback model.
- PR #19 was closed as superseded because it targeted the removed embedded-libmpv/conversion architecture.
- At this snapshot, only the TypeScript 6 and Vite 8 Dependabot pull requests remained open; reassess them against current compatibility rather than merging automatically.

Treat this as dated context. Verify current GitHub state before release or dependency work.

## Product direction

Pica Pica is an open-source, advertisement-free alternative to clip-library products such as Medal. A user selects the main OBS clip directory; each direct child folder is treated as a game. The app builds a responsive poster library, game detail pages, thumbnails, local metadata, and playback without uploading private recordings.

The desired experience is a polished streaming-library interface:

- monochrome black-and-white design;
- shadcn/Radix components and consistent spacing;
- game poster gallery on the main page;
- featured newest clip;
- cinematic game hero with metadata;
- selected player and recent queue;
- large 16:9 clip grid below;
- smooth but restrained transitions;
- responsive behavior on laptops, ultrawide displays, and 4K monitors.

The UI and code comments should remain English. User communication may be German and should be concise and pragmatic.

## Current user flow

1. Onboarding asks for a library root.
2. Direct child folders become games; video discovery may recurse inside them.
3. The Rust scanner indexes clips, probes media, and generates thumbnails.
4. The library page shows game posters and a newest-clip feature.
5. A game page shows hero metadata, the selected player, a bounded recent queue, and paginated clip cards.
6. Unresolved folders can be matched through RAWG search or edited manually.
7. Users can override weak or missing hero/poster artwork.
8. Provider results and artwork remain cached for offline use.

## Decisions that define the current architecture

### Local-first storage

- Original clips are immutable inputs.
- SQLite and derived cache data live in the platform application-data directory, not beside the clip root.
- The root path is restored with narrow Tauri asset scope.
- Manual metadata and custom artwork survive rescans.
- Provider keys use the native OS credential store.

### Metadata

- RAWG supplies normalized game metadata.
- SteamGridDB supplies posters and hero artwork.
- The offline catalog and generated Pica Pica artwork remain the zero-configuration fallback.
- Missing metadata requires explicit user matching; a custom title can be used as the next online search query.
- Remote artwork is downloaded and validated by Rust rather than exposing provider credentials to the WebView.

### Playback

Embedded libmpv was removed after Windows driver instability concerns and UI/fullscreen complexity. Do not casually reintroduce it.

- HTML5 playback is used for MP4/M4V/MOV clips probed as H.264/AVC, 8-bit `yuv420p`/`yuvj420p`, with AAC-LC audio when present.
- The player has shadcn-based controls, live seeking, previous/next navigation, volume, and fullscreen.
- Controls fade after inactivity in both embedded and fullscreen modes. The cursor hides with fullscreen controls but remains visible in embedded mode.
- Fullscreen hides the app header without changing its document-space layout and locks page scrolling.
- Runtime decode failures switch to the external-player experience.
- HEVC, MKV, 10-bit media, unusual audio, and other unsupported clips use an installed VLC or mpv.
- External playback receives an ordered game playlist. mpv starts at the selected index with user config/scripts disabled; VLC receives the selected clip followed by the remaining queue.
- Pica Pica does not bundle VLC/mpv and does not create large compatibility transcodes.
- For predictable in-app playback, recommend OBS H.264/AVC plus AAC-LC with the listening mix on track 1.

Linux discovery covers `PATH`, common `/usr` locations, Snap launchers, and system/user Flatpak exports. Snap or Flatpak players may still require permission to read the chosen clip directory. The Linux AppImage builds and tests successfully, but distribution-specific runtime behavior should still be verified on real systems.

### Large libraries

- Library bootstrap contains game summaries, not every clip.
- Game clips use stable `(created_at, id)` cursor pagination in pages of 48.
- The right queue is capped at 12.
- Thumbnails use lazy loading and off-screen cards use content visibility.
- Unchanged clips reuse cached probes and thumbnails.
- New or changed media uses no more than four concurrent workers.
- The design target is at least 10,000 clips.

## Packaging and releases

- Tauri 2 and Rust provide Windows/Linux desktop packaging.
- React 19, TypeScript, Tailwind, motion, and shadcn/Radix primitives provide the UI.
- Public packages bundle pinned, checksum-verified LGPL-compatible FFmpeg/ffprobe builds for probing and thumbnails.
- Releases do not bundle media players.
- Preview packages are unsigned; Windows SmartScreen warnings are expected.
- `Desktop Preview` is a manually dispatched artifact workflow.
- `Preview Release` runs only for immutable tags matching `v*-preview.*`.
- A release publishes Windows NSIS, Linux AppImage, and `SHA256SUMS.txt`.
- Always merge through a green PR before tagging.

## Safety and maintainer workflow

The maintainer does not want dependency installation, compilation, tests, project scripts, or development servers executed on the personal Mac without permission for the exact command.

Default workflow:

1. Inspect code and manifests statically.
2. Make scoped edits.
3. Use GitHub Actions for installation, compilation, linting, tests, and packaging.
4. Read CI logs and apply focused fixes.
5. Use a disposable Proxmox VM/container for local-like execution if the maintainer explicitly approves it.

Do not treat package popularity as proof of safety. Do not add or update dependencies without reviewing provenance, licensing, lifecycle/build scripts, and lockfile impact.

## Known follow-up work

- Debounced filesystem watching and incremental reconciliation
- Multiple library roots or an explicit portable mode
- Optional virtualization if real libraries outgrow current pagination/render containment
- Signing for Windows and other supported targets
- SBOM generation and automated dependency auditing
- Documented release-key handling
- More real-device Linux testing across AppImage distributions and external-player installation methods
- ARM64 packaging only if supported and tested deliberately

Do not call a release stable until signing, SBOM/audit policy, and release-key handling are implemented and documented.

## Starting a new Codex session

Ask Codex to:

1. Read `AGENTS.md`, `README.md`, `docs/architecture.md`, `docs/ai-handoff.md`, `SECURITY.md`, and `docs/releasing.md`.
2. Inspect `git status`, recent commits, open PRs/issues, and the latest Actions runs.
3. Confirm the current release and dependency state instead of trusting this dated snapshot.
4. Preserve the host-execution restriction.
5. Continue from the current architecture rather than reconstructing the removed libmpv path.
