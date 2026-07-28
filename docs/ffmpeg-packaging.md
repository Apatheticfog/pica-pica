# FFmpeg packaging policy

Pica Pica uses `ffprobe` to inspect clips and `ffmpeg` to create thumbnails. Playback does not invoke these tools and does not create compatibility copies.

## Stable release requirements

1. Build FFmpeg separately for every supported operating system and CPU architecture.
2. Use an LGPL-compatible configuration without `--enable-gpl`, `--enable-nonfree`, libx264, libx265 or other optional GPL/non-free components.
3. Record the upstream version, full configure line, source archive URL and SHA-256 checksums in the release provenance.
4. Verify the produced executable checksums before copying them into `src-tauri/binaries`.
5. Ship FFmpeg's license notices and the corresponding-source offer/link with every installer.
6. Generate an SBOM for the application and both media executables.

The stable release pipeline must fail when either executable is missing. Developer builds may omit them and use a trusted system installation from `PATH` instead.

## Preview installers

The manual `Desktop Preview` workflow uses pinned BtbN LGPL archives from a fixed release identifier. The release identifier, archive names and SHA-256 digests are fixed in the workflow; a changed or replaced asset fails verification before extraction. Root-level upstream license and build-information files are packaged beside `ffmpeg` and `ffprobe`.

This provides testable Windows and Linux installers without checking large third-party executables into Git. It does not replace the stricter stable-release goal of owning the build recipe, retaining corresponding source and producing an SBOM. See [ffmpeg-provenance.md](ffmpeg-provenance.md) for the exact preview inputs.

## Runtime lookup

The application checks in this order:

1. `<resource directory>/bin/ffmpeg[.exe]` and `ffprobe[.exe]`
2. `<resource directory>/binaries/…` for unpackaged development layouts
3. `ffmpeg` and `ffprobe` on `PATH`

Only fixed arguments assembled by the Rust adapter are passed to the tools. User-controlled text is passed as a single path argument and is never interpreted by a shell.
