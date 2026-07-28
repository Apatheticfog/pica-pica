use crate::database::{ClipPlaylist, Database};
use crate::errors::{AppError, AppResult};
use crate::library::execute_scan;
use crate::metadata::{OnlineMetadataService, ProviderKey};
use crate::models::{
    ApiKeyUpdate, BootstrapState, ClipCursor, ClipPage, CustomArtworkUpdate, LibrarySnapshot,
    MetadataSearchResult, MetadataSelection, MetadataUpdate, ProviderSettings, ScanResult,
};
use crate::player::{
    ExternalPlayerAvailability, ExternalPlayerKind, ExternalPlayerService, ExternalPlayerSession,
};
use crate::video::FfmpegTools;
use std::path::{Path, PathBuf};
use tauri::{Manager, State};

#[derive(Debug)]
pub struct AppState {
    pub database: Database,
    pub ffmpeg: FfmpegTools,
    pub online_metadata: OnlineMetadataService,
    pub external_player: ExternalPlayerService,
}

#[tauri::command]
pub fn get_bootstrap(state: State<'_, AppState>) -> AppResult<BootstrapState> {
    let root_path = state.database.root_path()?;
    let media_compatibility_scan_required =
        root_path.is_some() && state.database.media_compatibility_scan_required()?;
    let library = if root_path.is_some() {
        Some(
            state
                .database
                .load_library(state.ffmpeg.available, &state.ffmpeg.source)?,
        )
    } else {
        None
    };
    Ok(BootstrapState {
        configured: root_path.is_some(),
        root_path: root_path.map(|path| path.to_string_lossy().into_owned()),
        cache_path: state.database.cache_path().to_string_lossy().into_owned(),
        ffmpeg_available: state.ffmpeg.available,
        ffmpeg_source: state.ffmpeg.source.clone(),
        media_compatibility_scan_required,
        library,
    })
}

#[tauri::command]
pub fn get_library(state: State<'_, AppState>) -> AppResult<LibrarySnapshot> {
    state
        .database
        .load_library(state.ffmpeg.available, &state.ffmpeg.source)
}

