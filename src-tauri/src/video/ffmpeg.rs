use crate::errors::{AppError, AppResult};
use serde_json::Value;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const TOOL_CHECK_TIMEOUT: Duration = Duration::from_secs(3);
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const THUMBNAIL_TIMEOUT: Duration = Duration::from_secs(30);
const COMPATIBILITY_TIMEOUT: Duration = Duration::from_secs(30 * 60);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Default)]
pub struct VideoInfo {
    pub duration_seconds: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub codec: Option<String>,
}

#[derive(Debug, Clone)]
pub struct FfmpegTools {
    pub available: bool,
    pub source: String,
    ffmpeg_path: PathBuf,
    ffprobe_path: PathBuf,
}

impl FfmpegTools {
    #[cfg(test)]
    pub fn unavailable() -> Self {
        Self {
            available: false,
            source: "missing".to_owned(),
            ffmpeg_path: PathBuf::from(executable_name("ffmpeg")),
            ffprobe_path: PathBuf::from(executable_name("ffprobe")),
        }
    }

    pub fn detect(resource_dir: Option<&Path>) -> Self {
        if let Some(resource_dir) = resource_dir {
            for directory in [resource_dir.join("bin"), resource_dir.join("binaries")] {
                let ffmpeg = directory.join(executable_name("ffmpeg"));
                let ffprobe = directory.join(executable_name("ffprobe"));
                if tool_works(&ffmpeg) && tool_works(&ffprobe) {
                    return Self {
                        available: true,
                        source: "bundled".to_owned(),
                        ffmpeg_path: ffmpeg,
                        ffprobe_path: ffprobe,
                    };
                }
            }
        }

        let ffmpeg = PathBuf::from(executable_name("ffmpeg"));
        let ffprobe = PathBuf::from(executable_name("ffprobe"));
        let available = tool_works(&ffmpeg) && tool_works(&ffprobe);
        Self {
            available,
            source: if available { "system" } else { "missing" }.to_owned(),
            ffmpeg_path: ffmpeg,
            ffprobe_path: ffprobe,
        }
    }

    pub fn probe(&self, path: &Path) -> VideoInfo {
        if !self.available {
            return VideoInfo::default();
        }
        let mut command = hidden_command(&self.ffprobe_path);
        let child = command
            .args([
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_entries",
                "format=duration:stream=codec_type,codec_name,width,height",
            ])
            .arg(path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn();
        let Ok(child) = child else {
            return VideoInfo::default();
        };
        let Some((status, stdout)) = wait_for_child(child, PROBE_TIMEOUT) else {
            return VideoInfo::default();
        };
        if !status.success() {
            return VideoInfo::default();
        }
        let Ok(value) = serde_json::from_slice::<Value>(&stdout) else {
            return VideoInfo::default();
        };
        let video = value["streams"].as_array().and_then(|streams| {
            streams
                .iter()
                .find(|stream| stream["codec_type"] == "video")
        });
        VideoInfo {
            duration_seconds: value["format"]["duration"]
                .as_str()
                .and_then(|value| value.parse().ok()),
            width: video
                .and_then(|stream| stream["width"].as_u64())
                .map(|value| value as u32),
            height: video
                .and_then(|stream| stream["height"].as_u64())
                .map(|value| value as u32),
            codec: video
                .and_then(|stream| stream["codec_name"].as_str())
                .map(str::to_owned),
        }
    }

    pub fn thumbnail(&self, input: &Path, output: PathBuf) -> bool {
        if !self.available || output.exists() {
            return false;
        }
        let Some(parent) = output.parent() else {
            return false;
        };
        if std::fs::create_dir_all(parent).is_err() {
            return false;
        }
        let mut command = hidden_command(&self.ffmpeg_path);
        let child = command
            .args(["-loglevel", "error", "-ss", "00:00:01", "-i"])
            .arg(input)
            .args([
                "-frames:v",
                "1",
                "-vf",
                "scale=640:-2:force_original_aspect_ratio=decrease",
                "-q:v",
                "3",
                "-y",
            ])
            .arg(&output)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        child
            .ok()
            .and_then(|child| wait_for_child(child, THUMBNAIL_TIMEOUT))
            .is_some_and(|(status, _)| status.success())
    }

    pub fn compatibility_copy(&self, input: &Path, output: &Path) -> AppResult<PathBuf> {
        if !self.available {
            return Err(AppError::Task(
                "FFmpeg is unavailable, so this clip cannot be prepared for Linux playback."
                    .to_owned(),
            ));
        }
        if compatibility_copy_is_fresh(input, output) {
            return Ok(output.to_path_buf());
        }
        let parent = output
            .parent()
            .ok_or_else(|| AppError::Task("The compatibility cache path is invalid.".to_owned()))?;
        std::fs::create_dir_all(parent)?;

        let encoder = self.compatibility_encoder().ok_or_else(|| {
            AppError::Task(
                "FFmpeg does not provide a supported H.264 encoder (libopenh264 or libx264)."
                    .to_owned(),
            )
        })?;
        let file_name = output
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("clip.mp4");
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let temporary = output.with_file_name(format!(
            ".{file_name}.{}.{}.partial.mp4",
            std::process::id(),
            unique_suffix
        ));

        let mut command = hidden_command(&self.ffmpeg_path);
        command
            .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"])
            .arg(input)
            .args(["-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-c:v"])
            .arg(encoder);
        if encoder == "libx264" {
            command.args(["-preset", "veryfast", "-crf", "21"]);
        } else {
            command.args(["-b:v", "6M"]);
        }
        let child = command
            .args([
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-movflags",
                "+faststart",
            ])
            .arg(&temporary)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| AppError::Task(format!("FFmpeg could not start: {error}")))?;
        let succeeded = wait_for_child(child, COMPATIBILITY_TIMEOUT)
            .is_some_and(|(status, _)| status.success());
        if !succeeded || !temporary.is_file() {
            let _ = std::fs::remove_file(&temporary);
            return Err(AppError::Task(
                "FFmpeg could not create a browser-compatible H.264 copy.".to_owned(),
            ));
        }
        if compatibility_copy_is_fresh(input, output) {
            let _ = std::fs::remove_file(&temporary);
            return Ok(output.to_path_buf());
        }
        if output.is_file() {
            std::fs::remove_file(output)?;
        }
        std::fs::rename(&temporary, output)?;
        Ok(output.to_path_buf())
    }

