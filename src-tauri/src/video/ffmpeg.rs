use serde_json::Value;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const TOOL_CHECK_TIMEOUT: Duration = Duration::from_secs(3);
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const THUMBNAIL_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Default)]
pub struct VideoInfo {
    pub duration_seconds: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub codec: Option<String>,
    pub audio_compatible: Option<bool>,
    pub video_compatible: Option<bool>,
    pub compatibility_resolved: bool,
}

impl VideoInfo {
    fn resolved_incompatible() -> Self {
        Self {
            audio_compatible: Some(false),
            video_compatible: Some(false),
            compatibility_resolved: true,
            ..Self::default()
        }
    }
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
                "format=duration:stream=codec_type,codec_name,profile,width,height,pix_fmt",
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
            return VideoInfo::resolved_incompatible();
        }
        let Ok(value) = serde_json::from_slice::<Value>(&stdout) else {
            return VideoInfo::resolved_incompatible();
        };
        video_info_from_probe(&value)
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
}

fn video_info_from_probe(value: &Value) -> VideoInfo {
    let streams = value["streams"].as_array();
    let video = streams.and_then(|streams| {
        streams
            .iter()
            .find(|stream| stream["codec_type"] == "video")
    });
    let audio_compatible = streams.map(|streams| {
        streams
            .iter()
            .filter(|stream| stream["codec_type"] == "audio")
            .all(|stream| {
                stream["codec_name"].as_str() == Some("aac")
                    && stream["profile"].as_str() == Some("LC")
            })
    });
    let video_compatible = video.map(|stream| {
        stream["codec_name"].as_str() == Some("h264")
            && matches!(
                stream["pix_fmt"].as_str(),
                Some("yuv420p" | "yuvj420p")
            )
    });
    VideoInfo {
        duration_seconds: value["format"]["duration"]
            .as_str()
            .and_then(|value| value.parse().ok()),
        width: video
            .and_then(|stream| stream["width"].as_u64())
            .and_then(|value| u32::try_from(value).ok()),
        height: video
            .and_then(|stream| stream["height"].as_u64())
            .and_then(|value| u32::try_from(value).ok()),
        codec: video
            .and_then(|stream| stream["codec_name"].as_str())
            .map(str::to_owned),
        audio_compatible,
        video_compatible,
        compatibility_resolved: true,
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
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_conservative_html_media_profile() {
        let info = video_info_from_probe(&json!({
            "format": { "duration": "42.5" },
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "pix_fmt": "yuv420p",
                    "width": 3840,
                    "height": 2160
                },
                { "codec_type": "audio", "codec_name": "aac", "profile": "LC" },
                { "codec_type": "audio", "codec_name": "aac", "profile": "LC" }
            ]
        }));

        assert_eq!(info.codec.as_deref(), Some("h264"));
        assert_eq!(info.duration_seconds, Some(42.5));
        assert_eq!(info.video_compatible, Some(true));
        assert_eq!(info.audio_compatible, Some(true));
        assert!(info.compatibility_resolved);
    }

    #[test]
    fn rejects_hevc_high_chroma_and_unsupported_audio() {
        for (codec, pixel_format, audio_codec, audio_profile) in [
            ("hevc", "yuv420p", "aac", "LC"),
            ("h264", "yuv444p", "aac", "LC"),
            ("h264", "yuv420p", "opus", "unknown"),
            ("h264", "yuv420p", "aac", "HE-AAC"),
        ] {
            let info = video_info_from_probe(&json!({
                "format": { "duration": "10" },
                "streams": [
                    {
                        "codec_type": "video",
                        "codec_name": codec,
                        "pix_fmt": pixel_format
                    },
                    {
                        "codec_type": "audio",
                        "codec_name": audio_codec,
                        "profile": audio_profile
                    }
                ]
            }));
            assert_ne!(
                (info.video_compatible, info.audio_compatible),
                (Some(true), Some(true)),
                "{codec}/{pixel_format}/{audio_codec}/{audio_profile} must not enter the HTML player"
            );
        }
    }
}
