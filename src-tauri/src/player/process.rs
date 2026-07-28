use super::ExternalPlayerKind;
use crate::errors::{AppError, AppResult};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static PLAYLIST_NONCE: AtomicU64 = AtomicU64::new(1);
const PLAYER_STARTUP_GRACE: Duration = Duration::from_millis(250);
const STALE_PLAYLIST_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

pub(super) struct ManagedPlayerProcess {
    pub session_id: u64,
    pub child: Child,
    playlist_path: PathBuf,
    stopped: bool,
}

impl ManagedPlayerProcess {
    pub fn spawn(
        session_id: u64,
        player: ExternalPlayerKind,
        executable: &Path,
        playlist_directory: &Path,
        paths: &[PathBuf],
        selected_index: usize,
    ) -> AppResult<Self> {
        let (playlist_paths, player_start_index) = match player {
            ExternalPlayerKind::Mpv => (paths, selected_index),
            ExternalPlayerKind::Vlc => (&paths[selected_index..], 0),
        };
        let playlist_path = write_playlist(playlist_directory, playlist_paths)?;
        let mut command = player_command(
            player,
            executable,
            &playlist_path,
            player_start_index,
        );
        configure_background_process(&mut command);

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let _ = fs::remove_file(&playlist_path);
                return Err(AppError::Task(format!(
                    "{} could not be started: {error}",
                    player.display_name()
                )));
            }
        };
        std::thread::sleep(PLAYER_STARTUP_GRACE);
        match child.try_wait() {
            Ok(None) => {}
            Ok(Some(status)) => {
                let _ = fs::remove_file(&playlist_path);
                let detail = status
                    .code()
                    .map(|code| format!("exit code {code}"))
                    .unwrap_or_else(|| "a platform termination signal".to_owned());
                return Err(AppError::Task(format!(
                    "{} closed immediately with {detail}. Check the player's installation and file-access permissions.",
                    player.display_name()
                )));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_file(&playlist_path);
                return Err(AppError::Task(format!(
                    "{} started but its process could not be monitored: {error}",
                    player.display_name()
                )));
            }
        }

        Ok(Self {
            session_id,
            child,
            playlist_path,
            stopped: false,
        })
    }

    pub fn try_reap(&mut self) -> AppResult<bool> {
        if self.stopped {
            return Ok(true);
        }
        if self.child.try_wait()?.is_some() {
            self.stopped = true;
            self.remove_playlist();
            return Ok(true);
        }
        Ok(false)
    }

    pub fn stop(&mut self) -> AppResult<()> {
        if self.stopped {
            return Ok(());
        }
        if self.child.try_wait()?.is_none() {
            self.child.kill()?;
            self.child.wait()?;
        }
        self.stopped = true;
        self.remove_playlist();
        Ok(())
    }

    fn remove_playlist(&self) {
        match fs::remove_file(&self.playlist_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => {}
        }
    }
}

impl Drop for ManagedPlayerProcess {
    fn drop(&mut self) {
        if !self.stopped {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        self.remove_playlist();
    }
}

fn player_command(
    player: ExternalPlayerKind,
    executable: &Path,
    playlist_path: &Path,
    selected_index: usize,
) -> Command {
    let mut command = Command::new(executable);
    match player {
        ExternalPlayerKind::Mpv => {
            command
                .arg("--no-config")
                .arg("--load-scripts=no")
                .arg("--no-terminal")
                .arg("--force-window=yes")
                .arg("--keep-open=no")
                .arg("--resume-playback=no")
                .arg("--autoload-files=no")
                .arg(format!("--playlist-start={selected_index}"))
                .arg("--")
                .arg(playlist_path);
        }
        ExternalPlayerKind::Vlc => {
            command
                .arg("--no-one-instance")
                .arg("--playlist-autostart")
                .arg("--no-playlist-enqueue")
                .arg(playlist_path);
        }
    }
    command
}

fn configure_background_process(command: &mut Command) {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

pub(super) fn cleanup_stale_playlists(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !is_managed_playlist_path(&path)
            || !entry.file_type().is_ok_and(|file_type| file_type.is_file())
        {
            continue;
        }
        let old_enough = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age >= STALE_PLAYLIST_AGE);
        if old_enough {
            let _ = fs::remove_file(path);
        }
    }
}

