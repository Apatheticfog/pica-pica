# FFmpeg release binaries

Release jobs place the platform-specific `ffmpeg` and `ffprobe` executables in this directory before `tauri build` runs:

- Windows: `ffmpeg.exe`, `ffprobe.exe`
- Linux: `ffmpeg`, `ffprobe`
- macOS development builds: `ffmpeg`, `ffprobe`

The binaries are intentionally not committed. Preview packages use the pinned, checksum-verified LGPL build described in `docs/ffmpeg-packaging.md`. Tauri copies this directory to the installed application's `bin` resource directory. At runtime Pica Pica prefers those files and falls back to tools available on `PATH` for development.
