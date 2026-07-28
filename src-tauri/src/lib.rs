mod commands;
mod database;
mod errors;
mod library;
mod metadata;
mod models;
mod player;
mod video;

use commands::{
    AppState, apply_game_metadata, configure_library, get_bootstrap,
    get_external_player_availability, get_game_clips, get_library, get_provider_settings,
    open_external_playlist, save_provider_api_key, scan_library, search_game_metadata,
    set_custom_artwork, stop_external_player, update_game_metadata,
};
use database::Database;
use metadata::OnlineMetadataService;
use player::ExternalPlayerService;
use tauri::Manager;
use video::FfmpegTools;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
                external_player: ExternalPlayerService::new(database.cache_path()),
                database,
                ffmpeg: FfmpegTools::detect(resource_dir.as_deref()),
                online_metadata,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_bootstrap,
            get_library,
            get_game_clips,
            configure_library,
            scan_library,
            get_external_player_availability,
            open_external_playlist,
            stop_external_player,
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