fn is_managed_playlist_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name.starts_with("pica-pica-"))
        && path.extension().and_then(|value| value.to_str()) == Some("m3u8")
}

fn write_playlist(directory: &Path, paths: &[PathBuf]) -> AppResult<PathBuf> {
    if paths.is_empty() {
        return Err(AppError::InvalidInput(
            "There are no playable clips in this game.".to_owned(),
        ));
    }
    fs::create_dir_all(directory)?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    for _ in 0..16 {
        let nonce = PLAYLIST_NONCE.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = directory.join(format!(
            "pica-pica-{}-{timestamp}-{nonce}.m3u8",
            std::process::id()
        ));
        match options.open(&path) {
            Ok(mut file) => {
                let result = write_playlist_contents(&mut file, paths);
                drop(file);
                match result {
                    Ok(()) => return Ok(path),
                    Err(error) => {
                        let _ = fs::remove_file(&path);
                        return Err(error);
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }

    Err(AppError::Task(
        "A unique temporary playlist could not be created.".to_owned(),
    ))
}

fn write_playlist_contents(file: &mut File, paths: &[PathBuf]) -> AppResult<()> {
    file.write_all(b"#EXTM3U\n")?;
    for path in paths {
        let value = path.to_str().ok_or_else(|| {
            AppError::InvalidInput(
                "A clip path cannot be represented as a UTF-8 playlist entry.".to_owned(),
            )
        })?;
        if value.contains(['\r', '\n']) {
            return Err(AppError::InvalidInput(
                "A clip filename contains a line break and cannot be added to a playlist."
                    .to_owned(),
            ));
        }
        file.write_all(value.as_bytes())?;
        file.write_all(b"\n")?;
    }
    file.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playlist_rejects_line_breaks_in_paths() {
        let mut bytes = Vec::new();
        let mut file = tempfile::tempfile().expect("temporary file");
        let error = write_playlist_contents(&mut file, &[PathBuf::from("/clips/a\nb.mp4")])
            .expect_err("invalid path");
        bytes.extend_from_slice(error.to_string().as_bytes());
        assert!(!bytes.is_empty());
    }

    #[test]
    fn failed_playlist_write_removes_the_partial_file() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let result = write_playlist(directory.path(), &[PathBuf::from("/clips/a\nb.mp4")]);
        assert!(result.is_err());
        assert_eq!(
            fs::read_dir(directory.path())
                .expect("playlist directory")
                .count(),
            0
        );
    }

    #[cfg(unix)]
    #[test]
    fn playlist_is_private_to_the_current_user() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().expect("temporary directory");
        let path = write_playlist(directory.path(), &[PathBuf::from("/clips/a.mp4")])
            .expect("playlist");
        let mode = path
            .metadata()
            .expect("playlist metadata")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn stale_cleanup_only_recognizes_owned_playlist_names() {
        assert!(is_managed_playlist_path(Path::new(
            "/cache/pica-pica-42-123-1.m3u8"
        )));
        assert!(!is_managed_playlist_path(Path::new(
            "/cache/pica-pica-42-123-1.m3u"
        )));
        assert!(!is_managed_playlist_path(Path::new(
            "/cache/user-playlist.m3u8"
        )));
    }

    #[test]
    fn mpv_starts_without_user_config_or_resume_state() {
        let command = player_command(
            ExternalPlayerKind::Mpv,
            Path::new("mpv"),
            Path::new("/cache/clips.m3u8"),
            7,
        );
        let arguments = command
            .get_args()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert!(arguments.contains(&"--no-config".to_owned()));
        assert!(arguments.contains(&"--load-scripts=no".to_owned()));
        assert!(arguments.contains(&"--resume-playback=no".to_owned()));
        assert!(arguments.contains(&"--playlist-start=7".to_owned()));
    }

    #[test]
    fn vlc_keeps_the_users_playback_configuration() {
        let command = player_command(
            ExternalPlayerKind::Vlc,
            Path::new("vlc"),
            Path::new("/cache/clips.m3u8"),
            0,
        );
        let arguments = command
            .get_args()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert!(!arguments.contains(&"--ignore-config".to_owned()));
        assert!(arguments.contains(&"--no-one-instance".to_owned()));
    }
}
