# Bundled FFmpeg provenance

Pica Pica preview installers bundle the `ffmpeg` and `ffprobe` command-line executables as separate processes. They are not linked into the Pica Pica application.

## Upstream build

- Project: FFmpeg
- Upstream source: <https://github.com/FFmpeg/FFmpeg>
- FFmpeg revision: `94138f6973`
- Build provider: BtbN/FFmpeg-Builds
- Build scripts: <https://github.com/BtbN/FFmpeg-Builds>
- Pinned release identifier: `autobuild-2026-07-18-13-13`
- Release URL: <https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-07-18-13-13>
- Variant: FFmpeg 8.1, x86-64, static LGPL build

The FFmpeg project links BtbN as a Windows binary provider from its official download page. Pica Pica nevertheless treats the archive as untrusted input and verifies the pinned SHA-256 digest before extraction.

## Verified archives

| Platform | Archive | SHA-256 |
| --- | --- | --- |
| Windows x64 | `ffmpeg-n8.1.2-22-g94138f6973-win64-lgpl-8.1.zip` | `268f45c3d6d17718bb84e3b0a7f3155d966d4b65f2fe8d059c8598a38bbe01fd` |
| Linux x64 | `ffmpeg-n8.1.2-22-g94138f6973-linux64-lgpl-8.1.tar.xz` | `e514ab912281f881533804f36c1f6787b88b6fa4de4ca7ef43b61a3f87068d30` |

The workflow fails before extraction when a digest differs. The provider's root-level license, readme and build-information files are copied beside the executables and included in the application resources.

## Licensing

FFmpeg is licensed under LGPL-2.1-or-later unless GPL or non-free optional components are enabled. Pica Pica deliberately uses the provider's LGPL variant and does not select the GPL, shared or non-free archives. FFmpeg remains a separate upstream work and is not covered by Pica Pica's GPL-3.0-or-later copyright.

See <https://ffmpeg.org/legal.html> and the notices bundled beside the executables for the applicable terms and corresponding build/source information.
