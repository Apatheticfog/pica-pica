use super::{MpvAvailability, MpvSnapshot, MpvViewport};
use crate::errors::{AppError, AppResult};
use libloading::Library;
use std::ffi::{CStr, CString, c_char, c_int, c_void};
use std::path::{Path, PathBuf};
use std::ptr;
use std::sync::{Arc, Mutex};
use tauri::WebviewWindow;
use windows::Win32::Foundation::{HINSTANCE, HWND};
use windows::Win32::Graphics::Gdi::{CreateRectRgn, CreateRoundRectRgn, SetWindowRgn};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, HWND_TOP, SW_HIDE, SW_SHOW, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_SHOWWINDOW,
    SetWindowPos, ShowWindow, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_DISABLED,
    WS_EX_NOACTIVATE,
};
use windows::core::w;

const MPV_FORMAT_FLAG: c_int = 3;
const MPV_FORMAT_INT64: c_int = 4;
const MPV_FORMAT_DOUBLE: c_int = 5;
const REQUIRED_CLIENT_API_MAJOR: u64 = 2;

type MpvHandle = c_void;
type ClientApiVersion = unsafe extern "C" fn() -> u64;
type Create = unsafe extern "C" fn() -> *mut MpvHandle;
type Initialize = unsafe extern "C" fn(*mut MpvHandle) -> c_int;
type SetOptionString = unsafe extern "C" fn(*mut MpvHandle, *const c_char, *const c_char) -> c_int;
type Command = unsafe extern "C" fn(*mut MpvHandle, *const *const c_char) -> c_int;
type GetProperty = unsafe extern "C" fn(*mut MpvHandle, *const c_char, c_int, *mut c_void) -> c_int;
type GetPropertyString = unsafe extern "C" fn(*mut MpvHandle, *const c_char) -> *mut c_char;
type SetProperty = unsafe extern "C" fn(*mut MpvHandle, *const c_char, c_int, *mut c_void) -> c_int;
type SetPropertyString =
    unsafe extern "C" fn(*mut MpvHandle, *const c_char, *const c_char) -> c_int;
type ErrorString = unsafe extern "C" fn(c_int) -> *const c_char;
type MpvFree = unsafe extern "C" fn(*mut c_void);
type TerminateDestroy = unsafe extern "C" fn(*mut MpvHandle);

struct MpvApi {
    _library: Library,
    client_api_version: ClientApiVersion,
    create: Create,
    initialize: Initialize,
    set_option_string: SetOptionString,
    command: Command,
    get_property: GetProperty,
    get_property_string: GetPropertyString,
    set_property: SetProperty,
    set_property_string: SetPropertyString,
    error_string: ErrorString,
    mpv_free: MpvFree,
    terminate_destroy: TerminateDestroy,
}
unsafe impl Send for MpvApi {}

impl MpvApi {
    fn load(path: &Path) -> Result<Self, String> {
        let library = unsafe { Library::new(path) }
            .map_err(|error| format!("Could not load {}: {error}", path.display()))?;
        unsafe fn symbol<T: Copy>(library: &Library, name: &[u8]) -> Result<T, String> {
            unsafe { library.get::<T>(name) }
                .map(|symbol| *symbol)
                .map_err(|error| {
                    format!(
                        "Missing libmpv symbol {}: {error}",
                        String::from_utf8_lossy(name)
                    )
                })
        }
        let api = unsafe {
            Self {
                client_api_version: symbol(&library, b"mpv_client_api_version\0")?,
                create: symbol(&library, b"mpv_create\0")?,
                initialize: symbol(&library, b"mpv_initialize\0")?,
                set_option_string: symbol(&library, b"mpv_set_option_string\0")?,
                command: symbol(&library, b"mpv_command\0")?,
                get_property: symbol(&library, b"mpv_get_property\0")?,
                get_property_string: symbol(&library, b"mpv_get_property_string\0")?,
                set_property: symbol(&library, b"mpv_set_property\0")?,
                set_property_string: symbol(&library, b"mpv_set_property_string\0")?,
                error_string: symbol(&library, b"mpv_error_string\0")?,
                mpv_free: symbol(&library, b"mpv_free\0")?,
                terminate_destroy: symbol(&library, b"mpv_terminate_destroy\0")?,
                _library: library,
            }
        };
        let version = unsafe { (api.client_api_version)() };
        if version >> 16 != REQUIRED_CLIENT_API_MAJOR {
            return Err(format!(
                "Unsupported libmpv client API {}.{}; expected major version {REQUIRED_CLIENT_API_MAJOR}.",
                version >> 16,
                version & 0xffff
            ));
        }
        Ok(api)
    }