    fn compatibility_encoder(&self) -> Option<&'static str> {
        let candidates = if self.source == "bundled" {
            ["libopenh264", "libx264"]
        } else {
            ["libx264", "libopenh264"]
        };
        candidates
            .into_iter()
            .find(|encoder| self.encoder_available(encoder))
    }

    fn encoder_available(&self, encoder: &str) -> bool {
        let child = hidden_command(&self.ffmpeg_path)
            .args(["-hide_banner", "-encoders"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok();
        let Some((status, stdout)) =
            child.and_then(|child| wait_for_child(child, TOOL_CHECK_TIMEOUT))
        else {
            return false;
        };
        status.success()
            && String::from_utf8_lossy(&stdout).lines().any(|line| {
                line.split_whitespace()
                    .nth(1)
                    .is_some_and(|candidate| candidate == encoder)
            })
    }
}

fn compatibility_copy_is_fresh(input: &Path, output: &Path) -> bool {
    let Ok(input_metadata) = input.metadata() else {
        return false;
    };
    let Ok(output_metadata) = output.metadata() else {
        return false;
    };
    if output_metadata.len() == 0 {
        return false;
    }
    match (input_metadata.modified(), output_metadata.modified()) {
        (Ok(input_modified), Ok(output_modified)) => output_modified >= input_modified,
        _ => true,
    }
}

fn tool_works(path: &Path) -> bool {
    hidden_command(path)
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
        .and_then(|child| wait_for_child(child, TOOL_CHECK_TIMEOUT))
        .is_some_and(|(status, _)| status.success())
}

#[cfg(windows)]
fn hidden_command(path: &Path) -> Command {
    let mut command = Command::new(path);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(windows))]
fn hidden_command(path: &Path) -> Command {
    Command::new(path)
}

fn wait_for_child(mut child: Child, timeout: Duration) -> Option<(ExitStatus, Vec<u8>)> {
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Ok(None) | Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    let mut stdout = Vec::new();
    if let Some(mut pipe) = child.stdout.take()
        && pipe.read_to_end(&mut stdout).is_err()
    {
        return None;
    }
    Some((status, stdout))
}

fn executable_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::compatibility_copy_is_fresh;

    #[test]
    fn empty_compatibility_copy_is_not_reused() {
        let directory = tempfile::tempdir().expect("temporary compatibility cache");
        let input = directory.path().join("input.mp4");
        let output = directory.path().join("output.mp4");
        std::fs::write(&input, [1]).expect("input");
        std::fs::write(&output, []).expect("output");

        assert!(!compatibility_copy_is_fresh(&input, &output));
    }
}
