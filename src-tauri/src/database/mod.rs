mod migrations;

use crate::errors::{AppError, AppResult};
use crate::models::{
    CachedClip, Clip, ClipCursor, ClipPage, Game, LibrarySnapshot, MetadataStatus, MetadataUpdate,
    ProviderMetadataUpdate,
};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct ClipPlaylist {
    pub clips: Vec<(String, PathBuf)>,
    pub selected_index: usize,
}

#[derive(Debug, Clone)]
pub struct Database {
    path: PathBuf,
    cache_path: PathBuf,
}

impl Database {
    pub fn open(app_data_path: &Path) -> AppResult<Self> {
        std::fs::create_dir_all(app_data_path)?;
        let cache_path = app_data_path.join("cache");
        std::fs::create_dir_all(cache_path.join("metadata"))?;
        std::fs::create_dir_all(cache_path.join("artwork"))?;
        std::fs::create_dir_all(cache_path.join("thumbnails"))?;
        let database = Self {
            path: app_data_path.join("library.sqlite"),
            cache_path,
        };
        let connection = database.connection()?;
        migrations::migrate(&connection)?;
        Ok(database)
    }

    fn connection(&self) -> AppResult<Connection> {
        let connection = Connection::open(&self.path)?;
        connection.pragma_update(None, "foreign_keys", true)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(connection)
    }

    pub fn cache_path(&self) -> &Path {
        &self.cache_path
    }

    pub fn root_path(&self) -> AppResult<Option<PathBuf>> {
        let connection = self.connection()?;
        let value = connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'library_root'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(value.map(PathBuf::from))
    }

