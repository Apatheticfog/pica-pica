# Security policy

Pica Pica processes private local recordings. Security and data minimization are release requirements, not optional features.

## Reporting

Until a private GitHub security advisory channel is configured, do not publish exploit details in a public issue. Contact the maintainer privately through the repository profile and include the affected version, operating system, reproduction steps and impact.

## Current preview baseline

- No telemetry, uploads or remote metadata calls without a user action.
- API keys live in the operating-system credential store.
- Original clips are treated as read-only.
- FFmpeg is invoked directly without a shell and with fixed argument structure.
- Preview packages are built in GitHub Actions, remain unsigned, and are published with SHA-256 checksums.
- Bundled FFmpeg archives use fixed release inputs and verified SHA-256 digests.
- VLC and mpv are never bundled or downloaded. When a user explicitly chooses external playback, the installed player receives an application-owned playlist of local clip paths.
- External playlists use collision-safe create-new filenames, owner-only permissions on Unix, and are removed when the managed player exits; stale files from interrupted sessions are cleaned conservatively.

The preview workflow does not currently produce an SBOM, sign packages, or run dependency audits itself. Signing where supported, an SBOM, automated `pnpm audit` and `cargo audit` checks, and enforced green quality gates are requirements before Pica Pica can publish a stable release. Until those controls are implemented and documented, published builds remain prereleases.

Open source makes review possible; it does not replace review. AI-assisted changes require the same tests, dependency review and human-readable design as any other contribution.