    fn version(&self) -> String {
        let version = unsafe { (self.client_api_version)() };
        format!("{}.{}", version >> 16, version & 0xffff)
    }

    fn error(&self, code: c_int) -> String {
        let value = unsafe { (self.error_string)(code) };
        if value.is_null() {
            return format!("libmpv error {code}");
        }
        unsafe { CStr::from_ptr(value) }
            .to_string_lossy()
            .into_owned()
    }
}

struct Player {
    api: MpvApi,
    handle: *mut MpvHandle,
    host: HWND,
    session_id: u64,
    status: String,
    pending_audio_path: Option<String>,
}

unsafe impl Send for Player {}

impl Player {
    fn new(api: MpvApi, host: HWND) -> Result<Self, String> {
        let handle = unsafe { (api.create)() };
        if handle.is_null() {
            return Err("libmpv could not create a player context.".to_owned());
        }
        let mut player = Self {
            api,
            handle,
            host,
            session_id: 0,
            status: "idle".to_owned(),
            pending_audio_path: None,
        };
        let wid = host.0 as usize as u32;
        for (name, value) in [
            ("wid", wid.to_string()),
            ("hwdec", "auto-safe".to_owned()),
            ("keep-open", "yes".to_owned()),
            ("osc", "no".to_owned()),
            ("input-default-bindings", "no".to_owned()),
            ("input-cursor", "no".to_owned()),
            ("cursor-autohide", "no".to_owned()),
            ("input-vo-keyboard", "no".to_owned()),
            ("terminal", "no".to_owned()),
        ] {
            player.set_option(name, &value)?;
        }
        let code = unsafe { (player.api.initialize)(player.handle) };
        if code < 0 {
            return Err(format!(
                "libmpv initialization failed: {}",
                player.api.error(code)
            ));
        }
        Ok(player)
    }

    fn set_option(&mut self, name: &str, value: &str) -> Result<(), String> {
        let name = CString::new(name).map_err(|_| "Invalid libmpv option name.".to_owned())?;
        let value = CString::new(value).map_err(|_| "Invalid libmpv option value.".to_owned())?;
        let code =
            unsafe { (self.api.set_option_string)(self.handle, name.as_ptr(), value.as_ptr()) };
        (code >= 0)
            .then_some(())
            .ok_or_else(|| self.api.error(code))
    }

    fn command(&self, values: &[&str]) -> Result<(), String> {
        let values = values
            .iter()
            .map(|value| CString::new(*value).map_err(|_| "Invalid libmpv command.".to_owned()))
            .collect::<Result<Vec<_>, _>>()?;
        let mut pointers = values
            .iter()
            .map(|value| value.as_ptr())
            .collect::<Vec<_>>();
        pointers.push(ptr::null());
        let code = unsafe { (self.api.command)(self.handle, pointers.as_ptr()) };
        (code >= 0)
            .then_some(())
            .ok_or_else(|| self.api.error(code))
    }

    fn load(&mut self, path: &Path, session_id: u64) -> Result<(), String> {
        let path = path.to_string_lossy().into_owned();
        self.session_id = session_id;
        self.status = "loading".to_owned();
        self.pending_audio_path = Some(path.clone());
        self.set_string("lavfi-complex", "")?;
        self.set_string("aid", "auto")?;
        self.command(&["loadfile", &path, "replace"])
    }

    fn get_double(&self, name: &str) -> Option<f64> {
        let name = CString::new(name).ok()?;
        let mut value = 0.0_f64;
        let code = unsafe {
            (self.api.get_property)(
                self.handle,
                name.as_ptr(),
                MPV_FORMAT_DOUBLE,
                (&mut value as *mut f64).cast(),
            )
        };
        (code >= 0).then_some(value)
    }

    fn get_i64(&self, name: &str) -> Option<i64> {
        let name = CString::new(name).ok()?;
        let mut value = 0_i64;
        let code = unsafe {
            (self.api.get_property)(
                self.handle,
                name.as_ptr(),
                MPV_FORMAT_INT64,
                (&mut value as *mut i64).cast(),
            )
        };
        (code >= 0).then_some(value)
    }

