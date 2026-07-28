# Releasing Pica Pica

Preview releases are built only from immutable Git tags matching `v*-preview.*`.

## Before tagging

1. Keep the version identical in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Run `pnpm check`.
3. Run Rust formatting, Clippy, and tests from `src-tauri`.
4. Merge the release preparation through a green pull request.
5. Create a new tag such as `v0.1.0-preview.1` on the verified `main` commit. Never move or reuse a published tag.

The Preview Release workflow rejects a tag whose base version does not match all three application manifests.

## Published files

The workflow builds and attaches:

- a Windows x64 NSIS installer;
- a Linux x64 AppImage;
- `SHA256SUMS.txt` covering both installers.

Each installer contains the pinned FFmpeg and ffprobe build, its upstream notices, and the local provenance record. The workflow verifies the downloaded FFmpeg archive before packaging.

VLC and mpv are not part of the installer. External playback uses an installation already present on the user's system.

## Signing status

Preview packages are currently unsigned. Windows may show a SmartScreen warning. Do not publish a stable release until the signing and release-key process is documented and tested.
