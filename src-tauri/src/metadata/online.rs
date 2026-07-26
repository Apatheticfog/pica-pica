use super::secrets::{ProviderKey, SecretStore};
use crate::errors::{AppError, AppResult};
use crate::models::{MetadataSearchResult, ProviderMetadataUpdate, ProviderSettings};
use reqwest::Url;
use reqwest::blocking::{Client, Response};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

const MAX_ARTWORK_BYTES: usize = 25 * 1024 * 1024;
const STEAM_GRID_POSTER_DIMENSIONS: &str = "660x930,600x900";
const STEAM_GRID_POSTER_FALLBACK_DIMENSIONS: &str = "342x482";
const STEAM_GRID_HERO_DIMENSIONS: &str = "3840x1240,1920x620,1600x650";

#[derive(Debug, Clone)]
pub struct OnlineMetadataService {
    client: Client,
    secrets: SecretStore,
    metadata_cache: PathBuf,
    artwork_cache: PathBuf,
}

#[derive(Debug, Deserialize, Serialize)]
struct NamedValue {
    name: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct PlatformValue {
    platform: NamedValue,
}

#[derive(Debug, Deserialize, Serialize)]
struct RawgGame {
    id: u64,
    name: String,
    released: Option<String>,
    #[serde(default)]
    description_raw: Option<String>,
    #[serde(default)]
    background_image: Option<String>,
    #[serde(default)]
    genres: Vec<NamedValue>,
    #[serde(default)]
    platforms: Vec<PlatformValue>,
}

#[derive(Debug, Deserialize)]
struct RawgSearchResponse {
    #[serde(default)]
    results: Vec<RawgGame>,
}

#[derive(Debug, Deserialize)]
struct SteamGridResponse<T> {
    success: bool,
    #[serde(default)]
    data: Vec<T>,
}

#[derive(Debug, Default, Deserialize)]
struct SteamGridGame {
    id: u64,
    name: String,
    #[serde(default)]
    verified: bool,
}

#[derive(Debug, Default, Deserialize)]
struct SteamGridAsset {
    url: String,
}

#[derive(Debug, Default)]
struct ArtworkMatch {
    provider_id: Option<String>,
    poster_path: Option<String>,
    hero_path: Option<String>,
}

impl OnlineMetadataService {
    pub fn new(cache_path: &Path) -> AppResult<Self> {
        let metadata_cache = cache_path.join("metadata");
        let artwork_cache = cache_path.join("artwork").join("providers");
        std::fs::create_dir_all(&metadata_cache)?;
        std::fs::create_dir_all(&artwork_cache)?;
        let client = Client::builder()
            .user_agent(concat!("Pica-Pica/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(12))
            .connect_timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::limited(4))
            .build()
            .map_err(network_error)?;
        Ok(Self {
            client,
            secrets: SecretStore,
            metadata_cache,
            artwork_cache,
        })
    }

    pub fn settings(&self) -> ProviderSettings {
        ProviderSettings {
            rawg_configured: self.secrets.read(ProviderKey::Rawg).is_some(),
            steam_grid_db_configured: self.secrets.read(ProviderKey::SteamGridDb).is_some(),
        }
    }

    pub fn save_key(&self, provider: ProviderKey, api_key: &str) -> AppResult<ProviderSettings> {
        self.secrets.write(provider, api_key)?;
        Ok(self.settings())
    }

    pub fn search_rawg(&self, query: &str) -> AppResult<Vec<MetadataSearchResult>> {
        let query = query.trim();
        if query.len() < 2 || query.len() > 120 {
            return Err(AppError::InvalidInput(
                "The search query must be between 2 and 120 characters long.".to_owned(),
            ));
        }
        let key = self.require_key(ProviderKey::Rawg, "RAWG")?;
        let response = self
            .client
            .get("https://api.rawg.io/api/games")
            .query(&[
                ("key", key.as_str()),
                ("search", query),
                ("search_precise", "true"),
                ("page_size", "8"),
            ])
            .send()
            .and_then(Response::error_for_status)
            .map_err(network_error)?
            .json::<RawgSearchResponse>()
            .map_err(network_error)?;

        Ok(response
            .results
            .into_iter()
            .map(|game| MetadataSearchResult {
                provider_id: game.id.to_string(),
                title: game.name,
                release_year: year_from_date(game.released.as_deref()),
                genres: game.genres.into_iter().map(|genre| genre.name).collect(),
                platforms: game
                    .platforms
                    .into_iter()
                    .map(|platform| platform.platform.name)
                    .collect(),
            })
            .collect())
    }

    pub fn resolve_rawg(&self, game_id: &str, rawg_id: &str) -> AppResult<ProviderMetadataUpdate> {
        let numeric_id = rawg_id
            .parse::<u64>()
            .map_err(|_| AppError::InvalidInput("Invalid RAWG ID.".to_owned()))?;
        let key = self.require_key(ProviderKey::Rawg, "RAWG")?;
        let details = self
            .client
            .get(format!("https://api.rawg.io/api/games/{numeric_id}"))
            .query(&[("key", key.as_str())])
            .send()
            .and_then(Response::error_for_status)
            .map_err(network_error)?
            .json::<RawgGame>()
            .map_err(network_error)?;

        let cache_file = self.metadata_cache.join(format!("rawg-{numeric_id}.json"));
        let encoded = serde_json::to_vec_pretty(&details)
            .map_err(|error| AppError::Network(error.to_string()))?;
        std::fs::write(cache_file, encoded)?;

        let mut artwork = self.steam_grid_artwork(&details.name).unwrap_or_default();
        if artwork.hero_path.is_none()
            && let Some(url) = details.background_image.as_deref()
        {
            artwork.hero_path = self.download_artwork(url, "rawg-hero").ok();
        }
        let artwork_provider = if artwork.provider_id.is_some() {
            Some("steamgriddb".to_owned())
        } else if artwork.hero_path.is_some() {
            Some("rawg".to_owned())
        } else {
            None
        };

        Ok(ProviderMetadataUpdate {
            game_id: game_id.to_owned(),
            title: details.name,
            description: details
                .description_raw
                .filter(|value| !value.trim().is_empty()),
            genres: details.genres.into_iter().map(|genre| genre.name).collect(),
            release_year: year_from_date(details.released.as_deref()),
            metadata_provider: "rawg".to_owned(),
            metadata_provider_id: numeric_id.to_string(),
            artwork_provider,
            artwork_provider_id: artwork.provider_id,
            poster_path: artwork.poster_path,
            hero_path: artwork.hero_path,
        })
    }

    fn steam_grid_artwork(&self, title: &str) -> AppResult<ArtworkMatch> {
        let key = self.require_key(ProviderKey::SteamGridDb, "SteamGridDB")?;
        let mut url = Url::parse("https://www.steamgriddb.com/api/v2/search/autocomplete/")
            .map_err(network_error)?;
        url.path_segments_mut()
            .map_err(|_| AppError::Network("The SteamGridDB URL is invalid.".to_owned()))?
            .push(title);
        let response = self
            .steam_grid_get(url, &key)?
            .json::<SteamGridResponse<SteamGridGame>>()
            .map_err(network_error)?;
        if !response.success {
            return Ok(ArtworkMatch::default());
        }
        let normalized = normalize(title);
        let game = response
            .data
            .iter()
            .find(|game| normalize(&game.name) == normalized && game.verified)
            .or_else(|| {
                response
                    .data
                    .iter()
                    .find(|game| normalize(&game.name) == normalized)
            })
            .or_else(|| response.data.first());
        let Some(game) = game else {
            return Ok(ArtworkMatch::default());
        };

        let poster = self.steam_grid_asset("grids", game.id, &key)?;
        let hero = self.steam_grid_asset("heroes", game.id, &key)?;
        Ok(ArtworkMatch {
            provider_id: Some(game.id.to_string()),
            poster_path: poster
                .as_deref()
                .and_then(|url| self.download_artwork(url, "steamgriddb-poster").ok()),
            hero_path: hero
                .as_deref()
                .and_then(|url| self.download_artwork(url, "steamgriddb-hero").ok()),
        })
    }

    fn steam_grid_asset(&self, kind: &str, game_id: u64, key: &str) -> AppResult<Option<String>> {
        let dimensions = match kind {
            "grids" => STEAM_GRID_POSTER_DIMENSIONS,
            "heroes" => STEAM_GRID_HERO_DIMENSIONS,
            _ => {
                return Err(AppError::InvalidInput(
                    "Unsupported SteamGridDB artwork type.".to_owned(),
                ));
            }
        };
        let asset = self.steam_grid_asset_with_dimensions(kind, game_id, key, dimensions)?;
        if asset.is_some() || kind != "grids" {
            return Ok(asset);
        }
        self.steam_grid_asset_with_dimensions(
            kind,
            game_id,
            key,
            STEAM_GRID_POSTER_FALLBACK_DIMENSIONS,
        )
    }

    fn steam_grid_asset_with_dimensions(
        &self,
        kind: &str,
        game_id: u64,
        key: &str,
        dimensions: &str,
    ) -> AppResult<Option<String>> {
        let url = steam_grid_asset_url(kind, game_id, dimensions)?;
        let response = self
            .steam_grid_get(url, key)?
            .json::<SteamGridResponse<SteamGridAsset>>()
            .map_err(network_error)?;
        Ok(response.data.into_iter().next().map(|asset| asset.url))
    }

    fn steam_grid_get(&self, url: Url, key: &str) -> AppResult<Response> {
        self.client
            .get(url)
            .header(AUTHORIZATION, format!("Bearer {key}"))
            .send()
            .and_then(Response::error_for_status)
            .map_err(network_error)
    }

    fn require_key(&self, provider: ProviderKey, label: &str) -> AppResult<String> {
        self.secrets.read(provider).ok_or_else(|| {
            AppError::InvalidInput(format!("Add a {label} API key in Settings first."))
        })
    }

    fn download_artwork(&self, raw_url: &str, slot: &str) -> AppResult<String> {
        let url = Url::parse(raw_url).map_err(network_error)?;
        if url.scheme() != "https" || !allowed_artwork_host(url.host_str().unwrap_or_default()) {
            return Err(AppError::Network(
                "The artwork source was rejected for security reasons.".to_owned(),
            ));
        }
        let response = self
            .client
            .get(url.clone())
            .send()
            .and_then(Response::error_for_status)
            .map_err(network_error)?;
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .split(';')
            .next()
            .unwrap_or_default();
        let extension = match content_type {
            "image/jpeg" => "jpg",
            "image/png" => "png",
            "image/webp" => "webp",
            _ => {
                return Err(AppError::Network(
                    "The artwork uses an unsupported file format.".to_owned(),
                ));
            }
        };
        if response
            .content_length()
            .is_some_and(|length| length > MAX_ARTWORK_BYTES as u64)
        {
            return Err(AppError::Network("The artwork is too large.".to_owned()));
        }
        let bytes = response.bytes().map_err(network_error)?;
        if bytes.len() > MAX_ARTWORK_BYTES {
            return Err(AppError::Network("The artwork is too large.".to_owned()));
        }
        let hash = blake3::hash(url.as_str().as_bytes()).to_hex();
        let path = self
            .artwork_cache
            .join(format!("{slot}-{}.{}", &hash[..20], extension));
        if !path.exists() {
            std::fs::write(&path, bytes)?;
        }
        Ok(path.to_string_lossy().into_owned())
    }
}

fn network_error(error: impl std::fmt::Display) -> AppError {
    AppError::Network(error.to_string())
}

fn year_from_date(date: Option<&str>) -> Option<u16> {
    date?.get(..4)?.parse().ok()
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .filter(|character| character.is_alphanumeric())
        .collect()
}

fn allowed_artwork_host(host: &str) -> bool {
    ["steamgriddb.com", "rawg.io"]
        .iter()
        .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
}

fn steam_grid_asset_url(kind: &str, game_id: u64, dimensions: &str) -> AppResult<Url> {
    if !matches!(kind, "grids" | "heroes") {
        return Err(AppError::InvalidInput(
            "Unsupported SteamGridDB artwork type.".to_owned(),
        ));
    }
    let mut url = Url::parse(&format!(
        "https://www.steamgriddb.com/api/v2/{kind}/game/{game_id}"
    ))
    .map_err(network_error)?;
    url.query_pairs_mut()
        .append_pair("types", "static")
        .append_pair("dimensions", dimensions);
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_release_year() {
        assert_eq!(year_from_date(Some("2022-10-04")), Some(2022));
        assert_eq!(year_from_date(None), None);
    }

    #[test]
    fn artwork_hosts_are_restricted() {
        assert!(allowed_artwork_host("cdn2.steamgriddb.com"));
        assert!(allowed_artwork_host("media.rawg.io"));
        assert!(!allowed_artwork_host("steamgriddb.com.example.org"));
        assert!(!allowed_artwork_host("127.0.0.1"));
    }

    #[test]
    fn steam_grid_asset_urls_request_high_resolution_static_artwork() {
        let poster_url = steam_grid_asset_url("grids", 42, STEAM_GRID_POSTER_DIMENSIONS).unwrap();
        assert_eq!(poster_url.path(), "/api/v2/grids/game/42");
        assert_eq!(
            poster_url
                .query_pairs()
                .find(|(key, _)| key == "types")
                .map(|(_, value)| value.into_owned()),
            Some("static".to_owned())
        );
        assert_eq!(
            poster_url
                .query_pairs()
                .find(|(key, _)| key == "dimensions")
                .map(|(_, value)| value.into_owned()),
            Some(STEAM_GRID_POSTER_DIMENSIONS.to_owned())
        );

        let fallback_url =
            steam_grid_asset_url("grids", 42, STEAM_GRID_POSTER_FALLBACK_DIMENSIONS).unwrap();
        assert_eq!(
            fallback_url
                .query_pairs()
                .find(|(key, _)| key == "dimensions")
                .map(|(_, value)| value.into_owned()),
            Some(STEAM_GRID_POSTER_FALLBACK_DIMENSIONS.to_owned())
        );

        let hero_url = steam_grid_asset_url("heroes", 7, STEAM_GRID_HERO_DIMENSIONS).unwrap();
        assert_eq!(hero_url.path(), "/api/v2/heroes/game/7");
        assert_eq!(
            hero_url
                .query_pairs()
                .find(|(key, _)| key == "dimensions")
                .map(|(_, value)| value.into_owned()),
            Some(STEAM_GRID_HERO_DIMENSIONS.to_owned())
        );
    }
}