#[tauri::command]
pub async fn get_game_clips(
    game_id: String,
    cursor: Option<ClipCursor>,
    limit: usize,
    state: State<'_, AppState>,
) -> AppResult<ClipPage> {
    if game_id.len() > 128 || !(1..=100).contains(&limit) {
        return Err(AppError::InvalidInput(
            "Invalid clip page request.".to_owned(),
        ));
    }
    let database = state.database.clone();
    tauri::async_runtime::spawn_blocking(move || {
        database.load_clip_page(&game_id, cursor.as_ref(), limit)
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?
}

#[tauri::command]
pub async fn configure_library(
    root_path: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ScanResult> {
    let root = PathBuf::from(root_path);
    let scan_root = root.clone();
    let database = state.database.clone();
    let ffmpeg = state.ffmpeg.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || execute_scan(&database, &scan_root, &ffmpeg))
            .await
            .map_err(|error| AppError::Task(error.to_string()))??;
    app.asset_protocol_scope()
        .allow_directory(root, true)
        .map_err(|error| AppError::InvalidInput(error.to_string()))?;
    Ok(result)
}

#[tauri::command]
pub async fn scan_library(state: State<'_, AppState>) -> AppResult<ScanResult> {
    let database = state.database.clone();
    let root = database.root_path()?.ok_or(AppError::NotConfigured)?;
    let ffmpeg = state.ffmpeg.clone();
    tauri::async_runtime::spawn_blocking(move || execute_scan(&database, &root, &ffmpeg))
        .await
        .map_err(|error| AppError::Task(error.to_string()))?
}

#[tauri::command]
pub fn get_external_player_availability(state: State<'_, AppState>) -> ExternalPlayerAvailability {
    state.external_player.availability()
}

#[tauri::command]
pub async fn open_external_playlist(
    game_id: String,
    clip_id: String,
    player: ExternalPlayerKind,
    state: State<'_, AppState>,
) -> AppResult<ExternalPlayerSession> {
    validate_game_id(&game_id)?;
    validate_clip_id(&clip_id)?;
    let database = state.database.clone();
    let external_player = state.external_player.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let playlist = database.clip_playlist(&game_id, &clip_id)?;
        let (paths, selected_index) = playable_clip_paths(playlist)?;
        external_player.launch(player, paths, selected_index)
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?
}

#[tauri::command]
pub async fn stop_external_player(session_id: u64, state: State<'_, AppState>) -> AppResult<()> {
    let external_player = state.external_player.clone();
    tauri::async_runtime::spawn_blocking(move || external_player.stop(session_id))
        .await
        .map_err(|error| AppError::Task(error.to_string()))?
}

fn playable_clip_paths(playlist: ClipPlaylist) -> AppResult<(Vec<PathBuf>, usize)> {
    let selected_id = playlist
        .clips
        .get(playlist.selected_index)
        .map(|(id, _)| id.clone())
        .ok_or_else(|| {
            AppError::InvalidInput("The selected clip is not present in the playlist.".to_owned())
        })?;
    let mut paths = Vec::with_capacity(playlist.clips.len());
    let mut selected_index = None;

    for (clip_id, path) in playlist.clips {
        let valid_file = path.is_absolute()
            && std::fs::symlink_metadata(&path)
                .is_ok_and(|metadata| metadata.file_type().is_file());
        if !valid_file {
            if clip_id == selected_id {
                return Err(AppError::InvalidInput(
                    "The original clip is no longer available.".to_owned(),
                ));
            }
            continue;
        }
        let valid_playlist_path = path
            .to_str()
            .is_some_and(|value| !value.contains(['\r', '\n']));
        if !valid_playlist_path {
            if clip_id == selected_id {
                return Err(AppError::InvalidInput(
                    "The selected clip path cannot be added to a playlist.".to_owned(),
                ));
            }
            continue;
        }
        if clip_id == selected_id {
            selected_index = Some(paths.len());
        }
        paths.push(path);
    }

    let selected_index = selected_index.ok_or_else(|| {
        AppError::InvalidInput("The selected clip is not playable anymore.".to_owned())
    })?;
    Ok((paths, selected_index))
}

fn validate_clip_id(clip_id: &str) -> AppResult<()> {
    if clip_id.len() != 64 || !clip_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AppError::InvalidInput("Invalid clip ID.".to_owned()));
    }
    Ok(())
}

fn validate_game_id(game_id: &str) -> AppResult<()> {
    if game_id.is_empty()
        || game_id.len() > 128
        || !game_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(AppError::InvalidInput("Invalid game ID.".to_owned()));
    }
    Ok(())
}

#[tauri::command]
pub fn update_game_metadata(
    update: MetadataUpdate,
    state: State<'_, AppState>,
) -> AppResult<LibrarySnapshot> {
    state.database.update_metadata(&update)?;
    state
        .database
        .load_library(state.ffmpeg.available, &state.ffmpeg.source)
}

#[tauri::command]
pub fn get_provider_settings(state: State<'_, AppState>) -> ProviderSettings {
    state.online_metadata.settings()
}

#[tauri::command]
pub fn save_provider_api_key(
    update: ApiKeyUpdate,
    state: State<'_, AppState>,
) -> AppResult<ProviderSettings> {
    state
        .online_metadata
        .save_key(ProviderKey::parse(&update.provider)?, &update.api_key)
}