    pub fn media_compatibility_scan_required(&self) -> AppResult<bool> {
        let connection = self.connection()?;
        let pending = connection.query_row(
            r#"SELECT EXISTS(
                 SELECT 1
                 FROM clips
                 WHERE audio_compatible IS NULL OR video_compatible IS NULL
                 LIMIT 1
               )"#,
            [],
            |row| row.get::<_, i64>(0),
        )?;
        Ok(pending != 0)
    }

    pub fn persist_scan(
        &self,
        root: &Path,
        games: &[Game],
        scanned_at: i64,
        prune_missing: bool,
    ) -> AppResult<()> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        let scan_generation = transaction.query_row(
            "SELECT COALESCE(MAX(updated_at), 0) + 1 FROM games",
            [],
            |row| row.get::<_, i64>(0),
        )?;
        transaction.execute(
            "INSERT INTO settings(key, value) VALUES('library_root', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [root.to_string_lossy().as_ref()],
        )?;
        transaction.execute(
            "INSERT INTO settings(key, value) VALUES('last_scanned_at', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [scanned_at.to_string()],
        )?;

        for game in games {
            let genres = serde_json::to_string(&game.genres).unwrap_or_else(|_| "[]".to_owned());
            transaction.execute(
                r#"INSERT INTO games(
                  id, folder_path, folder_name, title, description, genres_json, release_year,
                  metadata_status, accent_start, accent_end, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ON CONFLICT(id) DO UPDATE SET
                  folder_path = excluded.folder_path,
                  folder_name = excluded.folder_name,
                  title = CASE WHEN games.metadata_status = 'manual' OR games.metadata_provider IS NOT NULL THEN games.title ELSE excluded.title END,
                  description = CASE WHEN games.metadata_status = 'manual' OR games.metadata_provider IS NOT NULL THEN games.description ELSE excluded.description END,
                  genres_json = CASE WHEN games.metadata_status = 'manual' OR games.metadata_provider IS NOT NULL THEN games.genres_json ELSE excluded.genres_json END,
                  release_year = CASE WHEN games.metadata_status = 'manual' OR games.metadata_provider IS NOT NULL THEN games.release_year ELSE excluded.release_year END,
                  metadata_status = CASE WHEN games.metadata_status = 'manual' OR games.metadata_provider IS NOT NULL THEN games.metadata_status ELSE excluded.metadata_status END,
                  accent_start = CASE WHEN games.metadata_status = 'manual' OR games.metadata_provider IS NOT NULL THEN games.accent_start ELSE excluded.accent_start END,
                  accent_end = CASE WHEN games.metadata_status = 'manual' OR games.metadata_provider IS NOT NULL THEN games.accent_end ELSE excluded.accent_end END,
                  updated_at = excluded.updated_at"#,
                params![
                    game.id, game.folder_path, game.folder_name, game.title, game.description, genres,
                    game.release_year, game.metadata_status.as_str(), game.accent_start, game.accent_end, scan_generation,
                ],
            )?;

            for clip in &game.clips {
                transaction.execute(
                    r#"INSERT INTO clips(
                      id, game_id, path, file_name, extension, size_bytes, created_at, duration_seconds,
                      width, height, codec, compatible, audio_compatible, video_compatible,
                      thumbnail_path, updated_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
                    ON CONFLICT(id) DO UPDATE SET
                      game_id = excluded.game_id, path = excluded.path, file_name = excluded.file_name,
                      extension = excluded.extension, size_bytes = excluded.size_bytes, created_at = excluded.created_at,
                      duration_seconds = excluded.duration_seconds, width = excluded.width, height = excluded.height,
                      codec = excluded.codec, compatible = excluded.compatible,
                      audio_compatible = excluded.audio_compatible,
                      video_compatible = excluded.video_compatible,
                      thumbnail_path = excluded.thumbnail_path,
                      updated_at = excluded.updated_at"#,
                    params![
                        clip.id, clip.game_id, clip.path, clip.file_name, clip.extension, clip.size_bytes as i64,
                        clip.created_at, clip.duration_seconds, clip.width, clip.height, clip.codec,
                        i64::from(clip.compatible), clip.audio_compatible.map(i64::from),
                        clip.video_compatible.map(i64::from), clip.thumbnail_path, scan_generation,
                    ],
                )?;
            }
        }

        if prune_missing {
            transaction.execute(
                "DELETE FROM clips WHERE updated_at != ?1",
                [scan_generation],
            )?;
            transaction.execute(
                "DELETE FROM games WHERE updated_at != ?1",
                [scan_generation],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn cached_clips(&self) -> AppResult<HashMap<String, CachedClip>> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, size_bytes, created_at, duration_seconds, width, height, codec,
                    audio_compatible, video_compatible
             FROM clips",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                CachedClip {
                    size_bytes: row.get::<_, i64>(1)? as u64,
                    created_at: row.get(2)?,
                    duration_seconds: row.get(3)?,
                    width: row.get(4)?,
                    height: row.get(5)?,
                    codec: row.get(6)?,
                    audio_compatible: row
                        .get::<_, Option<i64>>(7)?
                        .map(|value| value != 0),
                    video_compatible: row
                        .get::<_, Option<i64>>(8)?
                        .map(|value| value != 0),
                },
            ))
        })?;
        Ok(rows.collect::<Result<HashMap<_, _>, _>>()?)
    }

    pub fn load_library(
        &self,
        ffmpeg_available: bool,
        ffmpeg_source: &str,
    ) -> AppResult<LibrarySnapshot> {
        let root = self.root_path()?.ok_or(AppError::NotConfigured)?;
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            r#"SELECT g.id, g.folder_path, g.folder_name, g.title, g.description, g.genres_json,
               g.release_year, g.metadata_status, g.accent_start, g.accent_end,
               g.metadata_provider, g.metadata_provider_id, g.artwork_provider,
               g.artwork_provider_id, g.poster_path, g.hero_path,
               COUNT(c.id), MAX(c.created_at)
               FROM games g
               LEFT JOIN clips c ON c.game_id = g.id
               GROUP BY g.id"#,
        )?;
        let rows = statement.query_map([], |row| {
            let genres_json: String = row.get(5)?;
            Ok(Game {
                id: row.get(0)?,
                folder_path: row.get(1)?,
                folder_name: row.get(2)?,
                title: row.get(3)?,
                description: row.get(4)?,
                genres: serde_json::from_str(&genres_json).unwrap_or_default(),
                release_year: row.get(6)?,
                metadata_status: MetadataStatus::from_database(&row.get::<_, String>(7)?),
                accent_start: row.get(8)?,
                accent_end: row.get(9)?,
                metadata_provider: row.get(10)?,
                metadata_provider_id: row.get(11)?,
                artwork_provider: row.get(12)?,
                artwork_provider_id: row.get(13)?,
                poster_path: row.get(14)?,
                hero_path: row.get(15)?,
                clips: Vec::new(),
                clip_count: row.get::<_, i64>(16)? as usize,
                newest_clip_at: row.get(17)?,
            })
        })?;
        let mut games = rows.collect::<Result<Vec<_>, _>>()?;
        games.sort_by_key(|game| std::cmp::Reverse(game.newest_clip_at.unwrap_or_default()));

        let last_scanned_at = connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'last_scanned_at'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .and_then(|value| value.parse().ok());
        Ok(LibrarySnapshot {
            root_path: root.to_string_lossy().into_owned(),
            cache_path: self.cache_path.to_string_lossy().into_owned(),
            last_scanned_at,
            ffmpeg_available,
            ffmpeg_source: ffmpeg_source.to_owned(),
            games,
        })
    }

    pub fn load_clip_page(
        &self,
        game_id: &str,
        cursor: Option<&ClipCursor>,
        limit: usize,
    ) -> AppResult<ClipPage> {
        let connection = self.connection()?;
        let total = connection.query_row(
            "SELECT COUNT(*) FROM clips WHERE game_id = ?1",
            [game_id],
            |row| row.get::<_, i64>(0),
        )? as usize;
        let cursor_created_at = cursor.map(|value| value.created_at);
        let cursor_id = cursor.map(|value| value.id.as_str());
        let mut statement = connection.prepare(
            r#"SELECT id, game_id, path, file_name, extension, size_bytes, created_at,
               duration_seconds, width, height, codec, compatible, audio_compatible,
               video_compatible, thumbnail_path
               FROM clips
               WHERE game_id = ?1
                 AND (?2 IS NULL OR (created_at, id) < (?2, ?3))
               ORDER BY created_at DESC, id DESC
               LIMIT ?4"#,
        )?;
        let rows = statement.query_map(
            params![game_id, cursor_created_at, cursor_id, (limit + 1) as i64],
            clip_from_row,
        )?;
        let mut clips = rows.collect::<Result<Vec<_>, _>>()?;
        let has_more = clips.len() > limit;
        clips.truncate(limit);
        let next_cursor = has_more.then(|| {
            let clip = clips.last().expect("a paginated result has a last clip");
            ClipCursor {
                created_at: clip.created_at,
                id: clip.id.clone(),
            }
        });
        Ok(ClipPage {
            clips,
            total,
            next_cursor,
        })
    }

    pub fn clip_playlist(&self, game_id: &str, clip_id: &str) -> AppResult<ClipPlaylist> {
        let connection = self.connection()?;
        let selected_game_id = connection
            .query_row(
                "SELECT game_id FROM clips WHERE id = ?1",
                [clip_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| AppError::InvalidInput("The clip was not found.".to_owned()))?;

        if selected_game_id != game_id {
            return Err(AppError::InvalidInput(
                "The selected clip does not belong to this game.".to_owned(),
            ));
        }

        let mut statement = connection.prepare(
            r#"SELECT id, path
               FROM clips
               WHERE game_id = ?1
               ORDER BY created_at DESC, id DESC"#,
        )?;
        let rows = statement.query_map([game_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                PathBuf::from(row.get::<_, String>(1)?),
            ))
        })?;
        let clips = rows.collect::<Result<Vec<_>, _>>()?;
        let selected_index = clips
            .iter()
            .position(|(id, _)| id == clip_id)
            .ok_or_else(|| {
                AppError::InvalidInput("The clip is no longer part of this game.".to_owned())
            })?;

        Ok(ClipPlaylist {
            clips,
            selected_index,
        })
    }

    pub fn update_metadata(&self, update: &MetadataUpdate) -> AppResult<()> {
        if update.title.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "The game title cannot be empty.".to_owned(),
            ));
        }
        let genres = serde_json::to_string(&update.genres).unwrap_or_else(|_| "[]".to_owned());
        let connection = self.connection()?;
        let changed = connection.execute(
            "UPDATE games SET title = ?1, description = ?2, genres_json = ?3, release_year = ?4, metadata_status = 'manual' WHERE id = ?5",
            params![update.title.trim(), update.description, genres, update.release_year, update.game_id],
        )?;
        if changed == 0 {
            return Err(AppError::InvalidInput("The game was not found.".to_owned()));
        }
        Ok(())
    }

    pub fn apply_provider_metadata(&self, update: &ProviderMetadataUpdate) -> AppResult<()> {
        let genres = serde_json::to_string(&update.genres).unwrap_or_else(|_| "[]".to_owned());
        let connection = self.connection()?;
        let changed = connection.execute(
            r#"UPDATE games SET
              title = ?1, description = ?2, genres_json = ?3, release_year = ?4,
              metadata_status = 'matched', metadata_provider = ?5, metadata_provider_id = ?6,
              artwork_provider = CASE
                WHEN artwork_provider = 'manual' THEN artwork_provider
                ELSE COALESCE(?7, artwork_provider)
              END,
              artwork_provider_id = CASE
                WHEN artwork_provider = 'manual' THEN artwork_provider_id
                ELSE COALESCE(?8, artwork_provider_id)
              END,
              poster_path = CASE
                WHEN artwork_provider = 'manual' AND poster_path IS NOT NULL THEN poster_path
                ELSE COALESCE(?9, poster_path)
              END,
              hero_path = CASE
                WHEN artwork_provider = 'manual' AND hero_path IS NOT NULL THEN hero_path
                ELSE COALESCE(?10, hero_path)
              END
              WHERE id = ?11"#,
            params![
                update.title,
                update.description,
                genres,
                update.release_year,
                update.metadata_provider,
                update.metadata_provider_id,
                update.artwork_provider,
                update.artwork_provider_id,
                update.poster_path,
                update.hero_path,
                update.game_id,
            ],
        )?;
        if changed == 0 {
            return Err(AppError::InvalidInput("The game was not found.".to_owned()));
        }
        Ok(())
    }

    pub fn set_custom_artwork(&self, game_id: &str, kind: &str, path: &Path) -> AppResult<()> {
        let column = match kind {
            "poster" => "poster_path",
            "hero" => "hero_path",
            _ => {
                return Err(AppError::InvalidInput("Unknown artwork type.".to_owned()));
            }
        };
        let connection = self.connection()?;
        let sql = format!(
            "UPDATE games SET {column} = ?1, artwork_provider = 'manual', artwork_provider_id = NULL WHERE id = ?2"
        );
        let changed = connection.execute(&sql, params![path.to_string_lossy(), game_id])?;
        if changed == 0 {
            return Err(AppError::InvalidInput("The game was not found.".to_owned()));
        }
        Ok(())
    }
}