    fn get_flag(&self, name: &str) -> Option<bool> {
        let name = CString::new(name).ok()?;
        let mut value = 0 as c_int;
        let code = unsafe {
            (self.api.get_property)(
                self.handle,
                name.as_ptr(),
                MPV_FORMAT_FLAG,
                (&mut value as *mut c_int).cast(),
            )
        };
        (code >= 0).then_some(value != 0)
    }

    fn get_string(&self, name: &str) -> Option<String> {
        let name = CString::new(name).ok()?;
        let value = unsafe { (self.api.get_property_string)(self.handle, name.as_ptr()) };
        if value.is_null() {
            return None;
        }
        let result = unsafe { CStr::from_ptr(value) }
            .to_string_lossy()
            .into_owned();
        unsafe { (self.api.mpv_free)(value.cast()) };
        Some(result)
    }

    fn set_flag(&self, name: &str, enabled: bool) -> Result<(), String> {
        let name = CString::new(name).map_err(|_| "Invalid libmpv property.".to_owned())?;
        let mut value = c_int::from(enabled);
        let code = unsafe {
            (self.api.set_property)(
                self.handle,
                name.as_ptr(),
                MPV_FORMAT_FLAG,
                (&mut value as *mut c_int).cast(),
            )
        };
        (code >= 0)
            .then_some(())
            .ok_or_else(|| self.api.error(code))
    }

    fn set_double(&self, name: &str, value: f64) -> Result<(), String> {
        let name = CString::new(name).map_err(|_| "Invalid libmpv property.".to_owned())?;
        let mut value = value;
        let code = unsafe {
            (self.api.set_property)(
                self.handle,
                name.as_ptr(),
                MPV_FORMAT_DOUBLE,
                (&mut value as *mut f64).cast(),
            )
        };
        (code >= 0)
            .then_some(())
            .ok_or_else(|| self.api.error(code))
    }

    fn set_string(&self, name: &str, value: &str) -> Result<(), String> {
        let name = CString::new(name).map_err(|_| "Invalid libmpv property.".to_owned())?;
        let value = CString::new(value).map_err(|_| "Invalid libmpv value.".to_owned())?;
        let code =
            unsafe { (self.api.set_property_string)(self.handle, name.as_ptr(), value.as_ptr()) };
        (code >= 0)
            .then_some(())
            .ok_or_else(|| self.api.error(code))
    }

    fn seek(&self, seconds: f64, exact: bool) -> Result<(), String> {
        let seconds = seconds.max(0.0).to_string();
        self.command(&[
            "seek",
            &seconds,
            if exact {
                "absolute+exact"
            } else {
                "absolute+keyframes"
            },
        ])
    }

    fn configure_all_audio_tracks(&mut self) {
        let Some(expected_path) = self.pending_audio_path.clone() else {
            return;
        };
        let Some(active_path) = self.get_string("path") else {
            return;
        };
        if active_path.replace('\\', "/").to_lowercase()
            != expected_path.replace('\\', "/").to_lowercase()
        {
            return;
        }
        let count = self.get_i64("track-list/count").unwrap_or_default().max(0);
        if count == 0 {
            return;
        }
        let track_ids = (0..count)
            .filter(|index| {
                self.get_string(&format!("track-list/{index}/type"))
                    .as_deref()
                    == Some("audio")
            })
            .filter_map(|index| self.get_i64(&format!("track-list/{index}/id")))
            .collect::<Vec<_>>();
        self.pending_audio_path = None;
        if track_ids.len() < 2 {
            return;
        }
        let inputs = track_ids
            .iter()
            .map(|track_id| format!("[aid{track_id}]"))
            .collect::<String>();
        let filter = format!(
            "{inputs}amix=inputs={}:duration=longest:dropout_transition=0[ao]",
            track_ids.len()
        );
        let _ = self.set_string("lavfi-complex", &filter);
    }

