mod commands;
mod database;
mod errors;
mod library;
mod metadata;
mod models;
mod player;
mod video;

use commands::{
    AppState, apply_game_metadata, configure_library, get_bootstrap, get_game_clips, get_library,
    get_mpv_availability, get_mpv_snapshot, get_provider_settings, mpv_load_clip, mpv_preview_seek,
    mpv_seek, mpv_set_muted, mpv_set_paused, mpv_set_viewport, mpv_set_volume, mpv_stop,
    save_provider_api_key, scan_library, search_game_metadata, set_custom_artwork,
    update_game_metadata,
};
use database::Database;
use metadata::OnlineMetadataService;
use player::MpvService;
use tauri::Manager;
use video::FfmpegTools;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            let resource_dir = app.path().resource_dir().ok();
            let database = Database::open(&app_data)
                .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?;
            if let Some(root) = database
                .root_path()
                .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?
            {
                app.asset_protocol_scope().allow_directory(root, true)?;
            }
            let online_metadata = OnlineMetadataService::new(database.cache_path())
                .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?;
            app.manage(AppState {
                database,
                ffmpeg: FfmpegTools::detect(resource_dir.as_deref()),
                online_metadata,
                mpv: MpvService::new(resource_dir.as_deref()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_bootstrap,
            get_library,
            get_game_clips,
            configure_library,
            scan_library,
            get_mpv_availability,
            mpv_load_clip,
            mpv_set_viewport,
            get_mpv_snapshot,
            mpv_set_paused,
            mpv_preview_seek,
            mpv_seek,
            mpv_set_volume,
            mpv_set_muted,
            mpv_stop,
            update_game_metadata,
            get_provider_settings,
            save_provider_api_key,
            search_game_metadata,
            apply_game_metadata,
            set_custom_artwork,
        ])
        .run(tauri::generate_context!())
        .expect("Pica Pica could not start");
}