fn clip_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Clip> {
    Ok(Clip {
        id: row.get(0)?,
        game_id: row.get(1)?,
        path: row.get(2)?,
        file_name: row.get(3)?,
        extension: row.get(4)?,
        size_bytes: row.get::<_, i64>(5)? as u64,
        created_at: row.get(6)?,
        duration_seconds: row.get(7)?,
        width: row.get(8)?,
        height: row.get(9)?,
        codec: row.get(10)?,
        compatible: row.get::<_, i64>(11)? != 0,
        audio_compatible: row
            .get::<_, Option<i64>>(12)?
            .map(|value| value != 0),
        video_compatible: row
            .get::<_, Option<i64>>(13)?
            .map(|value| value != 0),
        thumbnail_path: row.get(14)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::MetadataStatus;

    fn sample_game(root: &Path) -> Game {
        Game {
            id: "game".to_owned(),
            folder_path: root.join("Game").to_string_lossy().into_owned(),
            folder_name: "Game".to_owned(),
            title: "Game".to_owned(),
            description: None,
            genres: Vec::new(),
            release_year: None,
            metadata_status: MetadataStatus::Unresolved,
            accent_start: "#111111".to_owned(),
            accent_end: "#222222".to_owned(),
            metadata_provider: None,
            metadata_provider_id: None,
            artwork_provider: None,
            artwork_provider_id: None,
            poster_path: None,
            hero_path: None,
            clips: Vec::new(),
            clip_count: 0,
            newest_clip_at: None,
        }
    }

    fn sample_clip(game_id: &str, path: &Path, id: &str, created_at: i64) -> Clip {
        Clip {
            id: id.to_owned(),
            game_id: game_id.to_owned(),
            path: path.to_string_lossy().into_owned(),
            file_name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            extension: "mp4".to_owned(),
            size_bytes: 128_000_000,
            created_at,
            duration_seconds: Some(30.0),
            width: Some(1920),
            height: Some(1080),
            codec: Some("h264".to_owned()),
            compatible: true,
            audio_compatible: Some(true),
            video_compatible: Some(true),
            thumbnail_path: None,
        }
    }

    #[test]
    fn repeated_scan_does_not_duplicate_games() {
        let temp = tempfile::tempdir().expect("temp dir");
        let database = Database::open(&temp.path().join("app")).expect("database");
        let root = temp.path().join("clips");
        std::fs::create_dir_all(&root).expect("root");
        database
            .persist_scan(&root, &[sample_game(&root)], 100, true)
            .expect("first scan");
        database
            .persist_scan(&root, &[sample_game(&root)], 200, true)
            .expect("second scan");
        assert_eq!(
            database
                .load_library(false, "missing")
                .expect("library")
                .games
                .len(),
            1
        );
    }

    #[test]
    fn compatibility_scan_flag_tracks_pending_rows() {
        let temp = tempfile::tempdir().expect("temp dir");
        let database = Database::open(&temp.path().join("app")).expect("database");
        assert!(!database
            .media_compatibility_scan_required()
            .expect("empty compatibility state"));

        let root = temp.path().join("clips");
        let mut game = sample_game(&root);
        let mut clip = sample_clip(
            &game.id,
            &root.join("Game").join("Replay.mp4"),
            "clip",
            100,
        );
        clip.compatible = false;
        clip.audio_compatible = None;
        clip.video_compatible = None;
        game.clips = vec![clip.clone()];
        game.clip_count = 1;
        database
            .persist_scan(&root, &[game.clone()], 100, true)
            .expect("pending scan");
        assert!(database
            .media_compatibility_scan_required()
            .expect("pending compatibility state"));

        clip.audio_compatible = Some(false);
        clip.video_compatible = Some(false);
        game.clips = vec![clip];
        database
            .persist_scan(&root, &[game], 200, true)
            .expect("resolved scan");
        assert!(!database
            .media_compatibility_scan_required()
            .expect("resolved compatibility state"));
    }

    #[test]
    fn manual_metadata_survives_a_rescan() {
        let temp = tempfile::tempdir().expect("temp dir");
        let database = Database::open(&temp.path().join("app")).expect("database");
        let root = temp.path().join("clips");
        std::fs::create_dir_all(&root).expect("root");
        database
            .persist_scan(&root, &[sample_game(&root)], 100, true)
            .expect("first scan");
        database
            .update_metadata(&MetadataUpdate {
                game_id: "game".to_owned(),
                title: "My Game".to_owned(),
                description: Some("Local notes".to_owned()),
                genres: vec!["Action".to_owned()],
                release_year: Some(2026),
            })
            .expect("manual metadata");
        database
            .persist_scan(&root, &[sample_game(&root)], 200, true)
            .expect("second scan");

        let library = database.load_library(false, "missing").expect("library");
        assert_eq!(library.games[0].title, "My Game");
        assert_eq!(library.games[0].metadata_status, MetadataStatus::Manual);
    }

    #[test]
    fn provider_metadata_and_artwork_survive_a_rescan() {
        let temp = tempfile::tempdir().expect("temp dir");
        let database = Database::open(&temp.path().join("app")).expect("database");
        let root = temp.path().join("clips");
        std::fs::create_dir_all(&root).expect("root");
        database
            .persist_scan(&root, &[sample_game(&root)], 100, true)
            .expect("first scan");
        database
            .apply_provider_metadata(&ProviderMetadataUpdate {
                game_id: "game".to_owned(),
                title: "Provider Game".to_owned(),
                description: Some("Cached metadata".to_owned()),
                genres: vec!["Adventure".to_owned()],
                release_year: Some(2024),
                metadata_provider: "rawg".to_owned(),
                metadata_provider_id: "42".to_owned(),
                artwork_provider: Some("steamgriddb".to_owned()),
                artwork_provider_id: Some("84".to_owned()),
                poster_path: Some("/cache/poster.jpg".to_owned()),
                hero_path: Some("/cache/hero.jpg".to_owned()),
            })
            .expect("provider metadata");
        database
            .persist_scan(&root, &[sample_game(&root)], 200, true)
            .expect("second scan");

        let library = database.load_library(false, "missing").expect("library");
        assert_eq!(library.games[0].title, "Provider Game");
        assert_eq!(library.games[0].metadata_provider_id.as_deref(), Some("42"));
        assert_eq!(
            library.games[0].poster_path.as_deref(),
            Some("/cache/poster.jpg")
        );
    }

    #[test]
    fn provider_metadata_does_not_replace_manual_artwork() {
        let temp = tempfile::tempdir().expect("temp dir");
        let database = Database::open(&temp.path().join("app")).expect("database");
        let root = temp.path().join("clips");
        std::fs::create_dir_all(&root).expect("root");
        database
            .persist_scan(&root, &[sample_game(&root)], 100, true)
            .expect("first scan");
        database
            .set_custom_artwork("game", "hero", Path::new("/manual/hero.jpg"))
            .expect("manual hero");
        database
            .apply_provider_metadata(&ProviderMetadataUpdate {
                game_id: "game".to_owned(),
                title: "Provider Game".to_owned(),
                description: Some("Cached metadata".to_owned()),
                genres: vec!["Adventure".to_owned()],
                release_year: Some(2024),
                metadata_provider: "rawg".to_owned(),
                metadata_provider_id: "42".to_owned(),
                artwork_provider: Some("steamgriddb".to_owned()),
                artwork_provider_id: Some("84".to_owned()),
                poster_path: Some("/cache/poster.jpg".to_owned()),
                hero_path: Some("/cache/hero.jpg".to_owned()),
            })
            .expect("provider metadata");

        let library = database.load_library(false, "missing").expect("library");
        assert_eq!(
            library.games[0].hero_path.as_deref(),
            Some("/manual/hero.jpg")
        );
        assert_eq!(
            library.games[0].poster_path.as_deref(),
            Some("/cache/poster.jpg")
        );
        assert_eq!(library.games[0].artwork_provider.as_deref(), Some("manual"));
    }

    #[test]
    fn external_playlist_uses_library_order_and_validates_game_membership() {
        let temp = tempfile::tempdir().expect("temp dir");
        let database = Database::open(&temp.path().join("app")).expect("database");
        let root = temp.path().join("clips");
        let game_root = root.join("Game");
        std::fs::create_dir_all(&game_root).expect("game root");
        let mut game = sample_game(&root);
        game.clips = vec![
            sample_clip(&game.id, &game_root.join("older.mp4"), "clip-older", 100),
            sample_clip(&game.id, &game_root.join("newer-a.mp4"), "clip-a", 200),
            sample_clip(&game.id, &game_root.join("newer-b.mp4"), "clip-b", 200),
        ];
        game.clip_count = game.clips.len();
        database
            .persist_scan(&root, &[game], 100, true)
            .expect("scan");

        let playlist = database
            .clip_playlist("game", "clip-a")
            .expect("playlist");
        assert_eq!(
            playlist
                .clips
                .iter()
                .map(|(id, _)| id.as_str())
                .collect::<Vec<_>>(),
            vec!["clip-b", "clip-a", "clip-older"]
        );
        assert_eq!(playlist.selected_index, 1);

        let error = database
            .clip_playlist("another-game", "clip-a")
            .expect_err("wrong game must be rejected");
        assert!(error.to_string().contains("does not belong"));
    }

    #[test]
    fn large_library_snapshot_stays_small_and_clips_are_cursor_paginated() {
        let temp = tempfile::tempdir().expect("temp dir");
        let database = Database::open(&temp.path().join("app")).expect("database");
        let root = temp.path().join("clips");
        std::fs::create_dir_all(&root).expect("root");
        let mut game = sample_game(&root);
        game.clips = (0..10_000)
            .map(|index| Clip {
                id: format!("clip-{index:05}"),
                game_id: game.id.clone(),
                path: root
                    .join("Game")
                    .join(format!("Replay-{index:05}.mp4"))
                    .to_string_lossy()
                    .into_owned(),
                file_name: format!("Replay-{index:05}.mp4"),
                extension: "mp4".to_owned(),
                size_bytes: 128_000_000,
                created_at: 20_000 - index,
                duration_seconds: Some(30.0),
                width: Some(1920),
                height: Some(1080),
                codec: Some("h264".to_owned()),
                compatible: true,
                audio_compatible: Some(true),
                video_compatible: Some(true),
                thumbnail_path: None,
            })
            .collect();
        game.clip_count = game.clips.len();
        database
            .persist_scan(&root, &[game], 100, true)
            .expect("large scan");

        let library = database.load_library(false, "missing").expect("library");
        assert_eq!(library.games[0].clip_count, 10_000);
        assert!(library.games[0].clips.is_empty());
        assert!(serde_json::to_vec(&library).expect("serialize").len() < 10_000);

        let first = database
            .load_clip_page("game", None, 48)
            .expect("first page");
        assert_eq!(first.total, 10_000);
        assert_eq!(first.clips.len(), 48);
        let second = database
            .load_clip_page("game", first.next_cursor.as_ref(), 48)
            .expect("second page");
        assert_eq!(second.clips.len(), 48);
        assert_ne!(first.clips[0].id, second.clips[0].id);
    }
}
