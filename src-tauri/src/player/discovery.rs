use super::{ExternalPlayerInfo, ExternalPlayerKind};
use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};

pub(super) fn discover_players() -> Vec<ExternalPlayerInfo> {
    [ExternalPlayerKind::Mpv, ExternalPlayerKind::Vlc]
        .into_iter()
        .map(discover_player)
        .collect()
}

fn discover_player(player: ExternalPlayerKind) -> ExternalPlayerInfo {
    let executable = candidates(player).into_iter().find_map(usable_executable);
    let diagnostic = match executable.as_ref() {
        None => Some(format!(
            "{} was not found in a standard install location or on PATH.",
            player.display_name()
        )),
        Some((_, true)) => Some(format!(
            "{} was found through a sandboxed launcher. Access to the playlist and clip folder depends on that player's file permissions.",
            player.display_name()
        )),
        Some((_, false)) => None,
    };

    ExternalPlayerInfo {
        player,
        available: executable.is_some(),
        executable_path: executable.map(|(path, _)| path.to_string_lossy().into_owned()),
        diagnostic,
    }
}

fn usable_executable(path: PathBuf) -> Option<(PathBuf, bool)> {
    if !path.is_absolute() || !path.is_file() || !is_executable(&path) {
        return None;
    }
    // Keep launcher symlinks intact. Snap and similar dispatchers depend on
    // the original argv[0] instead of the canonicalized target executable.
    let sandboxed = is_sandboxed_launcher(&path);
    Some((path, sandboxed))
}

fn is_sandboxed_launcher(path: &Path) -> bool {
    let value = path.to_string_lossy().replace('\\', "/");
    value.starts_with("/snap/bin/")
        || value.starts_with("/var/lib/snapd/snap/bin/")
        || value.contains("/flatpak/exports/bin/")
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.metadata()
        .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(_path: &Path) -> bool {
    true
}

fn candidates(player: ExternalPlayerKind) -> Vec<PathBuf> {
    let mut paths = platform_candidates(player);
    if let Some(path_value) = env::var_os("PATH") {
        let executable_names = executable_names(player);
        for directory in env::split_paths(&path_value) {
            for executable_name in executable_names {
                paths.push(directory.join(executable_name));
            }
        }
    }

    let mut seen = HashSet::new();
    paths.retain(|path| seen.insert(path.clone()));
    paths
}

#[cfg(windows)]
fn executable_names(player: ExternalPlayerKind) -> &'static [&'static str] {
    match player {
        ExternalPlayerKind::Mpv => &["mpv.exe"],
        ExternalPlayerKind::Vlc => &["vlc.exe"],
    }
}

#[cfg(not(windows))]
fn executable_names(player: ExternalPlayerKind) -> &'static [&'static str] {
    match player {
        ExternalPlayerKind::Mpv => &["mpv"],
        ExternalPlayerKind::Vlc => &["vlc"],
    }
}

#[cfg(windows)]
fn platform_candidates(player: ExternalPlayerKind) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    match player {
        ExternalPlayerKind::Vlc => {
            for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
                if let Some(directory) = env::var_os(variable) {
                    paths.push(PathBuf::from(directory).join("VideoLAN/VLC/vlc.exe"));
                }
            }
            if let Some(directory) = env::var_os("LOCALAPPDATA") {
                paths.push(
                    PathBuf::from(directory)
                        .join("Programs")
                        .join("VideoLAN")
                        .join("VLC")
                        .join("vlc.exe"),
                );
            }
        }
        ExternalPlayerKind::Mpv => {
            for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
                if let Some(directory) = env::var_os(variable) {
                    paths.push(PathBuf::from(directory).join("mpv/mpv.exe"));
                }
            }
            if let Some(directory) = env::var_os("LOCALAPPDATA") {
                paths.push(PathBuf::from(directory).join("Programs/mpv/mpv.exe"));
            }
            if let Some(directory) = env::var_os("USERPROFILE") {
                paths.push(PathBuf::from(directory).join("scoop/apps/mpv/current/mpv.exe"));
            }
        }
    }
    paths
}

#[cfg(target_os = "linux")]
fn platform_candidates(player: ExternalPlayerKind) -> Vec<PathBuf> {
    let mut paths = match player {
        ExternalPlayerKind::Mpv => [
            "/usr/bin/mpv",
            "/usr/local/bin/mpv",
            "/snap/bin/mpv",
            "/var/lib/snapd/snap/bin/mpv",
            "/var/lib/flatpak/exports/bin/io.mpv.Mpv",
        ],
        ExternalPlayerKind::Vlc => [
            "/usr/bin/vlc",
            "/usr/local/bin/vlc",
            "/snap/bin/vlc",
            "/var/lib/snapd/snap/bin/vlc",
            "/var/lib/flatpak/exports/bin/org.videolan.VLC",
        ],
    }
    .into_iter()
    .map(PathBuf::from)
    .collect::<Vec<_>>();

    let user_data_directory = env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")));
    if let Some(directory) = user_data_directory {
        let executable = match player {
            ExternalPlayerKind::Mpv => "io.mpv.Mpv",
            ExternalPlayerKind::Vlc => "org.videolan.VLC",
        };
        paths.push(directory.join("flatpak/exports/bin").join(executable));
    }

    paths
}

#[cfg(target_os = "macos")]
fn platform_candidates(player: ExternalPlayerKind) -> Vec<PathBuf> {
    let mut paths = match player {
        ExternalPlayerKind::Mpv => [
            "/Applications/mpv.app/Contents/MacOS/mpv",
            "/opt/homebrew/bin/mpv",
            "/usr/local/bin/mpv",
        ],
        ExternalPlayerKind::Vlc => [
            "/Applications/VLC.app/Contents/MacOS/VLC",
            "/opt/homebrew/bin/vlc",
            "/usr/local/bin/vlc",
        ],
    }
    .into_iter()
    .map(PathBuf::from)
    .collect::<Vec<_>>();

    if let Some(home) = env::var_os("HOME") {
        let executable = match player {
            ExternalPlayerKind::Mpv => "mpv.app/Contents/MacOS/mpv",
            ExternalPlayerKind::Vlc => "VLC.app/Contents/MacOS/VLC",
        };
        paths.push(PathBuf::from(home).join("Applications").join(executable));
    }

    paths
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn platform_candidates(_player: ExternalPlayerKind) -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sandboxed_launchers_are_identified_without_resolving_symlinks() {
        assert!(is_sandboxed_launcher(Path::new("/snap/bin/vlc")));
        assert!(is_sandboxed_launcher(Path::new(
            "/home/user/.local/share/flatpak/exports/bin/io.mpv.Mpv"
        )));
        assert!(!is_sandboxed_launcher(Path::new("/usr/bin/vlc")));
    }
}
