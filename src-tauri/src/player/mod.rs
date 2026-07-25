#[cfg(not(windows))]
use crate::errors::{AppError, AppResult};
use serde::{Deserialize, Serialize};
#[cfg(not(windows))]
use std::path::{Path, PathBuf};

#[cfg(windows)]
mod windows;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MpvAvailability {
    pub available: bool,
    pub version: Option<String>,
    pub diagnostic: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(windows), allow(dead_code))]
pub struct MpvViewport {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub visible: bool,
    pub corner_radius: i32,
    pub clip_top: i32,
    #[serde(default)]
    pub clip_bottom: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MpvAudioTrack {
    pub id: i64,
    pub title: Option<String>,
    pub language: Option<String>,
    pub codec: Option<String>,
    pub channels: Option<String>,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MpvSnapshot {
    pub session_id: u64,
    pub status: String,
    pub position_seconds: f64,
    pub duration_seconds: Option<f64>,
    pub paused: bool,
    pub volume: f64,
    pub muted: bool,
    pub audio_tracks: Vec<MpvAudioTrack>,
    pub error: Option<String>,
}

#[cfg(windows)]
pub use windows::MpvService;

#[cfg(not(windows))]
#[derive(Debug, Clone)]
pub struct MpvService {
    _resource_dir: Option<PathBuf>,
}

#[cfg(not(windows))]
impl MpvService {
    pub fn new(resource_dir: Option<&Path>) -> Self {
        Self {
            _resource_dir: resource_dir.map(Path::to_path_buf),
        }
    }

    pub fn availability(&self) -> MpvAvailability {
        MpvAvailability {
            available: false,
            version: None,
            diagnostic: Some(
                "Embedded libmpv is currently available in Windows preview builds.".to_owned(),
            ),
        }
    }

    pub fn load(
        &self,
        _window: &tauri::WebviewWindow,
        _path: &Path,
        _session_id: u64,
    ) -> AppResult<MpvSnapshot> {
        Err(AppError::Task(
            "Embedded libmpv is not available on this platform yet.".to_owned(),
        ))
    }

    pub fn set_viewport(&self, _viewport: &MpvViewport) -> AppResult<()> {
        Ok(())
    }

    pub fn snapshot(&self) -> AppResult<MpvSnapshot> {
        Err(AppError::Task("libmpv is not active.".to_owned()))
    }

    pub fn set_paused(&self, _session_id: u64, _paused: bool) -> AppResult<MpvSnapshot> {
        self.snapshot()
    }

    pub fn seek(&self, _session_id: u64, _seconds: f64) -> AppResult<MpvSnapshot> {
        self.snapshot()
    }

    pub fn set_volume(&self, _session_id: u64, _volume: f64) -> AppResult<MpvSnapshot> {
        self.snapshot()
    }

    pub fn set_muted(&self, _session_id: u64, _muted: bool) -> AppResult<MpvSnapshot> {
        self.snapshot()
    }

    pub fn select_audio_tracks(
        &self,
        _session_id: u64,
        _track_ids: Vec<i64>,
    ) -> AppResult<MpvSnapshot> {
        self.snapshot()
    }

    pub fn stop(&self, _session_id: u64) -> AppResult<()> {
        Ok(())
    }
}