    fn snapshot(&mut self) -> MpvSnapshot {
        self.configure_all_audio_tracks();
        let position_seconds = self.get_double("time-pos").unwrap_or_default();
        let duration_seconds = self.get_double("duration").filter(|value| *value > 0.0);
        let paused = self.get_flag("pause").unwrap_or(false);
        let seeking = self.get_flag("seeking").unwrap_or(false);
        let idle = self.get_flag("core-idle").unwrap_or(true);
        if duration_seconds.is_some() {
            self.status = if paused { "paused" } else { "playing" }.to_owned();
        } else if !idle {
            self.status = "loading".to_owned();
        }
        MpvSnapshot {
            session_id: self.session_id,
            status: self.status.clone(),
            position_seconds,
            duration_seconds,
            paused,
            seeking,
            volume: self.get_double("volume").unwrap_or(100.0),
            muted: self.get_flag("mute").unwrap_or(false),
            error: None,
        }
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        unsafe {
            (self.api.terminate_destroy)(self.handle);
        }
    }
}

#[derive(Clone)]
pub struct MpvService {
    resource_dir: Option<PathBuf>,
    player: Arc<Mutex<Option<Player>>>,
}

impl std::fmt::Debug for MpvService {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("MpvService")
            .field("resource_dir", &self.resource_dir)
            .field(
                "player_active",
                &self.player.lock().is_ok_and(|player| player.is_some()),
            )
            .finish()
    }
}

impl MpvService {
    pub fn new(resource_dir: Option<&Path>) -> Self {
        Self {
            resource_dir: resource_dir.map(Path::to_path_buf),
            player: Arc::new(Mutex::new(None)),
        }
    }

    fn dll_candidates(&self) -> Vec<PathBuf> {
        let mut candidates = Vec::new();
        if let Some(resource_dir) = &self.resource_dir {
            candidates.extend([
                resource_dir.join("bin/mpv/libmpv-2.dll"),
                resource_dir.join("bin/libmpv-2.dll"),
                resource_dir.join("binaries/libmpv-2.dll"),
            ]);
        }
        candidates.push(PathBuf::from("libmpv-2.dll"));
        candidates
    }

    fn load_api(&self) -> Result<MpvApi, String> {
        let mut failures = Vec::new();
        for path in self.dll_candidates() {
            match MpvApi::load(&path) {
                Ok(api) => return Ok(api),
                Err(error) => failures.push(error),
            }
        }
        Err(failures.join(" "))
    }

    pub fn availability(&self) -> MpvAvailability {
        if let Ok(player) = self.player.lock()
            && let Some(player) = player.as_ref()
        {
            return MpvAvailability {
                available: true,
                version: Some(player.api.version()),
                diagnostic: None,
                fallback_available: false,
                fallback_diagnostic: None,
            };
        }
        match self.load_api() {
            Ok(api) => MpvAvailability {
                available: true,
                version: Some(api.version()),
                diagnostic: None,
                fallback_available: false,
                fallback_diagnostic: None,
            },
            Err(diagnostic) => MpvAvailability {
                available: false,
                version: None,
                diagnostic: Some(diagnostic),
                fallback_available: false,
                fallback_diagnostic: None,
            },
        }
    }

    pub fn load(
        &self,
        window: &WebviewWindow,
        path: &Path,
        session_id: u64,
    ) -> AppResult<MpvSnapshot> {
        let mut guard = self
            .player
            .lock()
            .map_err(|_| AppError::Task("libmpv player lock failed.".to_owned()))?;
        if guard.is_none() {
            let api = self.load_api().map_err(AppError::Task)?;
            let host = create_host(window).map_err(AppError::Task)?;
            *guard = Some(Player::new(api, host).map_err(AppError::Task)?);
        }
        let player = guard.as_mut().expect("player initialized");
        player.load(path, session_id).map_err(AppError::Task)?;
        Ok(player.snapshot())
    }

    pub fn set_viewport(&self, viewport: &MpvViewport) -> AppResult<()> {
        let guard = self
            .player
            .lock()
            .map_err(|_| AppError::Task("libmpv player lock failed.".to_owned()))?;
        let Some(player) = guard.as_ref() else {
            return Ok(());
        };
        unsafe {
            if !viewport.visible || viewport.width <= 0 || viewport.height <= 0 {
                let _ = ShowWindow(player.host, SW_HIDE);
                return Ok(());
            }
            let clip_top = viewport.clip_top.clamp(0, viewport.height);
            let clip_bottom = viewport.clip_bottom.clamp(0, viewport.height - clip_top);
            let region_bottom = (viewport.height - clip_bottom).max(clip_top);
            let region = if viewport.corner_radius > 0 {
                CreateRoundRectRgn(
                    0,
                    clip_top,
                    viewport.width + 1,
                    region_bottom + 1,
                    viewport.corner_radius * 2,
                    viewport.corner_radius * 2,
                )
            } else {
                CreateRectRgn(0, clip_top, viewport.width + 1, region_bottom + 1)
            };
            let _ = SetWindowRgn(player.host, Some(region), true);
            SetWindowPos(
                player.host,
                Some(HWND_TOP),
                viewport.x,
                viewport.y,
                viewport.width,
                viewport.height,
                SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW,
            )
            .map_err(|error| AppError::Task(error.to_string()))?;
            let _ = ShowWindow(player.host, SW_SHOW);
        }
        Ok(())
    }

