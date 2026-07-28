use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MetadataStatus {
    Matched,
    Manual,
    Unresolved,
}

impl MetadataStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Matched => "matched",
            Self::Manual => "manual",
            Self::Unresolved => "unresolved",
        }
    }

    pub fn from_database(value: &str) -> Self {
        match value {
            "matched" => Self::Matched,
            "manual" => Self::Manual,
            _ => Self::Unresolved,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub game_id: String,
    pub path: String,
    pub file_name: String,
    pub extension: String,
    pub size_bytes: u64,
    pub created_at: i64,
    pub duration_seconds: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub codec: Option<String>,
    pub compatible: bool,
    #[serde(skip, default)]
    pub audio_compatible: Option<bool>,
    #[serde(skip, default)]
    pub video_compatible: Option<bool>,
    pub thumbnail_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    pub folder_path: String,
    pub folder_name: String,
    pub title: String,
    pub description: Option<String>,
    pub genres: Vec<String>,
    pub release_year: Option<u16>,
    pub metadata_status: MetadataStatus,
    pub accent_start: String,
    pub accent_end: String,
    pub metadata_provider: Option<String>,
    pub metadata_provider_id: Option<String>,
    pub artwork_provider: Option<String>,
    pub artwork_provider_id: Option<String>,
    pub poster_path: Option<String>,
    pub hero_path: Option<String>,
    #[serde(skip, default)]
    pub clips: Vec<Clip>,
    pub clip_count: usize,
    pub newest_clip_at: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct CachedClip {
    pub size_bytes: u64,
    pub created_at: i64,
    pub duration_seconds: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub codec: Option<String>,
    pub audio_compatible: Option<bool>,
    pub video_compatible: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipCursor {
    pub created_at: i64,
    pub id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipPage {
    pub clips: Vec<Clip>,
    pub total: usize,
    pub next_cursor: Option<ClipCursor>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    pub root_path: String,
    pub cache_path: String,
    pub last_scanned_at: Option<i64>,
    pub ffmpeg_available: bool,
    pub ffmpeg_source: String,
    pub games: Vec<Game>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapState {
    pub configured: bool,
    pub root_path: Option<String>,
    pub cache_path: String,
    pub ffmpeg_available: bool,
    pub ffmpeg_source: String,
    pub media_compatibility_scan_required: bool,
    pub library: Option<LibrarySnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub library: LibrarySnapshot,
    pub games_discovered: usize,
    pub clips_discovered: usize,
    pub clips_probed: usize,
    pub clips_reused: usize,
    pub thumbnails_created: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataUpdate {
    pub game_id: String,
    pub title: String,
    pub description: Option<String>,
    pub genres: Vec<String>,
    pub release_year: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettings {
    pub rawg_configured: bool,
    pub steam_grid_db_configured: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyUpdate {
    pub provider: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSearchResult {
    pub provider_id: String,
    pub title: String,
    pub release_year: Option<u16>,
    pub genres: Vec<String>,
    pub platforms: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSelection {
    pub game_id: String,
    pub rawg_id: String,
}

#[derive(Debug, Clone)]
pub struct ProviderMetadataUpdate {
    pub game_id: String,
    pub title: String,
    pub description: Option<String>,
    pub genres: Vec<String>,
    pub release_year: Option<u16>,
    pub metadata_provider: String,
    pub metadata_provider_id: String,
    pub artwork_provider: Option<String>,
    pub artwork_provider_id: Option<String>,
    pub poster_path: Option<String>,
    pub hero_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomArtworkUpdate {
    pub game_id: String,
    pub kind: String,
    pub source_path: String,
}
