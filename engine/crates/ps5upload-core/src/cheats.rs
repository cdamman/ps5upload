//! Cheat engine proxy: list titles, list mods, toggle, delete, reload,
//! status, and enable/disable the engine master flag.
//!
//! Also includes a community cheat download system that fetches cheat
//! files from GitHub repositories (etaHEN/PS5_Cheats, GoldHEN, etc.)
//! and installs them to the PS5 filesystem.

use anyhow::{bail, Result};
use ftx2_proto::FrameType;
use serde::{Deserialize, Serialize};

use crate::connection::Connection;

#[cfg(not(target_os = "android"))]
use std::io::Read;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheatTitle {
    #[serde(default)]
    pub title_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub running: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheatsListResponse {
    #[serde(default)]
    pub titles: Vec<CheatTitle>,
    #[serde(default)]
    pub game_running: bool,
    #[serde(default)]
    pub game_title_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheatMod {
    #[serde(default)]
    pub index: i32,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub desc: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub on: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheatsGetResponse {
    #[serde(default)]
    pub mods: Vec<CheatMod>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheatsToggleRequest {
    pub title_id: String,
    pub index: i32,
    pub on: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheatsToggleResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub err: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheatsStatusResponse {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub patches_last: i64,
    #[serde(default)]
    pub patches_total: i64,
    #[serde(default)]
    pub game_running: bool,
    #[serde(default)]
    pub game_title_id: String,
    #[serde(default)]
    pub game_pid: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheatsEngineSetRequest {
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheatsEngineSetResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub enabled: bool,
}

/// Helper: send a frame and expect an ACK of the given type.
fn send_recv(
    addr: &str,
    req_type: FrameType,
    ack_type: FrameType,
    body: Option<&[u8]>,
) -> Result<Vec<u8>> {
    let mut c = Connection::connect(addr)?;
    let empty: Vec<u8> = Vec::new();
    let body = body.unwrap_or(&empty);
    c.send_frame(req_type, body)?;
    let (hdr, resp) = c.recv_frame()?;
    let ft = hdr.frame_type().unwrap_or(FrameType::Error);
    if ft == FrameType::Error {
        bail!(
            "payload rejected {:?}: {}",
            req_type,
            String::from_utf8_lossy(&resp)
        );
    }
    if ft != ack_type {
        bail!("expected {:?}, got {ack_type:?}", ack_type);
    }
    Ok(resp)
}

pub fn cheats_list(addr: &str) -> Result<CheatsListResponse> {
    let resp = send_recv(
        addr,
        FrameType::CheatsList,
        FrameType::CheatsListAck,
        None,
    )?;
    Ok(serde_json::from_slice(&resp)?)
}

pub fn cheats_get(addr: &str, title_id: &str) -> Result<CheatsGetResponse> {
    let body = serde_json::json!({ "title_id": title_id });
    let resp = send_recv(
        addr,
        FrameType::CheatsGet,
        FrameType::CheatsGetAck,
        Some(&serde_json::to_vec(&body)?),
    )?;
    Ok(serde_json::from_slice(&resp)?)
}

pub fn cheats_toggle(
    addr: &str,
    title_id: &str,
    index: i32,
    on: bool,
) -> Result<CheatsToggleResponse> {
    let req = CheatsToggleRequest {
        title_id: title_id.to_string(),
        index,
        on,
    };
    let resp = send_recv(
        addr,
        FrameType::CheatsToggle,
        FrameType::CheatsToggleAck,
        Some(&serde_json::to_vec(&req)?),
    )?;
    Ok(serde_json::from_slice(&resp)?)
}

pub fn cheats_delete(addr: &str, title_id: &str) -> Result<bool> {
    let body = serde_json::json!({ "title_id": title_id });
    let resp = send_recv(
        addr,
        FrameType::CheatsDelete,
        FrameType::CheatsDeleteAck,
        Some(&serde_json::to_vec(&body)?),
    )?;
    let v: serde_json::Value = serde_json::from_slice(&resp)?;
    Ok(v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
}

pub fn cheats_reload(addr: &str) -> Result<bool> {
    let resp = send_recv(
        addr,
        FrameType::CheatsReload,
        FrameType::CheatsReloadAck,
        None,
    )?;
    let v: serde_json::Value = serde_json::from_slice(&resp)?;
    Ok(v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false))
}

pub fn cheats_status(addr: &str) -> Result<CheatsStatusResponse> {
    let resp = send_recv(
        addr,
        FrameType::CheatsStatus,
        FrameType::CheatsStatusAck,
        None,
    )?;
    Ok(serde_json::from_slice(&resp)?)
}

pub fn cheats_engine_set(addr: &str, enabled: bool) -> Result<CheatsEngineSetResponse> {
    let req = CheatsEngineSetRequest { enabled };
    let resp = send_recv(
        addr,
        FrameType::CheatsEngineSet,
        FrameType::CheatsEngineSetAck,
        Some(&serde_json::to_vec(&req)?),
    )?;
    Ok(serde_json::from_slice(&resp)?)
}

// ─── Community cheat download system ─────────────────────────────────
//
// Fetches cheat files from well-known GitHub repositories and installs
// them onto the PS5 filesystem under /data/cheats/<title_id>/.
//
// On non-Android targets the functions use `ureq` for HTTP. On Android
// they return an error (the Android app does its own HTTP via OkHttp).

/// Description of a community GitHub cheat repository.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheatRepo {
    pub id: String,
    pub name: String,
    /// Base URL for raw file access, e.g.
    /// `https://raw.githubusercontent.com/etaHEN/PS5_Cheats/main/`
    pub raw_base: String,
    /// Index files in the repo root (e.g. `json.txt`, `shn.txt`).
    pub index_files: Vec<String>,
}

/// One entry parsed from a repo index file (`filename=game_title`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheatRepoEntry {
    pub filename: String,
    pub game_title: String,
    /// Cheat format: `json`, `shn`, or `mc4`.
    pub format: String,
    /// Repo ID this entry came from.
    pub repo_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheatRepoSearchRequest {
    pub addr: String,
    pub query: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CheatRepoSearchResponse {
    #[serde(default)]
    pub entries: Vec<CheatRepoEntry>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheatDownloadRequest {
    pub addr: String,
    pub repo_id: String,
    pub filename: String,
    pub title_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CheatDownloadResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub error: Option<String>,
}

/// Return the hard-coded list of known community cheat repositories.
pub fn cheat_repos() -> Vec<CheatRepo> {
    vec![
        CheatRepo {
            id: "etahen".into(),
            name: "etaHEN/PS5_Cheats".into(),
            raw_base: "https://raw.githubusercontent.com/etaHEN/PS5_Cheats/main/".into(),
            index_files: vec!["json.txt".into(), "shn.txt".into(), "mc4.txt".into()],
        },
        CheatRepo {
            id: "goldhen".into(),
            name: "GoldHEN/GoldHEN_Cheat_Repository".into(),
            raw_base: "https://raw.githubusercontent.com/GoldHEN/GoldHEN_Cheat_Repository/main/".into(),
            index_files: vec!["json.txt".into(), "shn.txt".into(), "mc4.txt".into()],
        },
        CheatRepo {
            id: "henmix".into(),
            name: "TeeKay87/HEN-Cheats-Collection".into(),
            raw_base: "https://raw.githubusercontent.com/TeeKay87/HEN-Cheats-Collection/main/".into(),
            index_files: vec!["json.txt".into(), "shn.txt".into(), "mc4.txt".into()],
        },
    ]
}

/// Infer cheat format from the index file that contained the entry.
fn format_from_index(index_name: &str) -> &'static str {
    match index_name {
        "json.txt" => "json",
        "shn.txt" => "shn",
        "mc4.txt" => "mc4",
        _ => "json",
    }
}

#[cfg(not(target_os = "android"))]
fn repo_fetch(url: &str) -> Result<Vec<u8>> {
    let config = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(20)))
        .build();
    let agent = ureq::Agent::new_with_config(config);
    let resp = agent
        .get(url)
        .header("User-Agent", "ps5upload")
        .call()?;
    let mut buf = Vec::with_capacity(32 * 1024);
    resp.into_body().into_reader().read_to_end(&mut buf)?;
    Ok(buf)
}

/// Parse one line of `filename=game_title` format.
fn parse_index_line(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let eq = line.find('=')?;
    let filename = line[..eq].trim().to_string();
    let game_title = line[eq + 1..].trim().to_string();
    if filename.is_empty() {
        return None;
    }
    Some((filename, game_title))
}

/// Search all community repos for cheat entries matching `query`.
/// `query` may match either the filename (e.g. a CUSA ID) or the game
/// title. Matching is case-insensitive substring.
pub fn cheats_repo_search(query: &str) -> Result<CheatRepoSearchResponse> {
    let q = query.to_lowercase();
    let mut entries = Vec::new();
    for repo in cheat_repos() {
        for idx in &repo.index_files {
            let url = format!("{}{}", repo.raw_base, idx);
            #[cfg(not(target_os = "android"))]
            {
                match repo_fetch(&url) {
                    Ok(bytes) => {
                        let text = String::from_utf8_lossy(&bytes);
                        for line in text.lines() {
                            if let Some((filename, game_title)) = parse_index_line(line) {
                                if q.is_empty()
                                    || filename.to_lowercase().contains(&q)
                                    || game_title.to_lowercase().contains(&q)
                                {
                                    entries.push(CheatRepoEntry {
                                        filename,
                                        game_title,
                                        format: format_from_index(idx).into(),
                                        repo_id: repo.id.clone(),
                                    });
                                }
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[cheats] fetch failed for {}/{}: {}", repo.id, idx, e);
                    }
                }
            }
            #[cfg(target_os = "android")]
            {
                let _ = &url;
                eprintln!("[cheats] repo fetch not available on android");
            }
        }
    }
    // De-duplicate by filename (multiple repos may list the same file).
    entries.dedup_by(|a: &mut CheatRepoEntry, b: &mut CheatRepoEntry| a.filename == b.filename);
    Ok(CheatRepoSearchResponse { entries, error: None })
}

/// Determine the on-PS5 install path for a cheat file.
/// The payload's cheat engine scans `/data/ps5upload/cheats/{json,shn,mc4}/`
/// and matches files by filename prefix (title_id). So we install into
/// the correct format subdirectory based on the cheat format.
fn cheat_install_path(filename: &str, format: &str) -> String {
    let safe = filename.replace("..", "");
    let subdir = match format {
        "shn" => "shn",
        "mc4" => "mc4",
        _ => "json",
    };
    format!("/data/ps5upload/cheats/{}/{}", subdir, safe)
}

/// Download a cheat file from a community repo and install it to the
/// PS5. The file lands in `/data/ps5upload/cheats/{json,shn,mc4}/`
/// so the payload's cheat engine finds it on the next reload.
/// Creates the target directory if needed, then writes the file via
/// `fs_write_bytes` (≤256 KB). For larger files this errors — the
/// caller should use the transfer pipeline instead.
pub fn cheats_repo_download(
    addr: &str,
    repo_id: &str,
    filename: &str,
    title_id: &str,
) -> Result<CheatDownloadResponse> {
    let _ = title_id; // title_id is extracted from filename by the payload
    let repo = cheat_repos()
        .into_iter()
        .find(|r| r.id == repo_id)
        .ok_or_else(|| anyhow::anyhow!("unknown repo: {repo_id}"))?;

    #[cfg(not(target_os = "android"))]
    {
        // Try each format subdirectory until one succeeds.
        let mut bytes = None;
        for subdir in &["json", "shn", "mc4", "misc"] {
            let try_url = format!("{}{}/{}", repo.raw_base, subdir, filename);
            match repo_fetch(&try_url) {
                Ok(b) => {
                    bytes = Some(b);
                    break;
                }
                Err(_) => continue,
            }
        }
        let bytes = match bytes {
            Some(b) => b,
            None => {
                return Ok(CheatDownloadResponse {
                    ok: false,
                    error: Some(format!(
                        "file not found in any subdirectory of {}",
                        repo.name
                    )),
                    ..Default::default()
                });
            }
        };

        // Determine format from filename extension.
        let format = if filename.ends_with(".shn") {
            "shn"
        } else if filename.ends_with(".mc4") {
            "mc4"
        } else {
            "json"
        };

        let path = cheat_install_path(filename, format);

        // Ensure the target directory exists (idempotent).
        let dir = match format {
            "shn" => "/data/ps5upload/cheats/shn",
            "mc4" => "/data/ps5upload/cheats/mc4",
            _ => "/data/ps5upload/cheats/json",
        };
        if let Err(e) = crate::fs_ops::fs_mkdir(addr, dir) {
            eprintln!("[cheats] mkdir {} failed (may already exist): {}", dir, e);
        }

        if bytes.len() > 256 * 1024 {
            return Ok(CheatDownloadResponse {
                ok: false,
                error: Some(format!(
                    "file too large for fast write ({} bytes > 256 KB); use the transfer pipeline",
                    bytes.len()
                )),
                ..Default::default()
            });
        }

        match crate::diagnostics::fs_write_bytes(addr, &path, &bytes, false) {
            Ok(r) => Ok(CheatDownloadResponse {
                ok: true,
                path: Some(path),
                size: r.size.or(Some(bytes.len() as u64)),
                ..Default::default()
            }),
            Err(e) => Ok(CheatDownloadResponse {
                ok: false,
                error: Some(e.to_string()),
                ..Default::default()
            }),
        }
    }

    #[cfg(target_os = "android")]
    {
        let _ = (addr, title_id);
        Ok(CheatDownloadResponse {
            ok: false,
            error: Some("repo download not available on android".into()),
            ..Default::default()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_cheats_list_response() {
        let json = r#"{
            "titles": [
                {"title_id":"CUSA00001","name":"Game A","running":false},
                {"title_id":"CUSA00002","name":"Game B","running":true}
            ],
            "game_running": true,
            "game_title_id": "CUSA00002"
        }"#;
        let resp: CheatsListResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.titles.len(), 2);
        assert_eq!(resp.titles[0].title_id, "CUSA00001");
        assert!(!resp.titles[0].running);
        assert!(resp.titles[1].running);
        assert!(resp.game_running);
        assert_eq!(resp.game_title_id, "CUSA00002");
    }

    #[test]
    fn deserialize_cheats_list_empty() {
        let json = r#"{}"#;
        let resp: CheatsListResponse = serde_json::from_str(json).unwrap();
        assert!(resp.titles.is_empty());
        assert!(!resp.game_running);
    }

    #[test]
    fn deserialize_cheats_get_response() {
        let json = r#"{
            "mods": [
                {"index":0,"name":"Inf HP","desc":"God mode","type":"json","on":true},
                {"index":1,"name":"Inf Ammo","desc":"","type":"shn","on":false}
            ]
        }"#;
        let resp: CheatsGetResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.mods.len(), 2);
        assert_eq!(resp.mods[0].name, "Inf HP");
        assert!(resp.mods[0].on);
        assert!(!resp.mods[1].on);
        assert!(resp.error.is_none());
    }

    #[test]
    fn deserialize_cheats_toggle_response_ok() {
        let json = r#"{"ok":true}"#;
        let resp: CheatsToggleResponse = serde_json::from_str(json).unwrap();
        assert!(resp.ok);
        assert!(resp.err.is_none());
    }

    #[test]
    fn deserialize_cheats_toggle_response_err() {
        let json = r#"{"ok":false,"err":"process not running"}"#;
        let resp: CheatsToggleResponse = serde_json::from_str(json).unwrap();
        assert!(!resp.ok);
        assert_eq!(resp.err.as_deref(), Some("process not running"));
    }

    #[test]
    fn deserialize_cheats_status_response() {
        let json = r#"{
            "enabled": true,
            "patches_last": 3,
            "patches_total": 12,
            "game_running": true,
            "game_title_id": "CUSA12345",
            "game_pid": 98765
        }"#;
        let resp: CheatsStatusResponse = serde_json::from_str(json).unwrap();
        assert!(resp.enabled);
        assert_eq!(resp.patches_last, 3);
        assert_eq!(resp.patches_total, 12);
        assert!(resp.game_running);
        assert_eq!(resp.game_title_id, "CUSA12345");
        assert_eq!(resp.game_pid, 98765);
    }

    #[test]
    fn deserialize_cheats_engine_set_response() {
        let json = r#"{"ok":true,"enabled":false}"#;
        let resp: CheatsEngineSetResponse = serde_json::from_str(json).unwrap();
        assert!(resp.ok);
        assert!(!resp.enabled);
    }

    #[test]
    fn cheat_repos_list_nonempty() {
        let repos = cheat_repos();
        assert!(repos.len() >= 2);
        for r in &repos {
            assert!(!r.id.is_empty());
            assert!(!r.raw_base.is_empty());
            assert!(!r.index_files.is_empty());
        }
    }

    #[test]
    fn parse_index_line_basic() {
        let (f, t) = parse_index_line("CUSA00001_cheats.json=Spider-Man").unwrap();
        assert_eq!(f, "CUSA00001_cheats.json");
        assert_eq!(t, "Spider-Man");
    }

    #[test]
    fn parse_index_line_empty_filename() {
        assert!(parse_index_line("=No Filename").is_none());
    }

    #[test]
    fn parse_index_line_comment() {
        assert!(parse_index_line("# this is a comment").is_none());
    }

    #[test]
    fn parse_index_line_blank() {
        assert!(parse_index_line("").is_none());
        assert!(parse_index_line("   ").is_none());
    }

    #[test]
    fn parse_index_line_no_equals() {
        assert!(parse_index_line("just a filename").is_none());
    }

    #[test]
    fn parse_index_line_trims_whitespace() {
        let (f, t) = parse_index_line("  file.json  =  My Game  ").unwrap();
        assert_eq!(f, "file.json");
        assert_eq!(t, "My Game");
    }

    #[test]
    fn format_from_index_mappings() {
        assert_eq!(format_from_index("json.txt"), "json");
        assert_eq!(format_from_index("shn.txt"), "shn");
        assert_eq!(format_from_index("mc4.txt"), "mc4");
        assert_eq!(format_from_index("unknown"), "json");
    }

    #[test]
    fn cheat_install_path_basic() {
        let p = cheat_install_path("cheats.json", "json");
        assert_eq!(p, "/data/ps5upload/cheats/json/cheats.json");
    }

    #[test]
    fn cheat_install_path_shn() {
        let p = cheat_install_path("game.shn", "shn");
        assert_eq!(p, "/data/ps5upload/cheats/shn/game.shn");
    }

    #[test]
    fn cheat_install_path_mc4() {
        let p = cheat_install_path("game.mc4", "mc4");
        assert_eq!(p, "/data/ps5upload/cheats/mc4/game.mc4");
    }

    #[test]
    fn cheat_install_path_strips_traversal() {
        let p = cheat_install_path("../../../etc/passwd", "json");
        assert!(!p.contains(".."));
        assert!(p.starts_with("/data/ps5upload/cheats/json/"));
    }
}