#[tauri::command]
pub async fn search_game_metadata(
    query: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<MetadataSearchResult>> {
    let service = state.online_metadata.clone();
    tauri::async_runtime::spawn_blocking(move || service.search_rawg(&query))
        .await
        .map_err(|error| AppError::Task(error.to_string()))?
}

#[tauri::command]
pub async fn apply_game_metadata(
    selection: MetadataSelection,
    state: State<'_, AppState>,
) -> AppResult<LibrarySnapshot> {
    let service = state.online_metadata.clone();
    let database = state.database.clone();
    let ffmpeg_available = state.ffmpeg.available;
    let ffmpeg_source = state.ffmpeg.source.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let update = service.resolve_rawg(&selection.game_id, &selection.rawg_id)?;
        database.apply_provider_metadata(&update)?;
        database.load_library(ffmpeg_available, &ffmpeg_source)
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?
}

#[tauri::command]
pub async fn set_custom_artwork(
    update: CustomArtworkUpdate,
    state: State<'_, AppState>,
) -> AppResult<LibrarySnapshot> {
    let database = state.database.clone();
    let ffmpeg_available = state.ffmpeg.available;
    let ffmpeg_source = state.ffmpeg.source.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !matches!(update.kind.as_str(), "poster" | "hero") {
            return Err(AppError::InvalidInput("Unknown artwork type.".to_owned()));
        }
        if update.game_id.len() > 128
            || !update
                .game_id
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-')
        {
            return Err(AppError::InvalidInput("Invalid game ID.".to_owned()));
        }
        let source = PathBuf::from(&update.source_path);
        let source = source
            .canonicalize()
            .map_err(|_| AppError::InvalidInput("The image file was not found.".to_owned()))?;
        if !source.is_file() {
            return Err(AppError::InvalidInput(
                "The selected artwork is not a file.".to_owned(),
            ));
        }
        let size = source.metadata()?.len();
        if size > 25 * 1024 * 1024 {
            return Err(AppError::InvalidInput(
                "Artwork must not exceed 25 MB.".to_owned(),
            ));
        }
        let bytes = std::fs::read(&source)?;
        let extension = safe_image_extension(&source, &bytes)?;
        let hash = blake3::hash(&bytes).to_hex();
        let directory = database.cache_path().join("artwork").join("manual");
        std::fs::create_dir_all(&directory)?;
        let destination = directory.join(format!(
            "{}-{}-{}.{}",
            update.game_id,
            update.kind,
            &hash[..12],
            extension
        ));
        if !destination.exists() {
            std::fs::write(&destination, bytes)?;
        }
        database.set_custom_artwork(&update.game_id, &update.kind, &destination)?;
        database.load_library(ffmpeg_available, &ffmpeg_source)
    })
    .await
    .map_err(|error| AppError::Task(error.to_string()))?
}

fn safe_image_extension(path: &Path, bytes: &[u8]) -> AppResult<&'static str> {
    let extension = match path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("jpg" | "jpeg") if bytes.starts_with(&[0xff, 0xd8, 0xff]) => Some("jpg"),
        Some("png") if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => Some("png"),
        Some("webp") if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") => {
            Some("webp")
        }
        _ => None,
    };
    extension.ok_or_else(|| {
        AppError::InvalidInput("Valid JPG, PNG, and WebP files are supported.".to_owned())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playable_paths_skip_missing_neighbours_and_recalculate_the_start_index() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let selected = directory.path().join("selected.mp4");
        let later = directory.path().join("later.mp4");
        std::fs::write(&selected, b"selected").expect("selected clip");
        std::fs::write(&later, b"later").expect("later clip");

        let playlist = ClipPlaylist {
            clips: vec![
                ("missing".to_owned(), directory.path().join("missing.mp4")),
                ("selected".to_owned(), selected.clone()),
                ("later".to_owned(), later.clone()),
            ],
            selected_index: 1,
        };

        let (paths, selected_index) = playable_clip_paths(playlist).expect("playable paths");
        assert_eq!(paths, vec![selected, later]);
        assert_eq!(selected_index, 0);
    }

    #[test]
    fn playable_paths_reject_a_missing_selected_clip() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let playlist = ClipPlaylist {
            clips: vec![("selected".to_owned(), directory.path().join("missing.mp4"))],
            selected_index: 0,
        };

        let error = playable_clip_paths(playlist).expect_err("missing selected clip");
        assert!(error.to_string().contains("no longer available"));
    }
}
