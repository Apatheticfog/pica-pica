mod discovery;
mod process;

use crate::errors::{AppError, AppResult};
use process::{ManagedPlayerProcess, cleanup_stale_playlists};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExternalPlayerKind {
    Mpv,
    Vlc,
}

impl ExternalPlayerKind {
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Mpv => "mpv",
            Self::Vlc => "VLC",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalPlayerInfo {
    pub player: ExternalPlayerKind,
    pub available: bool,
    #[serde(skip_serializing)]
    pub executable_path: Option<String>,
    pub diagnostic: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalPlayerAvailability {
    pub players: Vec<ExternalPlayerInfo>,
    pub recommended: Option<ExternalPlayerKind>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalPlayerSession {
    pub session_id: u64,
    pub player: ExternalPlayerKind,
    pub process_id: u32,
    pub playlist_length: usize,
    pub selected_index: usize,
}

#[derive(Default)]
struct ExternalPlayerState {
    next_session_id: u64,
    active: Option<ManagedPlayerProcess>,
}

#[derive(Clone)]
pub struct ExternalPlayerService {
    playlist_directory: PathBuf,
    inner: Arc<Mutex<ExternalPlayerState>>,
}

impl std::fmt::Debug for ExternalPlayerService {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ExternalPlayerService")
            .field("playlist_directory", &self.playlist_directory)
            .finish_non_exhaustive()
    }
}

impl ExternalPlayerService {
    pub fn new(cache_directory: &Path) -> Self {
        let playlist_directory = cache_directory.join("external-playlists");
        cleanup_stale_playlists(&playlist_directory);
        let service = Self {
            playlist_directory,
            inner: Arc::new(Mutex::new(ExternalPlayerState {
                next_session_id: 1,
                active: None,
            })),
        };
        spawn_process_reaper(Arc::downgrade(&service.inner));
        service
    }

    pub fn availability(&self) -> ExternalPlayerAvailability {
        let players = discovery::discover_players();
        let recommended = [ExternalPlayerKind::Vlc, ExternalPlayerKind::Mpv]
            .into_iter()
            .find(|candidate| {
                players
                    .iter()
                    .any(|player| player.player == *candidate && player.available)
            });
        ExternalPlayerAvailability {
            players,
            recommended,
        }
    }

    pub fn launch(
        &self,
        player: ExternalPlayerKind,
        paths: Vec<PathBuf>,
        selected_index: usize,
    ) -> AppResult<ExternalPlayerSession> {
        if paths.is_empty() || selected_index >= paths.len() {
            return Err(AppError::InvalidInput(
                "The selected clip is not present in the playlist.".to_owned(),
            ));
        }

        let availability = self.availability();
        let executable = availability
            .players
            .into_iter()
            .find(|candidate| candidate.player == player && candidate.available)
            .and_then(|candidate| candidate.executable_path)
            .map(PathBuf::from)
            .ok_or_else(|| {
                AppError::InvalidInput(format!(
                    "{} is not installed or could not be found.",
                    player.display_name()
                ))
            })?;

        let mut state = self.lock_state()?;
        if state
            .active
            .as_mut()
            .map(ManagedPlayerProcess::try_reap)
            .transpose()?
            == Some(true)
        {
            state.active = None;
        }

        let session_id = state.next_session_id;
        state.next_session_id = state.next_session_id.wrapping_add(1).max(1);
        let process = ManagedPlayerProcess::spawn(
            session_id,
            player,
            &executable,
            &self.playlist_directory,
            &paths,
            selected_index,
        )?;
        let session = ExternalPlayerSession {
            session_id,
            player,
            process_id: process.child.id(),
            playlist_length: match player {
                ExternalPlayerKind::Mpv => paths.len(),
                ExternalPlayerKind::Vlc => paths.len() - selected_index,
            },
            selected_index: match player {
                ExternalPlayerKind::Mpv => selected_index,
                ExternalPlayerKind::Vlc => 0,
            },
        };

        if let Some(mut previous) = state.active.take() {
            previous.stop()?;
        }
        state.active = Some(process);
        Ok(session)
    }

    pub fn stop(&self, session_id: u64) -> AppResult<()> {
        let mut state = self.lock_state()?;
        let should_stop = state
            .active
            .as_ref()
            .is_some_and(|process| process.session_id == session_id);
        if should_stop {
            if let Some(mut process) = state.active.take() {
                process.stop()?;
            }
        }
        Ok(())
    }

    fn lock_state(&self) -> AppResult<std::sync::MutexGuard<'_, ExternalPlayerState>> {
        self.inner
            .lock()
            .map_err(|_| AppError::Task("The external player state is unavailable.".to_owned()))
    }
}

fn spawn_process_reaper(state: Weak<Mutex<ExternalPlayerState>>) {
    let _ = std::thread::Builder::new()
        .name("pica-external-player-reaper".to_owned())
        .spawn(move || {
            loop {
                std::thread::sleep(Duration::from_secs(1));
                let Some(state) = state.upgrade() else {
                    break;
                };
                let Ok(mut state) = state.lock() else {
                    break;
                };
                let finished = state
                    .active
                    .as_mut()
                    .and_then(|process| process.try_reap().ok())
                    .unwrap_or(false);
                if finished {
                    state.active = None;
                }
            }
        });
}