    pub fn snapshot(&self) -> AppResult<MpvSnapshot> {
        let mut guard = self
            .player
            .lock()
            .map_err(|_| AppError::Task("libmpv player lock failed.".to_owned()))?;
        guard
            .as_mut()
            .map(Player::snapshot)
            .ok_or_else(|| AppError::Task("libmpv is not active.".to_owned()))
    }

    fn with_session(
        &self,
        session_id: u64,
        action: impl FnOnce(&mut Player) -> Result<(), String>,
    ) -> AppResult<MpvSnapshot> {
        let mut guard = self
            .player
            .lock()
            .map_err(|_| AppError::Task("libmpv player lock failed.".to_owned()))?;
        let player = guard
            .as_mut()
            .ok_or_else(|| AppError::Task("libmpv is not active.".to_owned()))?;
        if player.session_id != session_id {
            return Err(AppError::InvalidInput("Stale player session.".to_owned()));
        }
        action(player).map_err(AppError::Task)?;
        Ok(player.snapshot())
    }

    pub fn set_paused(&self, session_id: u64, paused: bool) -> AppResult<MpvSnapshot> {
        self.with_session(session_id, |player| player.set_flag("pause", paused))
    }

    pub fn seek(&self, session_id: u64, seconds: f64) -> AppResult<MpvSnapshot> {
        self.with_session(session_id, |player| player.seek(seconds, true))
    }

    pub fn preview_seek(&self, session_id: u64, seconds: f64) -> AppResult<()> {
        let mut guard = self
            .player
            .lock()
            .map_err(|_| AppError::Task("libmpv player lock failed.".to_owned()))?;
        let player = guard
            .as_mut()
            .ok_or_else(|| AppError::Task("libmpv is not active.".to_owned()))?;
        if player.session_id != session_id {
            return Err(AppError::InvalidInput("Stale player session.".to_owned()));
        }
        player.seek(seconds, false).map_err(AppError::Task)
    }

    pub fn set_volume(&self, session_id: u64, volume: f64) -> AppResult<MpvSnapshot> {
        self.with_session(session_id, |player| {
            player.set_double("volume", volume.clamp(0.0, 100.0))
        })
    }

    pub fn set_muted(&self, session_id: u64, muted: bool) -> AppResult<MpvSnapshot> {
        self.with_session(session_id, |player| player.set_flag("mute", muted))
    }

    pub fn stop(&self, session_id: u64) -> AppResult<()> {
        let guard = self
            .player
            .lock()
            .map_err(|_| AppError::Task("libmpv player lock failed.".to_owned()))?;
        let Some(player) = guard.as_ref() else {
            return Ok(());
        };
        if player.session_id != session_id {
            return Ok(());
        }
        player.command(&["stop"]).map_err(AppError::Task)?;
        unsafe {
            let _ = ShowWindow(player.host, SW_HIDE);
        }
        Ok(())
    }
}

fn create_host(window: &WebviewWindow) -> Result<HWND, String> {
    let parent = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    window
        .run_on_main_thread(move || {
            let result = unsafe {
                CreateWindowExW(
                    WS_EX_NOACTIVATE,
                    w!("STATIC"),
                    w!(""),
                    WS_CHILD | WS_DISABLED | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
                    0,
                    0,
                    1,
                    1,
                    Some(HWND(parent as *mut c_void)),
                    None,
                    GetModuleHandleW(None)
                        .ok()
                        .map(|handle| HINSTANCE(handle.0)),
                    None,
                )
            }
            .map(|hwnd| hwnd.0 as isize)
            .map_err(|error| error.to_string());
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;
    let host = receiver
        .recv()
        .map_err(|_| "Could not create the native player surface.".to_owned())??;
    Ok(HWND(host as *mut c_void))
}
